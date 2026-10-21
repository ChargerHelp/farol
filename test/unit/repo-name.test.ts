import { describe, expect, it } from 'vitest'
import { repoName } from '../../src/cli/analyze.js'

describe('repoName', () => {
  it('prefers GITHUB_REPOSITORY, then parses GitHub remotes', () => {
    expect(repoName({ GITHUB_REPOSITORY: 'a/b' }, 'git@github.com:c/d.git')).toBe('a/b')
    expect(repoName({}, 'git@github.com:c/d.git')).toBe('c/d')
    expect(repoName({}, 'https://github.com/c/d')).toBe('c/d')
    expect(repoName({}, 'https://gitlab.com/c/d.git')).toBeNull()
    expect(repoName({}, null)).toBeNull()
  })
})
