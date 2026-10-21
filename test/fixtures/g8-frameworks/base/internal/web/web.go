package web

import (
	"github.com/gin-gonic/gin"

	"example.com/shop/internal/store"
)

func Logger(c *gin.Context) {}

func Auth(c *gin.Context) {}

func ListBrands(c *gin.Context) {
	_ = store.New().All()
}

func Reindex(c *gin.Context) {}

// RegisterAdmin registers the admin routes on the group it is given.
func RegisterAdmin(g *gin.RouterGroup) {
	g.POST("/reindex", Reindex)
}
