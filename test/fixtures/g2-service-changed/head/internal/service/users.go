package service

import (
	"strings"

	"example.com/shop/internal/model"
)

// Users knows the signed-in user.
type Users struct{}

func NewUsers() *Users {
	return &Users{}
}

func (u *Users) Me() model.User {
	return model.User{Name: displayName("ada")}
}

func displayName(s string) string {
	return strings.ToTitle(s)
}
