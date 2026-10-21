package server

// migrator is new: only the migration handler builds one, though describe formats any fmt.Stringer.
type migrator struct {
	source  string
	service Service
}

func (m *migrator) String() string { return "migrator " + m.source }
