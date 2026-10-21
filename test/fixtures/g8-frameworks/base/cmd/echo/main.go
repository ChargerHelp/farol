package main

import (
	"github.com/labstack/echo/v4"

	"example.com/shop/internal/web2"
)

func main() {
	e := echo.New()
	api := e.Group("/api")
	api.GET("/me", web2.Me)
	e.Add("DELETE", "/cache", web2.ClearCache)
}
