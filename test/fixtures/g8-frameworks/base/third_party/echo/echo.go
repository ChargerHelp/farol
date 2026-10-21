// Package echo is a test stub with the API shape of github.com/labstack/echo/v4 that farol reads.
package echo

type Context interface{ String(code int, s string) error }

type HandlerFunc func(Context) error

type MiddlewareFunc func(HandlerFunc) HandlerFunc

type Route struct{}

type Group struct{}

func (g *Group) GET(path string, h HandlerFunc, m ...MiddlewareFunc) *Route         { return nil }
func (g *Group) Group(prefix string, m ...MiddlewareFunc) *Group                    { return g }
func (g *Group) Use(m ...MiddlewareFunc)                                            {}
func (g *Group) Add(method, path string, h HandlerFunc, m ...MiddlewareFunc) *Route { return nil }

type Echo struct{}

func New() *Echo                                                                   { return &Echo{} }
func (e *Echo) GET(path string, h HandlerFunc, m ...MiddlewareFunc) *Route         { return nil }
func (e *Echo) Group(prefix string, m ...MiddlewareFunc) *Group                    { return &Group{} }
func (e *Echo) Use(m ...MiddlewareFunc)                                            {}
func (e *Echo) Add(method, path string, h HandlerFunc, m ...MiddlewareFunc) *Route { return nil }
