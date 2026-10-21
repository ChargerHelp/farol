// Package server is the usual Go layout: a server struct holding its router, with the routes in a method.
package server

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

type Server struct {
	router *chi.Mux
}

func New() *Server {
	s := &Server{router: chi.NewRouter()}
	s.routes()
	return s
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) { s.router.ServeHTTP(w, r) }

func (s *Server) routes() {
	s.router.Get("/", s.home)
	s.router.Route("/repo", func(r *chi.Mux) {
		r.Get("/migrate", s.migrate)
		r.Post("/migrate", s.migratePost)
	})
	s.router.Get("/settings", s.settings)
	// A prefix in a local variable, and a path only known at runtime (generated RPC services).
	prefix := "/api/actions"
	s.router.Route(prefix, func(r *chi.Mux) {
		r.Get("/runs", s.home)
	})
	s.router.Post(servicePath()+"*", s.home)
}

func servicePath() string { return "/ping.v1.PingService/" }
