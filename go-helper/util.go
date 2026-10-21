package main

import (
	"sort"
	"strings"
)

// joinPath joins a route prefix and a pattern the way routers do.
func joinPath(prefix, p string) string {
	if prefix == "" {
		return p
	}
	joined := strings.TrimSuffix(prefix, "/") + "/" + strings.TrimPrefix(p, "/")
	if p == "/" || p == "" {
		joined = strings.TrimSuffix(prefix, "/") + "/"
	}
	return joined
}

func uniqueInts(in []int) []int {
	seen := map[int]bool{}
	out := []int{}
	for _, v := range in {
		if !seen[v] {
			seen[v] = true
			out = append(out, v)
		}
	}
	sort.Ints(out)
	return out
}
