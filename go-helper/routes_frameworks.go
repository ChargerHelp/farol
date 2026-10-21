package main

import (
	"go/ast"
	"go/token"
	"go/types"
	"strings"
)

// Router packages read by their method names; chi is handled in routes.go (closure-based groups).
var frameworks = map[string]string{"github.com/gin-gonic/gin": "gin", "github.com/labstack/echo": "echo"}

var upperVerbs = map[string]string{"GET": "GET", "POST": "POST", "PUT": "PUT", "PATCH": "PATCH", "DELETE": "DELETE", "HEAD": "HEAD", "OPTIONS": "OPTIONS", "CONNECT": "CONNECT", "TRACE": "TRACE", "Any": "ANY"}

// frameworkMethod: the framework ("gin", "echo") and method name of a call on one of their routers or groups.
func frameworkMethod(p *pkg, sel *ast.SelectorExpr) (string, string) {
	s, ok := p.info.Selections[sel]
	if !ok || s.Kind() != types.MethodVal || s.Obj().Pkg() == nil {
		return "", ""
	}
	path := s.Obj().Pkg().Path()
	for prefix, name := range frameworks {
		if path == prefix || strings.HasPrefix(path, prefix+"/") {
			return name, s.Obj().Name()
		}
	}
	return "", ""
}

func isFrameworkRouter(t types.Type) bool {
	if t == nil {
		return false
	}
	s := types.TypeString(deref(t), nil)
	for prefix := range frameworks {
		if strings.HasPrefix(s, prefix) && (strings.HasSuffix(s, ".Engine") || strings.HasSuffix(s, ".RouterGroup") || strings.HasSuffix(s, ".IRouter") || strings.HasSuffix(s, ".IRoutes") || strings.HasSuffix(s, ".Echo") || strings.HasSuffix(s, ".Group")) {
			return true
		}
	}
	return false
}

// scopeOf: prefix and middlewares of a router expression: a group variable, a chained Group call, or the current scope.
func (f *routeFinder) scopeOf(p *pkg, e ast.Expr, sc *scope, enclosing int) *scope {
	switch x := e.(type) {
	case *ast.Ident:
		if s, ok := f.vars[p.info.Uses[x]]; ok {
			return s
		}
	case *ast.ParenExpr:
		return f.scopeOf(p, x.X, sc, enclosing)
	case *ast.CallExpr:
		if sel, ok := x.Fun.(*ast.SelectorExpr); ok {
			if fw, name := frameworkMethod(p, sel); fw != "" && name == "Group" && len(x.Args) > 0 {
				parent := f.scopeOf(p, sel.X, sc, enclosing)
				pattern := f.pattern(p, x.Args[0])
				out := &scope{prefix: joinPath(parent.prefix, pattern), mws: append([]int{}, parent.mws...), inline: append([]string{}, parent.inline...)}
				for _, a := range x.Args[1:] {
					out.mws = append(out.mws, f.anchorsOf(p, a, enclosing)...)
				}
				out.inline = append(out.inline, f.inline...)
				f.inline = nil
				return out
			}
		}
	}
	return sc
}

// groupAssign records `v1 := r.Group("/v1", mw)` so that routes on v1 get the prefix and the middlewares.
func (f *routeFinder) groupAssign(p *pkg, as *ast.AssignStmt, sc *scope, enclosing int) {
	if len(as.Lhs) != 1 || len(as.Rhs) != 1 {
		return
	}
	id, ok := as.Lhs[0].(*ast.Ident)
	call, ok2 := as.Rhs[0].(*ast.CallExpr)
	if !ok || !ok2 {
		return
	}
	sel, ok := call.Fun.(*ast.SelectorExpr)
	if !ok {
		return
	}
	if fw, name := frameworkMethod(p, sel); fw == "" || name != "Group" {
		return
	}
	obj := p.info.Defs[id]
	if obj == nil {
		obj = p.info.Uses[id]
	}
	if obj != nil {
		f.vars[obj] = f.scopeOf(p, call, sc, enclosing)
		f.registrations = append(f.registrations, [2]token.Pos{as.Pos(), as.End()})
	}
}

// ginEcho handles one gin or echo call (routes and Use); it reports whether the call was one.
func (f *routeFinder) ginEcho(p *pkg, call *ast.CallExpr, sc *scope, enclosing int) bool {
	sel, ok := call.Fun.(*ast.SelectorExpr)
	if !ok {
		return false
	}
	fw, name := frameworkMethod(p, sel)
	if fw == "" {
		return false
	}
	if name == "Group" {
		return true // scopeOf / groupAssign read it
	}
	target := f.scopeOf(p, sel.X, sc, enclosing)
	if name == "Use" {
		for _, a := range call.Args {
			target.mws = append(target.mws, f.anchorsOf(p, a, enclosing)...)
		}
		target.inline = append(target.inline, f.inline...)
		f.inline = nil
		f.registrations = append(f.registrations, [2]token.Pos{call.Pos(), call.End()})
		return true
	}
	var methods []string
	pathArg, handlers := 0, 1
	switch {
	case upperVerbs[name] != "":
		methods = []string{upperVerbs[name]}
	case name == "Handle" && fw == "gin", name == "Add" && fw == "echo":
		m, ok := f.str(p, call.Args[0])
		if !ok {
			f.dynamic(call, "route method is not a constant")
			return true
		}
		methods, pathArg, handlers = []string{strings.ToUpper(m)}, 1, 2
	case name == "Match" && fw == "echo":
		if list, ok := call.Args[0].(*ast.CompositeLit); ok {
			for _, el := range list.Elts {
				if m, ok := f.str(p, el); ok {
					methods = append(methods, strings.ToUpper(m))
				}
			}
		}
		pathArg, handlers = 1, 2
	default:
		return false
	}
	if len(call.Args) <= handlers || len(methods) == 0 {
		return true
	}
	pattern := f.pattern(p, call.Args[pathArg])
	f.registrations = append(f.registrations, [2]token.Pos{call.Pos(), call.End()})
	var anchors []int
	for _, h := range call.Args[handlers:] {
		anchors = append(anchors, f.anchorsOf(p, h, enclosing)...)
	}
	anchors = append(anchors, target.mws...)
	for _, m := range methods {
		saved := f.inline
		f.add(p, call, target, m+" "+joinPath(target.prefix, pattern), "http", anchors)
		f.inline = saved
	}
	f.inline = nil
	return true
}

// grpcRegister reads `pb.RegisterBrandsServer(s, impl)`: every method of the service interface is an entry point,
// anchored on the implementation's method.
func (f *routeFinder) grpcRegister(p *pkg, call *ast.CallExpr) bool {
	var id *ast.Ident
	switch x := call.Fun.(type) {
	case *ast.Ident:
		id = x
	case *ast.SelectorExpr:
		id = x.Sel
	}
	if id == nil || !strings.HasPrefix(id.Name, "Register") || !strings.HasSuffix(id.Name, "Server") || len(call.Args) != 2 {
		return false
	}
	fn, ok := p.info.Uses[id].(*types.Func)
	if !ok {
		return false
	}
	sig := fn.Type().(*types.Signature)
	if sig.Params().Len() != 2 {
		return false
	}
	iface, ok := sig.Params().At(1).Type().(*types.Named)
	if !ok || !types.IsInterface(iface) {
		return false
	}
	impl := p.info.Types[call.Args[1]].Type
	if impl == nil {
		return false
	}
	service := fn.Pkg().Name() + "." + strings.TrimSuffix(iface.Obj().Name(), "Server")
	it := iface.Underlying().(*types.Interface)
	f.registrations = append(f.registrations, [2]token.Pos{call.Pos(), call.End()})
	for i := 0; i < it.NumMethods(); i++ {
		m := it.Method(i)
		if !m.Exported() {
			continue
		}
		var anchors []int
		for _, t := range []types.Type{impl, types.NewPointer(deref(impl))} {
			if s := types.NewMethodSet(t).Lookup(m.Pkg(), m.Name()); s != nil {
				anchors = append(anchors, f.g.declOf(s.Obj())...)
				break
			}
		}
		f.add(p, call, &scope{}, "RPC "+service+"/"+m.Name(), "rpc", anchors)
		f.entries[len(f.entries)-1].Contract = rpcContract(m)
	}
	return true
}

// bindRouterParams: parameters of a function that receive a group get the group's scope while it is walked.
func (f *routeFinder) bindRouterParams(p *pkg, call *ast.CallExpr, fn *types.Func, sc *scope) string {
	decl, owner := f.g.funcs[fn], f.byFunc[fn]
	if decl == nil || owner == nil {
		return ""
	}
	key := ""
	i := 0
	for _, field := range decl.Type.Params.List {
		for _, name := range field.Names {
			if i < len(call.Args) && isFrameworkRouter(p.info.Types[call.Args[i]].Type) {
				s := f.scopeOf(p, call.Args[i], sc, -1)
				if obj := owner.info.Defs[name]; obj != nil {
					f.vars[obj] = s
					key += "\x00" + s.prefix
				}
			}
			i++
		}
	}
	return key
}
