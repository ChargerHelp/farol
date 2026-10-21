package rpc

import (
	"context"

	"example.com/shop/internal/brandspb"
	"example.com/shop/internal/store"
)

type BrandsService struct {
	brandspb.UnimplementedBrandsServer
}

func (s *BrandsService) GetBrand(ctx context.Context, req *brandspb.GetBrandRequest) (*brandspb.Brand, error) {
	b, _ := store.New().Find(req.Id)
	return &brandspb.Brand{Id: b.ID, Name: b.Name}, nil
}

func (s *BrandsService) ListBrands(ctx context.Context, req *brandspb.ListBrandsRequest) (*brandspb.BrandList, error) {
	return &brandspb.BrandList{}, nil
}
