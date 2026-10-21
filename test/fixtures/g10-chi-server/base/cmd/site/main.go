package main

import (
	"net/http"

	"example.com/shop/internal/server"
)

func main() {
	_ = http.ListenAndServe(":3000", server.New())
}
