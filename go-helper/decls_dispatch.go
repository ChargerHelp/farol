package main

import (
	"go/types"
	"sort"
)

// implementations: the project methods an interface method call can run (every project type that implements the interface).
func (g *graph) implementations(iface *types.Named, method *types.Func) []int {
	sig := method.Type().(*types.Signature)
	recv := deref(sig.Recv().Type())
	it, ok := recv.Underlying().(*types.Interface)
	if !ok {
		return nil
	}
	key := types.TypeString(recv, nil) + "." + method.Name()
	if cached, ok := g.cha[key]; ok {
		return cached
	}
	var out []int
	for _, named := range g.named {
		ptr := types.NewPointer(named)
		if !types.Implements(named, it) && !types.Implements(ptr, it) {
			continue
		}
		sel := types.NewMethodSet(ptr).Lookup(method.Pkg(), method.Name())
		if sel == nil {
			continue
		}
		if fn, ok := sel.Obj().(*types.Func); ok {
			if impl := deref(fn.Type().(*types.Signature).Recv().Type()); impl != nil {
				if n, ok := impl.(*types.Named); ok && n.Obj().Pkg() != nil {
					out = append(out, g.lookup(methodID(n.Obj().Pkg().Path(), n.Obj().Name(), fn.Name()))...)
				}
			}
		}
	}
	sort.Ints(out)
	g.cha[key] = out
	return out
}

// implicitMethods are called by libraries through interfaces (fmt, encoding/*, net/http, io, sort, database/sql):
// code that hands a value to a library may run them without naming them.
var implicitMethods = map[string]bool{
	"String": true, "GoString": true, "Format": true, "Error": true, "Unwrap": true, "Is": true, "As": true,
	"MarshalJSON": true, "UnmarshalJSON": true, "MarshalText": true, "UnmarshalText": true, "MarshalBinary": true, "UnmarshalBinary": true,
	"MarshalYAML": true, "UnmarshalYAML": true, "ServeHTTP": true, "Read": true, "Write": true, "Close": true, "Len": true, "Less": true,
	"Swap": true, "Scan": true, "Value": true,
}
