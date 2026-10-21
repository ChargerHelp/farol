package server

// Service is where a repository was migrated from.
type Service int

const (
	NotMigrated Service = iota
	GithubService
	BitbucketServerService
)

func (s Service) Title() string {
	if s == GithubService {
		return "GitHub"
	}
	return "Git"
}
