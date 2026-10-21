package web2

import (
	"github.com/labstack/echo/v4"

	"example.com/shop/internal/service"
)

func Me(c echo.Context) error {
	return c.String(200, service.NewUsers().Me().Name)
}

func ClearCache(c echo.Context) error { return nil }
