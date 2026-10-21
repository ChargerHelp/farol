package store

import "example.com/shop/internal/model"

// Store keeps brands in memory.
type Store struct {
	items []model.Brand
}

func New() *Store {
	return &Store{items: []model.Brand{{ID: "1", Name: "Acme"}}}
}

func (s *Store) All() []model.Brand {
	return s.items
}

func (s *Store) Find(id string) (model.Brand, bool) {
	for _, b := range s.items {
		if b.ID == id || b.Name == id {
			return b, true
		}
	}
	return model.Brand{}, false
}
