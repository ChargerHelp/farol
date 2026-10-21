package main

import (
	"google.golang.org/grpc"

	"example.com/shop/internal/brandspb"
	"example.com/shop/internal/rpc"
)

func main() {
	s := grpc.NewServer()
	brandspb.RegisterBrandsServer(s, &rpc.BrandsService{})
}
