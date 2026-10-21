export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed'

/** One changed line: its number in the head (added) or in the base (removed) and its text. */
export interface DiffLine {
  line: number
  text: string
}

export interface ChangedFile {
  /** Repo-relative path in the head (in the base for deleted files). */
  path: string
  /** Repo-relative path in the base, only for renamed files. */
  oldPath?: string
  status: FileStatus
  /** Added lines after normalization, numbered in the head. */
  added: DiffLine[]
  /** Removed lines after normalization, numbered in the base. */
  removed: DiffLine[]
  binary: boolean
}

export interface NameStatusEntry {
  status: FileStatus
  path: string
  oldPath?: string
}

export interface Hunk {
  oldStart: number
  newStart: number
  removed: DiffLine[]
  added: DiffLine[]
}

export interface FilePatch {
  path: string
  oldPath?: string
  binary: boolean
  hunks: Hunk[]
}

export interface MergeCommit {
  sha: string
  firstParent: string
  subject: string
  date: string
}
