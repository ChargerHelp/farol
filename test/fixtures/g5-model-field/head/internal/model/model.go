package model

// Brand is a brand of the catalog.
type Brand struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Logo string `json:"logo,omitempty"`
}

// User is the signed-in user.
type User struct {
	Name string `json:"name"`
}
