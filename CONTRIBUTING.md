# Contributing to farol

Thanks for helping! This guide covers the setup, how the code is organized, the rules every change follows, and how
to add a framework or a language.

## Setup

You need Node.js 22+, git, Go 1.22+ (for the Go helper and its tests) and Python 3.11+ (for the Python helper and its
tests).

```sh
git clone https://github.com/winnin/farol.git
cd farol
npm ci
npm run build        # bundles dist/cli.js
npm test             # unit tests, golden scenarios on real temporary git repos, end-to-end tests on dist/cli.js
```

Other scripts:

```sh
npm run typecheck
npm run lint
npm run test:watch
UPDATE_GOLDEN=1 npm test     # rewrite test/fixtures/*/expected.json; review every diff before committing
```

**`dist/cli.js` is committed**, because the GitHub Action runs it without installing anything. Run `npm run build`
and commit `dist/` with every source change; CI fails when they differ.

## Before opening a pull request

- `npm run typecheck`, `npm run lint` and `npm test` pass. Never skip or loosen a test to make it pass.
- `npm run build` was run and `dist/` is committed.
- Every behavior change has a test: a unit test for pure functions, a golden scenario for anything the classifier or the impact sees.
- A decision that is not obvious from the code gets a dated entry in [docs/DECISIONS.md](docs/DECISIONS.md): what problem, what choice, why. New reason codes go to [docs/reasons.md](docs/reasons.md).
- User-facing documentation is updated: [README.md](README.md), [docs/reference.md](docs/reference.md) for commands and options, and [docs/how-it-works.md](docs/how-it-works.md) for analysis details.

## How the code is organized

```
src/
  cli/        commands, options, .farol.json, and everything that touches disk, processes or the network
              (git trees, the Go/Python helpers, report files)
  config/     farol.config.json schema (zod) and loading
  git/        git through execFile only (diff, trees, logs)
  project/    TypeScript: program from git objects, module resolution, import graph, declaration graph
  routes/     the route adapter interface and the React Router adapter
  backend/    TypeScript backends: GraphQL schema and resolvers, REST, globals, context injection
  decls/      the declaration graph shared by Go, Python and TypeScript, and declaration-level impact
  golang/     go.mod parsing and diff
  python/     pyproject.toml / requirements.txt diff
  classify/   roles, additive rules, reach, reasons, classification, risk, dependencies
  signals/    coverage, lint, suppressions, security, vulnerabilities, per report format
  output/     the JSON schema (the contract) and serialization
  report/     merge risk score, verdict, test plan, PR comment Markdown, HTML report
  review/     calibration, reviewers, inline diffs
  github/     GitHub API through fetch (comments)
go-helper/    Go program (standard library only) that reads a Go module offline
py-helper/    Python package (standard library only) that parses a Python project
test/
  unit/ report/ github/   pure functions
  scenarios/              golden scenarios: real temporary git repos built from test/fixtures/<name>/{base,head}
  e2e/                    the built binary and the composite action
  fixtures/               _base-app (React), _base-api (TS backend), _base-go, _base-py, plus one folder per scenario
```

The pipeline is `diff → roles → read trees → impact → reach → classify → signals → output`, and then `report`/`html`
render the JSON. [docs/how-it-works.md](docs/how-it-works.md) describes each stage.

## Rules

These rules keep farol safe to run on any repository and its results trustworthy:

1. **Never execute code of the analyzed repository.**
   - No `require`/`import` of its files, no build tools, no configs that run code.
   - Go is read with `go list` + `go/types` offline; Python with `ast`. The Python helper runs with `python3 -I` and must never import project modules.
2. **No network** except the `comment` command. The Go helper runs with `GOPROXY=off`; nothing downloads during an analysis.
3. **Understand code with real parsers:** the TypeScript compiler API, `go/types`, Python `ast`. Never use regular expressions, Babel or tree-sitter to understand imports or routes. Line-oriented formats (go.mod, requirements.txt, report files) are fine to read as text.
4. **Fail closed.**
   - When something cannot be read, the class is `unknown` or `touches-existing`, never `isolated`.
   - When a call cannot be resolved, assume it reaches more, never less.
   - Never swallow exceptions.
5. **Pure stages.** Classification, impact, risk, score and reports are pure functions of their inputs. Only `cli/`, `git/`, `github/` and `output/write` touch disk, processes or the network.
6. **Deterministic output:** sorted arrays, `/` paths, injected clocks. The same input gives the same JSON byte for byte.
7. **English everywhere:** code, comments, docs, commits and every output. User-facing text lives only in `src/report/strings*.ts`.
8. **At most 400 lines per source file.** Split by responsibility when a file grows.
9. **Subprocesses:** git and other tools through `child_process.execFile` (never a shell string). GitHub through native `fetch`.
10. **New runtime dependency or new top-level module:** add an entry to docs/DECISIONS.md first. farol has five runtime dependencies (commander, graphql, picomatch, typescript, zod) and the helpers have none.

## Adding things

### A web framework or entry-point kind

- **Go** (`go-helper/routes*.go`): recognize the registration calls by the package path and method name of the callee, using `go/types` selections. Record the route key (`METHOD /path`), its anchors (handler and middleware declarations) and an inline hash for literals. Add the registration calls to `f.registrations`, so they are left out of the core hash. Add a scenario under `test/fixtures/g*`. If the framework is a module, write a local stub with the same import path, wired through a `replace` in `go.mod`, so tests stay offline.
- **Python** (`py-helper/farol_py/routes.py`, `more_entries.py`): resolve the decorator or call target through the module's imports (`finder.qualified`). Register objects (apps, routers) by their constructor's qualified name. Add a scenario under `test/fixtures/p*`; the helper only parses files, so the framework need not be installed.
- **TypeScript frontends:** implement the `RouteAdapter` interface in `src/routes/` (the only extension point for route tables).
- **TypeScript backends:** see `src/backend/` (GraphQL schema/resolvers, REST).

### A language

A language needs four parts:

1. A helper (or an in-process reader) that prints the shared JSON of `src/decls/types.ts`: declarations with hashes, edges, entry points, problems and comments.
2. A reader in `src/cli/lang-workspace.ts`.
3. Default roles in `src/config/schema.ts`.
4. Manifest and lockfile diffs, and report parsers in `src/signals/`.

`src/decls/impact.ts` then gives declaration-level impact for free.

### A report format

Add a parser in `src/signals/` that returns the same intermediate shape as the existing ones (statements for
coverage, `LintMessage` for lint, `Advisory` for vulnerabilities). Detect the format by content in
`src/cli/signals.ts`, and add a unit test with a small sample.

## Golden scenarios

Each folder in `test/fixtures/` builds a real git repository:

1. the shared base (`_base-app`, `_base-api`, `_base-go` or `_base-py`, chosen by the scenario prefix) plus `<scenario>/base/` is committed on `main`;
2. `<scenario>/head/` is applied, and the paths in `deleted.txt` removed, on `feature`.

The analysis output is compared with `expected.json`. When a change alters outputs on purpose:

1. run `UPDATE_GOLDEN=1 npm test`;
2. read every diff of `expected.json`: is each change right?
3. say why in the PR.

## Commits and pull requests

- Small, focused commits with a clear message (`feat(go): …`, `fix(report): …`, `docs: …`).
- Describe what changed and why, and how you checked it. For analysis changes, include before/after numbers on a real repository when you can.
- Be kind and assume good intent. We follow the [Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/).

## Reporting bugs and asking for features

Open an issue with:

- the farol version (`farol --version`), your OS, and Node, Go and Python versions as relevant;
- the configuration;
- the command line;
- what you expected and what happened.

`farol routes` and `farol impact <file>` outputs help a lot for analysis bugs. Remove anything private from them.

Security issues: see [SECURITY.md](SECURITY.md); do not open a public issue.
