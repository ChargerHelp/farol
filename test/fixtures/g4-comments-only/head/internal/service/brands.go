package service

import (
	"example.com/shop/internal/model"
	"example.com/shop/internal/store"
)

// Brands reads brands from the store.
type Brands struct {
	store *store.Store
}

func NewBrands(s *store.Store) *Brands {
	return &Brands{store: s}
}

// List returns every brand, in store order.
func (b *Brands) List() []model.Brand {
	return b.store.All() // no copy: callers must not modify it
}

func (b *Brands) Get(id string) (model.Brand, bool) {
	return b.store.Find(id)
}
