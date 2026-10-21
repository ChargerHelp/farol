// Package chi is a stub of github.com/go-chi/chi for tests: the types and methods farol reads.
package chi

import "net/http"

type Mux struct{}

func NewRouter() *Mux { return &Mux{} }

func (m *Mux) Get(pattern string, h http.HandlerFunc)                   {}
func (m *Mux) Post(pattern string, h http.HandlerFunc)                  {}
func (m *Mux) Route(pattern string, fn func(r *Mux)) *Mux               { return m }
func (m *Mux) With(middlewares ...func(http.Handler) http.Handler) *Mux { return m }
func (m *Mux) ServeHTTP(w http.ResponseWriter, r *http.Request)         {}
