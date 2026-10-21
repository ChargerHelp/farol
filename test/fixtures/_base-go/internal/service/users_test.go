package service

import "testing"

func TestDisplayName(t *testing.T) {
	if displayName("ada") != "ADA" {
		t.Fatal("unexpected name")
	}
}
