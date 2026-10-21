package main

import (
	"crypto/sha1"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"go/ast"
	"go/scanner"
	"go/token"
	"go/types"
	"os"
	"sort"
	"strings"
)

// Decl is one top-level declaration of the project: a function, a method, a type, a variable or a constant.
type Decl struct {
	ID   string `json:"id"`
	File string `json:"file"`
	Line int    `json:"line"`
	End  int    `json:"end"`
	Kind string `json:"kind"`
	// Hash of the declaration's tokens without comments or formatting: equal hashes mean the same code.
	Hash string `json:"hash"`
	// Same hash without route registration calls (compared entry by entry instead): differs from Hash only for
	// functions that register routes, so adding a route does not count as changing the function that registers it.
	Core string `json:"core"`
}

type declRef struct {
	index int
	node  ast.Node // the FuncDecl or the spec (with its GenDecl for constant groups)
	pkg   *pkg
}

// graph holds the declarations, the reference edges between them and the lookups to build them.
type graph struct {
	fset    *token.FileSet
	root    string
	decls   []Decl
	refs    []declRef
	spans   [][2]token.Pos // where each declaration's hash starts and ends
	byID    map[string]int
	funcs   map[*types.Func]*ast.FuncDecl
	edges   map[[2]int]bool
	named   []*types.Named // project named non-interface types, for interface method dispatch
	cha     map[string][]int
	sources map[string][]byte
}

func newGraph(fset *token.FileSet, root string) *graph {
	return &graph{fset: fset, root: root, byID: map[string]int{}, funcs: map[*types.Func]*ast.FuncDecl{}, edges: map[[2]int]bool{}, cha: map[string][]int{}, sources: map[string][]byte{}}
}

func recvName(expr ast.Expr) string {
	switch e := expr.(type) {
	case *ast.StarExpr:
		return recvName(e.X)
	case *ast.IndexExpr:
		return recvName(e.X)
	case *ast.IndexListExpr:
		return recvName(e.X)
	case *ast.Ident:
		return e.Name
	case *ast.ParenExpr:
		return recvName(e.X)
	}
	return "?"
}

func methodID(pkgPath, recv, name string) string { return pkgPath + ".(" + recv + ")." + name }

// hashNode hashes the tokens of a node's source: comments, spacing and line breaks do not count.
func (g *graph) hashNode(file string, from, to token.Pos) string {
	return g.hashExcept(file, from, to, nil)
}

// hashExcept is hashNode skipping the tokens inside the given ranges.
func (g *graph) hashExcept(file string, from, to token.Pos, skip [][2]token.Pos) string {
	src := g.sources[file]
	start, end := g.fset.Position(from).Offset, g.fset.Position(to).Offset
	if src == nil || end > len(src) {
		return ""
	}
	var s scanner.Scanner
	fs := token.NewFileSet()
	s.Init(fs.AddFile(file, -1, end-start), src[start:end], nil, 0)
	h := sha1.New()
	lastSkipped := false
	for {
		pos, tok, lit := s.Scan()
		if tok == token.EOF {
			break
		}
		at := from + token.Pos(int(pos)-1)
		skipped := tok == token.SEMICOLON && lastSkipped // the statement end of a skipped call
		for _, r := range skip {
			if at >= r[0] && at < r[1] {
				skipped = true
			}
		}
		lastSkipped = skipped
		if skipped {
			continue
		}
		if tok == token.SEMICOLON {
			lit = ";"
		}
		fmt.Fprintf(h, "%d:%s\x00", tok, lit)
	}
	return hex.EncodeToString(h.Sum(nil))[:16]
}

func (g *graph) rel(abs string) string { return relPath(g.root, abs) }

func (g *graph) add(p *pkg, id, file, kind string, node ast.Node, hashFrom, hashTo token.Pos) {
	if _, dup := g.byID[id]; dup {
		id = fmt.Sprintf("%s#%d", id, len(g.decls))
	}
	d := Decl{ID: id, File: g.rel(file), Line: g.fset.Position(node.Pos()).Line, End: g.fset.Position(node.End()).Line, Kind: kind, Hash: g.hashNode(file, hashFrom, hashTo)}
	d.Core = d.Hash
	g.byID[id] = len(g.decls)
	g.decls = append(g.decls, d)
	g.spans = append(g.spans, [2]token.Pos{hashFrom, hashTo})
	g.refs = append(g.refs, declRef{index: len(g.decls) - 1, node: node, pkg: p})
}

// collect registers every top-level declaration of the project packages.
func (g *graph) collect(pkgs []*pkg) error {
	for _, p := range pkgs {
		if !p.project {
			continue
		}
		path := p.list.ImportPath
		for i, f := range p.files {
			file := p.names[i]
			src, err := os.ReadFile(file)
			if err != nil {
				return err
			}
			g.sources[file] = src
			n := 0
			for _, d := range f.Decls {
				switch d := d.(type) {
				case *ast.FuncDecl:
					id := path + "." + d.Name.Name
					kind := "func"
					if d.Recv != nil && len(d.Recv.List) > 0 {
						id = methodID(path, recvName(d.Recv.List[0].Type), d.Name.Name)
						kind = "method"
					} else if d.Name.Name == "init" || d.Name.Name == "_" {
						n++
						id = fmt.Sprintf("%s.%s#%s#%d", path, d.Name.Name, g.rel(file), n)
					}
					g.add(p, id, file, kind, d, d.Type.Pos(), d.End())
					if obj, ok := p.info.Defs[d.Name].(*types.Func); ok {
						g.funcs[obj] = d
					}
				case *ast.GenDecl:
					if d.Tok == token.IMPORT {
						continue
					}
					for _, spec := range d.Specs {
						// Constants of a group share iota and implicit repetition: the whole group is their code (for
						// references); their hash is their value.
						from, to := spec.Pos(), spec.End()
						if d.Tok == token.CONST && d.Lparen.IsValid() {
							from, to = d.Pos(), d.End()
						}
						switch s := spec.(type) {
						case *ast.TypeSpec:
							g.add(p, path+"."+s.Name.Name, file, "type", s, from, to)
						case *ast.ValueSpec:
							for _, name := range s.Names {
								id := path + "." + name.Name
								if name.Name == "_" {
									n++
									id = fmt.Sprintf("%s._#%s#%d", path, g.rel(file), n)
								}
								g.add(p, id, file, strings.ToLower(d.Tok.String()), s, from, to)
								// A constant is its type and value: appending to an iota group changes no other
								// constant, reordering it does.
								if c, ok := p.info.Defs[name].(*types.Const); ok && d.Tok == token.CONST {
									sum := sha256.Sum256([]byte(types.TypeString(c.Type(), nil) + "\x00" + c.Val().ExactString()))
									last := &g.decls[len(g.decls)-1]
									last.Hash = hex.EncodeToString(sum[:])[:16]
									last.Core = last.Hash
								}
							}
						}
					}
				}
			}
		}
		for _, name := range p.types.Scope().Names() {
			if tn, ok := p.types.Scope().Lookup(name).(*types.TypeName); ok {
				if named, ok := tn.Type().(*types.Named); ok && !types.IsInterface(named) {
					g.named = append(g.named, named)
				}
			}
		}
	}
	return nil
}

func deref(t types.Type) types.Type {
	if ptr, ok := t.(*types.Pointer); ok {
		return ptr.Elem()
	}
	return t
}

// declOf is the declaration index of a project object, or -1.
func (g *graph) declOf(obj types.Object) []int {
	if obj == nil || obj.Pkg() == nil {
		return nil
	}
	path := obj.Pkg().Path()
	switch o := obj.(type) {
	case *types.Func:
		o = o.Origin()
		sig, _ := o.Type().(*types.Signature)
		if sig != nil && sig.Recv() != nil {
			recv := deref(sig.Recv().Type())
			if named, ok := recv.(*types.Named); ok {
				if types.IsInterface(named) {
					own := g.lookup(path + "." + named.Obj().Name())
					// fmt.Stringer, json.Marshaler…: a value reaches them from code that names its type, and a type
					// already depends on its implicit methods (see link), so every String() of the project is not a
					// target of each call.
					if len(own) == 0 && implicitMethods[o.Name()] {
						return own
					}
					return append(own, g.implementations(named, o)...)
				}
				return g.lookup(methodID(named.Obj().Pkg().Path(), named.Obj().Name(), o.Name()))
			}
			if types.IsInterface(recv) {
				if implicitMethods[o.Name()] {
					return nil
				}
				return g.implementations(nil, o)
			}
			return nil
		}
		if o.Parent() == o.Pkg().Scope() {
			return g.lookup(path + "." + o.Name())
		}
	case *types.TypeName, *types.Const:
		if obj.Parent() == obj.Pkg().Scope() {
			return g.lookup(path + "." + obj.Name())
		}
	case *types.Var:
		if !o.IsField() && o.Parent() == o.Pkg().Scope() {
			return g.lookup(path + "." + o.Name())
		}
	}
	return nil
}

func (g *graph) lookup(id string) []int {
	if i, ok := g.byID[id]; ok {
		return []int{i}
	}
	return nil
}

// usesIn: project declarations a piece of code references (identifiers, and struct types whose fields it selects).
// own is the receiver type of a method: reading its own fields is not a use of the type (else every method of a
// handler would depend on every other one through the type).
func (g *graph) usesIn(p *pkg, node ast.Node, own *types.TypeName) []int {
	var out []int
	ast.Inspect(node, func(n ast.Node) bool {
		switch x := n.(type) {
		case *ast.Ident:
			out = append(out, g.declOf(p.info.Uses[x])...)
		case *ast.SelectorExpr:
			if sel, ok := p.info.Selections[x]; ok && sel.Kind() == types.FieldVal {
				if named, ok := deref(sel.Recv()).(*types.Named); ok && named.Obj().Pkg() != nil && named.Origin().Obj() != own {
					out = append(out, g.lookup(named.Obj().Pkg().Path()+"."+named.Obj().Name())...)
				}
			}
		}
		return true
	})
	return out
}

// receiverType is the type a method is declared on (nil for anything else).
func receiverType(p *pkg, node ast.Node) *types.TypeName {
	fd, ok := node.(*ast.FuncDecl)
	if !ok || fd.Recv == nil {
		return nil
	}
	fn, ok := p.info.Defs[fd.Name].(*types.Func)
	if !ok {
		return nil
	}
	if named, ok := deref(fn.Type().(*types.Signature).Recv().Type()).(*types.Named); ok {
		return named.Origin().Obj()
	}
	return nil
}

// codeOf is what a declaration runs: a method's receiver declaration is not part of it.
func codeOf(node ast.Node) []ast.Node {
	if fd, ok := node.(*ast.FuncDecl); ok {
		out := []ast.Node{fd.Type}
		if fd.Body != nil {
			out = append(out, fd.Body)
		}
		return out
	}
	return []ast.Node{node}
}

// link adds an edge from every declaration to each project declaration its code uses.
func (g *graph) link() {
	called := map[int]bool{}
	for _, r := range g.refs {
		own := receiverType(r.pkg, r.node)
		for _, part := range codeOf(r.node) {
			for _, to := range g.usesIn(r.pkg, part, own) {
				if to != r.index {
					g.edges[[2]int{r.index, to}] = true
					called[to] = true
				}
			}
		}
	}
	// A method the project calls is resolved where it is called (directly or through an interface). The type
	// depends on the others: methods only a library can call, by an interface (MarshalJSON, ServeHTTP…) or reflection.
	for _, r := range g.refs {
		fd, ok := r.node.(*ast.FuncDecl)
		if !ok || fd.Recv == nil || len(fd.Recv.List) == 0 {
			continue
		}
		if called[r.index] && !implicitMethods[fd.Name.Name] {
			continue
		}
		for _, t := range g.lookup(r.pkg.list.ImportPath + "." + recvName(fd.Recv.List[0].Type)) {
			g.edges[[2]int{t, r.index}] = true
		}
	}
}

// setCore recomputes the core hash of declarations that contain route registrations.
func (g *graph) setCore(registrations [][2]token.Pos) {
	for i, span := range g.spans {
		var inside [][2]token.Pos
		for _, r := range registrations {
			if r[0] >= span[0] && r[1] <= span[1] {
				inside = append(inside, r)
			}
		}
		if len(inside) > 0 {
			file := g.fset.Position(span[0]).Filename
			g.decls[i].Core = g.hashExcept(file, span[0], span[1], inside)
		}
	}
}

func (g *graph) edgeList() [][2]int {
	out := make([][2]int, 0, len(g.edges))
	for e := range g.edges {
		out = append(out, e)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i][0] != out[j][0] {
			return out[i][0] < out[j][0]
		}
		return out[i][1] < out[j][1]
	})
	return out
}
