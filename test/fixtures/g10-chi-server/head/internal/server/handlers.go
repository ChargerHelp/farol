package server

import (
	"fmt"
	"net/http"
)

// describe formats any value: through fmt.Stringer when it has a String method.
func describe(v any) string {
	if s, ok := v.(fmt.Stringer); ok {
		return s.String()
	}
	return fmt.Sprint(v)
}

func (s *Server) home(w http.ResponseWriter, r *http.Request) {
	_, _ = w.Write([]byte(describe(r.URL.Path)))
}

func (s *Server) migrate(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("migrate")) }

func (s *Server) migratePost(w http.ResponseWriter, r *http.Request) {
	m := &migrator{source: r.FormValue("source"), service: BitbucketServerService}
	_, _ = w.Write([]byte(m.String()))
	w.WriteHeader(http.StatusAccepted)
}

func (s *Server) settings(w http.ResponseWriter, r *http.Request) {
	_, _ = w.Write([]byte(NotMigrated.Title()))
}
