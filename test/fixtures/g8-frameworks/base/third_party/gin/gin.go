// Package gin is a test stub with the API shape of github.com/gin-gonic/gin that farol reads.
package gin

type Context struct{}

type HandlerFunc func(*Context)

type RouterGroup struct{}

func (g *RouterGroup) Group(relativePath string, handlers ...HandlerFunc) *RouterGroup { return g }
func (g *RouterGroup) Use(middleware ...HandlerFunc) *RouterGroup                      { return g }
func (g *RouterGroup) GET(relativePath string, handlers ...HandlerFunc)                {}
func (g *RouterGroup) POST(relativePath string, handlers ...HandlerFunc)               {}
func (g *RouterGroup) Handle(method, relativePath string, handlers ...HandlerFunc)     {}

type Engine struct{ RouterGroup }

func Default() *Engine        { return &Engine{} }
func (e *Engine) Run() error { return nil }
