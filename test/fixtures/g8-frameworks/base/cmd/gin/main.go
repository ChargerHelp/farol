package main

import (
	"github.com/gin-gonic/gin"

	"example.com/shop/internal/web"
)

func main() {
	r := gin.Default()
	r.Use(web.Logger)
	v1 := r.Group("/v1", web.Auth)
	v1.GET("/brands", web.ListBrands)
	web.RegisterAdmin(v1.Group("/admin"))
	_ = r.Run()
}
