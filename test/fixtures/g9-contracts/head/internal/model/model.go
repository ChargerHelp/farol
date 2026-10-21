package model

// Brand is a brand of the catalog.
type Brand struct {
	ID   int    `json:"id"`
	Name string `json:"title"`
	Logo string `json:"logo,omitempty"`
}

// User is the signed-in user.
type User struct {
	Name string `json:"name"`
}
