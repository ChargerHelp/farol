export const KEY_SEPARATOR = ' > '

function normalizeUrlPath(path: string): string {
  const parts = path.split('/').filter((p) => p !== '')
  return `/${parts.join('/')}`
}

/** Full path of a child route: relative paths are appended to the parent's, absolute paths replace it. */
export function joinRoutePath(parent: string, path: string): string {
  if (path.startsWith('/')) return normalizeUrlPath(path)
  return normalizeUrlPath(`${parent}/${path}`)
}

export interface RouteSegmentInput {
  path: string | undefined
  index: boolean
  entry: string | null
}

/** Key segment of a route: its path, `(index)`, or `(layout:<module>)` for pathless routes. */
export function routeSegment(route: RouteSegmentInput): string {
  if (route.path !== undefined) return route.path
  if (route.index) return '(index)'
  return route.entry === null ? '(layout)' : `(layout:${route.entry})`
}
