package main

import (
	"go/ast"
	"go/constant"
	"go/types"
	"reflect"
	"sort"
	"strings"
)

// Contract is what an endpoint receives and returns (see src/contracts/types.ts): shapes are plain maps so their JSON
// has exactly the keys of each kind.
type Contract struct {
	Params   map[string]map[string]any `json:"params"`
	Body     map[string]any            `json:"body"`
	Response map[string]any            `json:"response"`
}

const maxShapeDepth = 8

func scalarShape(n string) map[string]any { return map[string]any{"k": "scalar", "n": n} }

func fieldOf(s map[string]any, req, null bool) map[string]any {
	return map[string]any{"s": s, "req": req, "null": null}
}

// shaper turns Go types into shapes. in: the type is decoded from a request (a field is required only when tagged
// `binding:"required"` or `validate:"required"`); otherwise it is encoded into a response (a field is always present
// unless `omitempty`).
type shaper struct {
	in   bool
	seen map[*types.Named]bool
}

func basicName(b *types.Basic) string {
	switch {
	case b.Info()&types.IsString != 0:
		return "string"
	case b.Info()&types.IsBoolean != 0:
		return "bool"
	case b.Info()&types.IsInteger != 0:
		return "int"
	case b.Info()&types.IsFloat != 0:
		return "float"
	}
	return b.Name()
}

// enumValues: constants of a named basic type declared in its package (`type Status string; const Active Status = "a"`).
func enumValues(n *types.Named) []string {
	pkg := n.Obj().Pkg()
	if pkg == nil {
		return nil
	}
	var out []string
	scope := pkg.Scope()
	for _, name := range scope.Names() {
		c, ok := scope.Lookup(name).(*types.Const)
		if !ok || !types.Identical(c.Type(), n) {
			continue
		}
		if c.Val().Kind() == constant.String {
			out = append(out, constant.StringVal(c.Val()))
		} else {
			out = append(out, c.Val().ExactString())
		}
	}
	sort.Strings(out)
	return out
}

func hasMethod(t types.Type, name string) bool {
	for _, x := range []types.Type{t, types.NewPointer(t)} {
		if types.NewMethodSet(x).Lookup(nil, name) != nil {
			return true
		}
		ms := types.NewMethodSet(x)
		for i := 0; i < ms.Len(); i++ {
			if ms.At(i).Obj().Name() == name {
				return true
			}
		}
	}
	return false
}

// shape of a type and whether its JSON may be null.
func (s *shaper) shape(t types.Type, depth int) (map[string]any, bool) {
	if depth > maxShapeDepth {
		return map[string]any{"k": "unknown", "n": types.TypeString(t, nil)}, false
	}
	switch x := t.(type) {
	case *types.Pointer:
		sh, _ := s.shape(x.Elem(), depth+1)
		return sh, true
	case *types.Named:
		obj := x.Obj()
		full := obj.Name()
		if obj.Pkg() != nil {
			full = obj.Pkg().Path() + "." + obj.Name()
		}
		if full == "time.Time" || full == "encoding/json.RawMessage" {
			return scalarShape(full), false
		}
		// Types with their own JSON encoding are compared by name.
		if hasMethod(x, "MarshalJSON") || hasMethod(x, "UnmarshalJSON") {
			return scalarShape(full), false
		}
		if b, ok := x.Underlying().(*types.Basic); ok {
			if values := enumValues(x); len(values) > 0 {
				return map[string]any{"k": "enum", "n": obj.Name(), "v": values}, false
			}
			return scalarShape(basicName(b)), false
		}
		if _, ok := x.Underlying().(*types.Struct); ok {
			if s.seen[x] {
				return map[string]any{"k": "ref", "n": obj.Name()}, false
			}
			s.seen[x] = true
			defer delete(s.seen, x)
			fields := map[string]any{}
			s.structFields(x.Underlying().(*types.Struct), fields, depth)
			return map[string]any{"k": "object", "n": obj.Name(), "f": fields}, false
		}
		return s.shape(x.Underlying(), depth+1)
	case *types.Basic:
		return scalarShape(basicName(x)), false
	case *types.Slice:
		if b, ok := x.Elem().(*types.Basic); ok && b.Kind() == types.Byte {
			return scalarShape("bytes"), true
		}
		el, _ := s.shape(x.Elem(), depth+1)
		return map[string]any{"k": "list", "of": el}, true
	case *types.Array:
		el, _ := s.shape(x.Elem(), depth+1)
		return map[string]any{"k": "list", "of": el}, false
	case *types.Map:
		return scalarShape("object"), true
	case *types.Interface:
		return scalarShape("any"), true
	case *types.Struct:
		fields := map[string]any{}
		s.structFields(x, fields, depth)
		return map[string]any{"k": "object", "n": "", "f": fields}, false
	}
	return map[string]any{"k": "unknown", "n": types.TypeString(t, nil)}, false
}

// structFields adds the JSON fields of a struct: exported fields by their json tag name, embedded structs flattened.
func (s *shaper) structFields(st *types.Struct, out map[string]any, depth int) {
	for i := 0; i < st.NumFields(); i++ {
		f := st.Field(i)
		tag := reflect.StructTag(st.Tag(i))
		jsonTag := tag.Get("json")
		name, opts, _ := strings.Cut(jsonTag, ",")
		if name == "-" && opts == "" {
			continue
		}
		if f.Embedded() && name == "" {
			if inner, ok := deref(f.Type()).Underlying().(*types.Struct); ok {
				s.structFields(inner, out, depth+1)
				continue
			}
		}
		if !f.Exported() {
			continue
		}
		if name == "" {
			name = f.Name()
		}
		sh, null := s.shape(f.Type(), depth+1)
		omit := strings.Contains(opts, "omitempty") || strings.Contains(opts, "omitzero")
		var req bool
		if s.in {
			req = strings.Contains(tag.Get("binding"), "required") || strings.Contains(tag.Get("validate"), "required")
		} else {
			req = !omit
		}
		out[name] = fieldOf(sh, req, null)
	}
}

func shapeOf(t types.Type, in bool) (map[string]any, bool) {
	return (&shaper{in: in, seen: map[*types.Named]bool{}}).shape(t, 0)
}

// calleeOf: package path and name of a called function, or receiver type and method name.
func calleeOf(p *pkg, call *ast.CallExpr) (owner, name string) {
	sel, ok := call.Fun.(*ast.SelectorExpr)
	if !ok {
		return "", ""
	}
	if s, ok := p.info.Selections[sel]; ok {
		return types.TypeString(deref(s.Recv()), nil), sel.Sel.Name
	}
	if fn, ok := p.info.Uses[sel.Sel].(*types.Func); ok && fn.Pkg() != nil {
		return fn.Pkg().Path(), sel.Sel.Name
	}
	return "", ""
}

func isGin(owner string) bool  { return strings.HasPrefix(owner, "github.com/gin-gonic/gin") }
func isEcho(owner string) bool { return strings.HasPrefix(owner, "github.com/labstack/echo") }

// handlerIO reads, from handler bodies, the types decoded from the request, the types encoded into the response and
// the query and path parameters read by name.
type handlerIO struct {
	request  []types.Type
	response []types.Type
	params   map[string]bool // "query:x" / "path:x"
}

// ioCall classifies a call: which argument is a value decoded from the request ("req") or encoded into the response
// ("resp"), or a query/path parameter read by name ("query"/"path", the argument being the name).
func ioCall(p *pkg, call *ast.CallExpr) (string, int) {
	owner, name := calleeOf(p, call)
	switch {
	case owner == "encoding/json.Decoder" && name == "Decode":
		return "req", 0
	case owner == "encoding/json" && name == "Unmarshal" && len(call.Args) == 2:
		return "req", 1
	case owner == "encoding/json.Encoder" && name == "Encode", owner == "encoding/json" && (name == "Marshal" || name == "MarshalIndent"):
		return "resp", 0
	case (isGin(owner) || isEcho(owner)) && strings.HasPrefix(name, "Bind"), isGin(owner) && strings.HasPrefix(name, "ShouldBind"):
		return "req", 0
	case (isGin(owner) || isEcho(owner)) && (name == "JSON" || name == "IndentedJSON" || name == "PureJSON" || name == "JSONPretty"):
		return "resp", 1
	case strings.HasPrefix(owner, "github.com/go-chi/render") && name == "JSON":
		return "resp", 2
	case isGin(owner) && (name == "Query" || name == "DefaultQuery" || name == "GetQuery"), isEcho(owner) && name == "QueryParam", owner == "net/url.Values" && name == "Get":
		return "query", 0
	case (isGin(owner) || isEcho(owner)) && name == "Param", owner == "net/http.Request" && name == "PathValue":
		return "path", 0
	case strings.HasPrefix(owner, "github.com/go-chi/chi") && name == "URLParam":
		return "path", 1
	}
	return "", -1
}

// ioParams: parameters of a project function that it decodes or encodes itself (`func writeJSON(w, v any)`), by index.
func (f *routeFinder) ioParams(fn *types.Func, depth int) map[int]string {
	if f.ioCache == nil {
		f.ioCache = map[*types.Func]map[int]string{}
	}
	if cached, ok := f.ioCache[fn]; ok {
		return cached
	}
	f.ioCache[fn] = nil // recursion guard
	out := map[int]string{}
	decl, owner := f.g.funcs[fn], f.byFunc[fn]
	if decl == nil || owner == nil || decl.Body == nil || depth > 2 {
		return out
	}
	index := map[types.Object]int{}
	i := 0
	for _, field := range decl.Type.Params.List {
		for _, name := range field.Names {
			if obj := owner.info.Defs[name]; obj != nil {
				index[obj] = i
			}
			i++
		}
		if len(field.Names) == 0 {
			i++
		}
	}
	paramAt := func(e ast.Expr) (int, bool) {
		if u, ok := e.(*ast.UnaryExpr); ok {
			e = u.X
		}
		id, ok := e.(*ast.Ident)
		if !ok {
			return 0, false
		}
		idx, ok := index[owner.info.Uses[id]]
		return idx, ok
	}
	ast.Inspect(decl.Body, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}
		if dir, at := ioCall(owner, call); (dir == "req" || dir == "resp") && at < len(call.Args) {
			if idx, ok := paramAt(call.Args[at]); ok {
				out[idx] = dir
			}
		} else if callee := calledFunc(owner, call); callee != nil {
			for at, dir := range f.ioParams(callee, depth+1) {
				if at < len(call.Args) {
					if idx, ok := paramAt(call.Args[at]); ok {
						out[idx] = dir
					}
				}
			}
		}
		return true
	})
	f.ioCache[fn] = out
	return out
}

func calledFunc(p *pkg, call *ast.CallExpr) *types.Func {
	var id *ast.Ident
	switch fun := call.Fun.(type) {
	case *ast.Ident:
		id = fun
	case *ast.SelectorExpr:
		id = fun.Sel
	default:
		return nil
	}
	fn, _ := p.info.Uses[id].(*types.Func)
	return fn
}

func (f *routeFinder) readHandler(p *pkg, body ast.Node, io *handlerIO) {
	ast.Inspect(body, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}
		record := func(dir string, at int) {
			if at >= len(call.Args) {
				return
			}
			switch dir {
			case "req":
				io.request = append(io.request, p.info.TypeOf(call.Args[at]))
			case "resp":
				io.response = append(io.response, p.info.TypeOf(call.Args[at]))
			case "query", "path":
				if v, ok := f.str(p, call.Args[at]); ok {
					io.params[dir+":"+v] = true
				}
			}
		}
		if dir, at := ioCall(p, call); dir != "" {
			record(dir, at)
		} else if callee := calledFunc(p, call); callee != nil {
			// A project helper that encodes or decodes its argument: the type is the one passed here.
			for at, dir := range f.ioParams(callee, 0) {
				record(dir, at)
			}
		}
		return true
	})
}

// bodyShape: the request or response shape from the types a handler decodes or encodes. Untyped maps (error bodies
// such as gin.H) are left out when a typed value is there; several types become a union.
func bodyShape(ts []types.Type, in bool) map[string]any {
	var typed, untyped []map[string]any
	seen := map[string]bool{}
	for _, t := range ts {
		if t == nil {
			continue
		}
		if ptr, ok := t.(*types.Pointer); ok && in {
			t = ptr.Elem()
		}
		key := types.TypeString(t, nil)
		if seen[key] {
			continue
		}
		seen[key] = true
		sh, _ := shapeOf(t, in)
		if sh["k"] == "scalar" && (sh["n"] == "object" || sh["n"] == "any") {
			untyped = append(untyped, sh)
		} else {
			typed = append(typed, sh)
		}
	}
	list := typed
	if len(list) == 0 {
		list = untyped
	}
	switch len(list) {
	case 0:
		return nil
	case 1:
		return list[0]
	}
	sort.Slice(list, func(i, j int) bool { return shapeKey(list[i]) < shapeKey(list[j]) })
	return map[string]any{"k": "union", "of": list}
}

func shapeKey(s map[string]any) string {
	n, _ := s["n"].(string)
	k, _ := s["k"].(string)
	return k + ":" + n
}

// httpContract: the contract of an HTTP handler, from the function literals in the registration call and the
// handler declarations (middlewares left out).
func (f *routeFinder) httpContract(p *pkg, call *ast.CallExpr, handlers []int) *Contract {
	io := &handlerIO{params: map[string]bool{}}
	for _, a := range call.Args {
		ast.Inspect(a, func(n ast.Node) bool {
			if lit, ok := n.(*ast.FuncLit); ok {
				f.readHandler(p, lit.Body, io)
				return false
			}
			return true
		})
	}
	for _, h := range handlers {
		ref := f.g.refs[h]
		if fd, ok := ref.node.(*ast.FuncDecl); ok && fd.Body != nil {
			f.readHandler(ref.pkg, fd.Body, io)
		}
	}
	c := &Contract{Params: map[string]map[string]any{}}
	for k := range io.params {
		c.Params[k] = fieldOf(scalarShape("string"), strings.HasPrefix(k, "path:"), false)
	}
	if b := bodyShape(io.request, true); b != nil {
		c.Body = fieldOf(b, true, false)
	}
	c.Response = bodyShape(io.response, false)
	if c.Body == nil && c.Response == nil && len(c.Params) == 0 {
		return nil
	}
	return c
}

// rpcContract: request and response messages of a gRPC method (`func(ctx, *Req) (*Resp, error)`).
func rpcContract(m *types.Func) *Contract {
	sig, ok := m.Type().(*types.Signature)
	if !ok || sig.Params().Len() < 2 || sig.Results().Len() < 1 {
		return nil
	}
	req, _ := shapeOf(deref(sig.Params().At(1).Type()), true)
	resp, _ := shapeOf(deref(sig.Results().At(0).Type()), false)
	return &Contract{Params: map[string]map[string]any{}, Body: fieldOf(req, true, false), Response: resp}
}
