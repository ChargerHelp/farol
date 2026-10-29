import ts from 'typescript'

export const METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'del', 'options', 'head', 'all'])

/** Receivers that register routes; with any other receiver (`http.post(url, body)`) only an inline function is a handler. */
const SERVERS = new Set(['app', 'fastify', 'server', 'router', 'instance', 'api', 'routes', 'express', 'srv'])

function receiverName(call: ts.CallExpression): string | undefined {
  if (!ts.isPropertyAccessExpression(call.expression)) return undefined
  let target: ts.Expression = call.expression.expression
  while (ts.isCallExpression(target) && ts.isPropertyAccessExpression(target.expression)) target = target.expression.expression
  return ts.isIdentifier(target) ? target.text : ts.isPropertyAccessExpression(target) ? target.name.text : undefined
}

function isHandler(node: ts.Node | undefined, call: ts.CallExpression): node is ts.Expression {
  if (node === undefined || call.typeArguments) return false
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return true
  return (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) && SERVERS.has(receiverName(call) ?? '')
}

export function literal(node: ts.Node | undefined): string | undefined {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined
}

function objectProp(obj: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const p of obj.properties) {
    if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === name) return p.initializer
    if (ts.isMethodDeclaration(p) && ts.isIdentifier(p.name) && p.name.text === name) return p as unknown as ts.Expression
  }
  return undefined
}

/** A REST handler registration; `receiver` is the expression the method is called on (`routes` in `routes.get(…)`). */
export interface RestNode {
  key: string
  node: ts.Node
  value: ts.Node
  receiver: ts.Expression
}

/**
 * REST endpoints registered in a file (Fastify and Express styles): `app.get('/path', handler)`,
 * `router.route('/path').post(handler)` and `fastify.route({ method, url, handler })`. Prefixes added by
 * `register(…, { prefix })` or `app.use('/api', router)` are not applied: paths are as written.
 */
export function restNodes(sf: ts.SourceFile): RestNode[] {
  const out: RestNode[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text
      const args = node.arguments
      const last = args[args.length - 1]
      if (METHODS.has(method) && args.length >= 2 && isHandler(last, node)) {
        const path = literal(args[0])
        if (path !== undefined && (path.startsWith('/') || path === '*')) out.push({ key: `${method === 'del' ? 'DELETE' : method.toUpperCase()} ${path}`, node, value: last, receiver: node.expression.expression })
        // router.route('/path').get(handler)
        const target = node.expression.expression
        if (path === undefined && ts.isCallExpression(target) && ts.isPropertyAccessExpression(target.expression) && target.expression.name.text === 'route') {
          const routePath = literal(target.arguments[0])
          if (routePath !== undefined) out.push({ key: `${method.toUpperCase()} ${routePath}`, node, value: last, receiver: node.expression.expression })
        }
      } else if (METHODS.has(method) && args.length === 1 && isHandler(args[0], node)) {
        const target = node.expression.expression
        if (ts.isCallExpression(target) && ts.isPropertyAccessExpression(target.expression) && target.expression.name.text === 'route') {
          const routePath = literal(target.arguments[0])
          if (routePath !== undefined) out.push({ key: `${method.toUpperCase()} ${routePath}`, node, value: args[0], receiver: node.expression.expression })
        }
      } else if (method === 'route' && args.length === 1 && args[0] && ts.isObjectLiteralExpression(args[0])) {
        const methods = objectProp(args[0], 'method')
        const url = literal(objectProp(args[0], 'url')) ?? literal(objectProp(args[0], 'path'))
        const handler = objectProp(args[0], 'handler')
        const names = methods && ts.isArrayLiteralExpression(methods) ? methods.elements.map((e) => literal(e)) : [literal(methods)]
        if (url !== undefined && handler) for (const m of names) if (m !== undefined) out.push({ key: `${m.toUpperCase()} ${url}`, node, value: handler, receiver: node.expression.expression })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

/** Hono mounts of a file (`app.route('/prefix', sub)`, two arguments): the statement and its prefix as written. */
export function mountNodes(sf: ts.SourceFile): { node: ts.Node; call: ts.CallExpression; prefix: string }[] {
  const out: { node: ts.Node; call: ts.CallExpression; prefix: string }[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'route' && node.arguments.length === 2) {
      const prefix = node.arguments[0]
      out.push({ node: ts.isExpressionStatement(node.parent) ? node.parent : node, call: node, prefix: prefix ? prefix.getText(sf) : '' })
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

/** Identity of a mount across the base and head versions of a file: its file and its normalized source text. */
export function mountId(file: string, call: ts.CallExpression): string {
  return `${file} ${call.getText(call.getSourceFile()).replace(/\s+/g, ' ').trim()}`
}

/** Anchor of a REST handler: its file and its path as written (one handler, whatever the mounts above it). */
export function restAnchor(file: string, key: string): string {
  return `${file} ${key}`
}
