# revscope — v0 specification (source of truth)

> This file is the project's original prompt, translated from Portuguese to English. Tables were converted to
> Markdown; the content was not changed otherwise.
>
> It describes v0. The project was later renamed from revscope to **farol**, and it grew beyond v0 (backends, Go,
> Python, merge risk score, HTML report, user-facing text in English). Every deviation from this text is recorded in
> [DECISIONS.md](DECISIONS.md). Names below (`revscope`, `revscope.config.json`, `<!-- revscope -->`) are kept as
> they were written.

You will build alone, from scratch, the working v0 of a CLI called revscope, which analyzes pull requests of React + TypeScript frontends and says whether the PR only adds new paths or touches existing code. Work until you meet the definition of done at the end of this prompt, without stopping to ask questions.

Context: the team uses a lot of AI-generated code and code review became a bottleneck. The long-term idea is to combine signals (impact, tests, lint, history) to tell the reviewer where to look. v0 is the first slice: separate isolated PRs (entirely new routes and files) from those that touch existing code, and report coverage and lint on the changed lines. It runs in shadow mode: it only informs, it never approves or blocks.

The target frontend uses React, TypeScript, Vitest and React Router, with the routes centralized in one file. If it exists, the real frontend is at <FRONTEND_PATH>: use it only for reading and final validation, never modify it.

The project will be open source later. Code, identifiers, comments, README and commit messages in English. The PR comment texts are in Portuguese, centralized in a single strings module.

First action: save this whole prompt in docs/SPEC.md. It is the project's source of truth.

## How to work

You will work for hours without supervision. So that the result is verifiable when I come back:

1. Before coding, write docs/PROGRESS.md with the milestones of this prompt as a checklist. Update it when each milestone is finished, with what was done and what is pending.
2. Create CLAUDE.md at the root with the project conventions (build and test commands, structure, rules of this prompt). Keep it short and up to date.
3. Record in docs/DECISIONS.md every decision that is not in this prompt: the problem, the options, the choice and the reason. One entry per decision, dated.
4. When something is ambiguous, choose the most conservative option (the one that never classifies something doubtful as isolated), record it in DECISIONS.md and move on. Do not stop to ask.
5. Work in milestone order. Do not start a milestone before the previous one passes its acceptance criterion.
6. Run npm run typecheck, npm run lint and npm test before every commit. At least one commit per milestone, with a descriptive message. Never commit with failing tests.
7. If you get stuck on a problem after three different attempts, record it in PROGRESS.md, adopt a conservative fallback (for example, treat the construct as unsupported and classify as unknown) and continue.
8. Write each module's tests together with it, not at the end.

## Language and stack

These choices are already made. Do not change them.

- TypeScript in strict mode, ESM modules, running on Node LTS 22 or later. Reason: the analysis depends on resolving imports exactly as the project compiles, and only the TypeScript compiler does that precisely.
- npm as the package manager, with package-lock.json committed.

| Package | Use | Note |
|---|---|---|
| typescript | Compiler API for parsing, module resolution and AST | Runtime dependency, not only a development one |
| commander | Command and flag parsing | |
| zod | Validation of the configuration and of the output JSON | Types derived from the schemas |
| picomatch | Matching the configuration's globs | |
| vitest | The tool's own tests | |
| eslint + typescript-eslint | The tool's own lint | |
| tsup | Building the CLI into an executable bundle | |

Dependency rules:

- Git is called with child_process.execFile (never exec with a shell string). Do not use git libraries.
- The GitHub API is called with native fetch. Do not use Octokit.
- ts-morph is only allowed if the compiler API proves unworkable at a specific point, with the justification recorded in DECISIONS.md.
- No other runtime dependency without an entry in DECISIONS.md. Do not use Babel, tree-sitter or regex to understand imports or routes.

Performance: the full TypeScript program is only created on the head. From the base, parse in isolation (ts.createSourceFile) only the files that need comparison: the routes file, and changed barrels and translations. Measure the time of each stage and record it in diagnostics.

## Repository structure

Use this structure. You may create helper files inside the modules, but do not create new top-level modules without an entry in DECISIONS.md.

```
revscope/
  CLAUDE.md
  README.md
  package.json
  tsconfig.json
  eslint.config.js
  vitest.config.ts
  tsup.config.ts
  docs/
    SPEC.md            # this prompt
    PROGRESS.md
    DECISIONS.md
    reasons.md         # documented list of reason codes
  src/
    cli/               # CLI entry and one file per command
    config/            # zod schema and configuration loading
    git/               # merge-base, diff, hunks, reading a file at a ref
    project/           # TS program, module resolution, import graph
    routes/            # route table types and the react-router adapter
    classify/          # roles, additive rules, reach, classification, reasons
    signals/           # coverage, lint, suppressions, modified tests
    output/            # zod schema of the output JSON, and writing
    report/            # markdown rendering and user-facing strings
    github/            # creating and updating the PR comment
  test/
    helpers/           # creating temporary git repositories
    fixtures/          # one directory per scenario, with base/ and head/
  action/
    action.yml
  examples/
    revscope.config.json
    workflow.yml
```

Organization principles:

- Each pipeline stage is a function that receives data and returns data, without side effects. Only cli/, git/, github/ and the writing in output/ touch disk, processes or the network.
- Types that cross stages (changed file, route, graph edge, reason, result) are defined in one place per module and exported.
- No source file over 400 lines.
- The route adapter is the only extension point: an interface that receives the code of the routes file and returns the route table. Do not create plugin systems for anything else.

## Pipeline

The analyze command runs these stages in order. The command never executes code of the analyzed repository (no require, import, Vite or ESLint configs) and never accesses the network.

### 1. Diff

- Compute the merge-base with git merge-base <base> <head> and compare the merge-base with head.
- Use git diff --name-status -M for statuses and renames, and git diff --unified=0 for the hunks.
- For each file, record the status (added, modified, deleted, renamed) and the added and removed lines, with line numbers in the head and in the base.
- Read a file's content at a ref with git show <ref>:<path>.
- Normalize: pairs of removed and added lines that differ only by a trailing comma or whitespace count as unchanged. This keeps adding an item to a list without a trailing comma from looking like a modification.

### 2. Roles

Each changed file gets exactly one role, in this order of precedence: global, routes (the routes.file file), test, story, barrel, i18n, source. Files that match exclude and are not tests or stories are left out of the analysis and listed.

### 3. Route table (react-router adapter)

Support these forms, which cover centralized routes:

- An array of objects passed to createBrowserRouter, createHashRouter or createMemoryRouter, or exported as a constant, with path, index, element, Component, lazy and children.
- JSX with `<Routes>`/`<Route>` and createRoutesFromElements.

For each route, produce: a stable key, the full path, the index flag, the entry module and the layout chain (modules of the ancestor routes that have a component).

- Full path: concatenate the ancestors' paths; absolute paths in children replace the prefix; routes without a path are layouts.
- Entry module: resolve the identifier used in `element={<X/>}` or `Component: X` to its import declaration and to the file. In `lazy: () => import("./X")`, use the import literal.
- Stable key: the sequence of the ancestors' segments, using the path when there is one and `(layout:<module>)` when not.
- Any unrecognized construct (spread, a function call that generates routes, .map, a computed path, an unresolvable component) becomes an entry in diagnostics.dynamicRoutes and makes the PR unknown.

### 4. Import graph

- Create a ts.Program on the head from the configured tsconfig, using the compiler's own module resolution (aliases and baseUrl included).
- Edges: static imports, re-exports, side-effect-only imports (`import "./x"`), import() with a literal, and imports of non-TS files (CSS, SVG, JSON) as leaf nodes.
- Barrels: for each imported name, follow the `export { x } from` and `export * from` chains to the module that declares the symbol, and create the edge to it, not to the barrel. `import * as ns` from a barrel creates edges to every re-exported module.
- Type-only imports (import type, or specifiers that are all type) do not enter the reach graph, because they do not change runtime behavior. Record this decision in DECISIONS.md.
- import() with a non-literal path and unresolved imports go to diagnostics.unresolvedImports. If they involve a changed file, the PR becomes unknown.
- Files in exclude are not source nodes: tests and stories do not count as callers.

### 5. Additive rules

Only three roles have an additive rule. Any other existing file that is modified, removed or renamed is a non-additive change, even if it only has added lines.

| Role | It is additive when | Check |
|---|---|---|
| routes | Every route of the base exists in the head with the same key, entry module and layout chain, and the file's normalized diff has no removed lines | Compare the base and head route tables |
| barrel | The file only contains export declarations, and every binding the base exports (module, name, alias, type-only) is exported by the head the same way | Base AST against head AST |
| i18n | Every key of the base exists in the head with the same value | Deep comparison of the JSONs |

### 6. Reach

- Invert the graph and, for each existing file with a non-additive change, find the routes whose entry modules or layouts reach it. For each route, keep a minimal path (via) from the route to the file.
- For each new file, find the routes that reach it. If an existing route reaches it, that is only possible through a modified existing file, which will already have been detected; record the reason anyway.
- New files that no route reaches are listed as disconnected.
- A modified existing file that no route reaches is still a non-additive change, with an empty route list and its own reason.

### 7. Classification

Apply in this order and stop at the first that matches:

1. global: some file with the global role was changed.
2. unknown: a parse error in a changed file, a dynamic route, an unresolved import involving a changed file, or any internal exception in the analysis.
3. touches-existing: some existing file with a non-additive change, or some new file reached by an existing route.
4. isolated: none of the above.

Every decision produces reasons `{ code, file?, detail }`. The codes form a closed list, defined in an enum and documented in docs/reasons.md. A PR that only changes tests is isolated, with a highlighted reason if existing tests were modified or removed.

## Signals

Signals do not change the classification in v0. analyze runs neither tests nor lint: it reads reports the workflow generated before. Each signal has a status: ok, not-provided (report not given or missing) or error (unreadable report, with a message). A missing signal never shows as passing.

### Diff coverage

- Input: Istanbul JSON (coverage-final.json), the format of Vitest's json reporter. Support only this format in v0.
- Normalize the report's absolute paths to paths relative to the repository root.
- For each added or modified file with the source role: changed lines are the lines added in the head; changed executable lines are those that intersect some statement of the statementMap; a line is covered if every statement that intersects it has a count greater than zero.
- Output per file: changed executable lines, covered lines and uncovered ranges (contiguous ranges grouped). Total output: the sum of both counts.
- A changed file missing from the report counts as entirely uncovered and gets the missingFromReport flag. Document in the README that Vitest must be configured to include files not loaded by tests.

### Lint on changed lines

- Input: the output of eslint -f json. The workflow runs ESLint only on the changed files, but the tool must not depend on that.
- Split the messages into changed lines (they count) and other lines of the file (only counted in the total, as context).
- Output: errors and warnings on changed lines, and up to 50 findings with path, line, rule and severity, sorted by severity and path.

### Added suppressions

Computed directly from the diff, without a report. Look in added lines, using the TypeScript token scanner to tell comments and code from strings:

- eslint-disable, eslint-disable-line, eslint-disable-next-line comments.
- @ts-ignore, @ts-expect-error, @ts-nocheck comments.
- as any expressions and : any annotations.

### Modified tests

List existing files with the test role that were modified, removed or renamed, with the count of removed lines. This highlights the pattern of loosening tests together with the code.

## CLI

### Commands

| Command | What it does |
|---|---|
| `analyze --base <ref> --head <ref> [--coverage <file>] [--eslint <file>] [--out <file>]` | Runs the pipeline and writes the JSON (stdout if --out is missing) |
| `report --in <file>` | Prints the comment markdown from the JSON |
| `comment --in <file> --pr <number> [--repo <owner/name>]` | Creates or updates the PR comment, using GITHUB_TOKEN and GITHUB_REPOSITORY from the environment |
| `routes [--ref <ref>]` | Prints the extracted route table, as JSON |
| `impact <file> [--ref <ref>]` | Lists the routes that reach the file and the path to each one |
| `history --since <date> [--branch <name>] [--out <dir>]` | For each merge commit of the branch in the period, runs analyze between the first parent and the merge and writes one JSON per merge, plus a summary with the count per class |

Global flags: --config <file> (default revscope.config.json), --cwd <dir>, --verbose. Exit codes: 0 when the analysis finishes, whatever the class; 1 for incorrect usage; 2 for an analysis failure. On failure, analyze still writes a JSON with class unknown and the error in diagnostics.

The --coverage and --eslint flags override the signals paths in the configuration.

### Configuration

Validated with zod; a configuration error exits with code 1 and a clear message. Full example in examples/revscope.config.json:

```json
{
  "tsconfig": "tsconfig.json",
  "routes": { "adapter": "react-router", "file": "src/routes.tsx" },
  "exclude": ["**/*.stories.tsx", "src/mocks/**"],
  "roles": {
    "barrel": ["**/index.ts"],
    "i18n": ["src/locales/**/*.json"],
    "test": ["**/*.test.ts", "**/*.test.tsx"],
    "story": ["**/*.stories.tsx"],
    "global": ["src/App.tsx", "src/main.tsx", "src/styles/global.css", "package.json", "package-lock.json", "tsconfig*.json", "eslint.config.*", "vite.config.ts"]
  },
  "signals": {
    "coverage": "coverage/coverage-final.json",
    "eslint": "reports/eslint.json"
  }
}
```

### Output JSON

Define the schema with zod in src/output/schema.ts and validate every output before writing it. Required fields: schemaVersion (1), tool (name and version), repo, base, mergeBase, head, analyzedAt, classification, reasons, files (path, status, role, additive when applicable), routes (added, affected with path and via, disconnectedNewFiles), signals (coverage, lint, suppressions, testsModified), diagnostics (unresolvedImports, dynamicRoutes, timingsMs per stage, error) and review (always null in v0).

The output must be deterministic: sorted arrays, paths with /, no machine data. The clock is injected, so tests can pin analyzedAt.

### Markdown report

The comment starts with the hidden marker `<!-- revscope -->`, used to find and update the same comment. Structure:

1. A title line with the tool's name, without the class.
2. Visible signals: diff coverage (percentage and files with uncovered ranges), lint on changed lines, added suppressions and modified tests. A not-provided signal shows as "not checked".
3. A `<details>` block with the summary "open only after reviewing", containing the class, the reasons, the new and affected routes (with via) and three feedback checkboxes: "I agree with the classification", "I disagree: the PR changed existing behavior", "I disagree: the PR was isolated and the tool missed it".
4. A footer with the tool version and the analyzed commit.

Limit the comment to 60,000 characters, truncating long lists with "and N more".

### GitHub comment

The comment command lists the PR's comments, looks for the marker and sends a PATCH if it finds it or a POST if not. When updating, keep the state of feedback checkboxes already ticked if the analyzed commit changed: copy the ticks from the old comment into the new one. Handle pagination and HTTP errors with clear messages.

### Action and example workflow

Create action/action.yml as a composite action with the command input (analyze or comment) and the inputs passed through to the CLI. It runs `node $GITHUB_ACTION_PATH/../dist/cli.js`. The dist/ directory is committed, and the tool's own CI fails if npm run build produces a difference in dist/.

The example workflow has two jobs, for security: installing dependencies, running Vitest and running ESLint execute code controlled by the PR, so that job has no secrets and no write permission. Only the second job, which does not execute PR code, can write comments. Use this as a base and fix whatever is needed for it to actually work:

```yaml
name: revscope
on:
  pull_request:
permissions: {}
jobs:
  analyze:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.pull_request.head.sha }}
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - name: Tests with coverage
        run: npx vitest run --coverage --coverage.reporter=json
        continue-on-error: true
      - name: ESLint on changed files
        run: |
          mkdir -p reports
          git diff --name-only --diff-filter=AMR ${{ github.event.pull_request.base.sha }}...HEAD -- '*.ts' '*.tsx' > changed.txt
          if [ -s changed.txt ]; then xargs npx eslint -f json -o reports/eslint.json < changed.txt || true; fi
      - uses: winnin/revscope/action@main
        with:
          command: analyze
          base: ${{ github.event.pull_request.base.sha }}
          head: ${{ github.event.pull_request.head.sha }}
          out: revscope.json
      - uses: actions/upload-artifact@v4
        with:
          name: revscope-${{ github.event.pull_request.number }}
          path: revscope.json
  comment:
    needs: analyze
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
    steps:
      - uses: actions/download-artifact@v4
        with:
          name: revscope-${{ github.event.pull_request.number }}
      - uses: winnin/revscope/action@main
        with:
          command: comment
          in: revscope.json
          pr: ${{ github.event.pull_request.number }}
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Rules:

- Use pull_request, never pull_request_target.
- Test or lint failures must not prevent analyze; an analyze failure must not prevent the merge.
- Document in the README how to configure Vitest to include in the report the files not loaded by tests, according to the Vitest version in use.
- The name winnin/revscope is provisional; make it easy to change in the README.

## Tests

Three levels:

- Unit tests for pure functions (hunk parser, line normalization, path concatenation, additive rules, coverage intersection, markdown rendering).
- Scenarios with real git repositories: a helper in test/helpers/ creates a temporary repository, commits fixtures/<scenario>/base/, then applies head/ (including removals listed in a deleted.txt file) and commits again. The test runs analyze and compares with fixtures/<scenario>/expected.json (golden), with a fixed clock.
- End-to-end CLI: a few scenarios running the built binary, checking exit codes and the schema validation of the JSON.

A minimal base fixture, reused by the scenarios: a React app with a tsconfig with the @/ alias, src/routes.tsx with createBrowserRouter, a layout with `<Outlet/>`, three pages, a lazy route, a barrel src/components/index.ts with three components, a translation JSON and a global CSS.

Required scenarios and expected result:

| # | Scenario | Expected class |
|---|---|---|
| 1 | New route with new page and components | isolated |
| 2 | New route plus a new barrel export and new translation keys | isolated |
| 3 | New child route of an existing layout, layout unchanged | isolated |
| 4 | Same as 3, with the layout changed | touches-existing |
| 5 | Existing component modified, used by two routes | touches-existing, both routes in affected with via |
| 6 | New optional prop on a shared component | touches-existing |
| 7 | Existing route component swapped in the routes file | touches-existing |
| 8 | Existing translation value changed | touches-existing |
| 9 | Existing export removed from the barrel | touches-existing |
| 10 | Global CSS changed | global |
| 11 | Routes generated by .map over an array | unknown |
| 12 | Existing file removed | touches-existing |
| 13 | Existing file renamed | touches-existing |
| 14 | Barrel precision: a change to component A of the barrel does not affect a route that imports only component B through the same barrel | touches-existing, without B's route in affected |
| 15 | Import through the @/ alias and through a lazy route | Correct reach through both paths |
| 16 | Change only in a file's import type | Routes that only import types do not appear in affected |
| 17 | PR with only an existing test modified | isolated, with the test in testsModified |
| 18 | New file reached by no route | isolated, file in disconnectedNewFiles |
| 19 | Item added without a trailing comma on the previous item of the routes array | isolated (normalization) |
| 20 | Syntax error in a changed file | unknown |

Signal scenarios, with hand-written reports in the fixtures:

- Partial coverage: exact counts and uncovered ranges.
- Changed file missing from the report: missingFromReport.
- ESLint with errors on changed and unchanged lines: only the changed ones count.
- Suppressions: eslint-disable-next-line, @ts-expect-error and as any on new lines are detected; the same sequence inside a string is not.
- No reports: signals with not-provided.

## Milestones

Execute in order. Each milestone only ends when its acceptance criterion passes and the commit is made.

| Milestone | Deliverable | Acceptance criterion |
|---|---|---|
| M0 | Scaffold: package.json, tsconfig, ESLint, Vitest, tsup, CLAUDE.md, docs/SPEC.md, PROGRESS.md, DECISIONS.md, CLI with --help | npm run build, typecheck, lint and test pass; node dist/cli.js --help lists the commands |
| M1 | Git module: merge-base, status, hunks, normalization, reading at a ref; test repository helper | Unit tests of hunks and normalization; a test with a real repository covering the four statuses |
| M2 | Configuration and roles | An invalid config exits with code 1 and a clear message; role precedence tested |
| M3 | Import graph with aliases, barrels, lazy, import type and diagnostics; impact command | Scenarios 14, 15 and 16 correct through impact |
| M4 | react-router adapter and routes command | The base fixture produces the expected table; scenario 11 produces a dynamic route diagnostic |
| M5 | Additive rules, reach, classification, reasons, output schema and analyze command | Scenarios 1 to 20 pass as golden tests; every output validated by the schema |
| M6 | Signals: coverage, lint, suppressions, modified tests | Every signal scenario passes |
| M7 | report command | Markdown snapshot for one case of each class; size limit tested |
| M8 | history command | Running on a test repository with five merges, it produces five JSONs and the summary |
| M9 | comment command, action.yml, example workflow, committed dist/ | comment tests with mocked fetch covering creation, update, pagination and preservation of ticked boxes |
| M10 | README and validation on the real frontend | Complete README; if a real frontend repository exists, routes and history --since for the last 90 days run without errors, and the summary goes to docs/PROGRESS.md |

In M10, if the real frontend uses an unsupported route form, add support if it is small; otherwise, document it in PROGRESS.md with examples and make sure the result is unknown. Never modify the real frontend; work on a copy or with read-only commands only.

## Do and don't

Do

- Fail closed: when in doubt, unknown or touches-existing, never isolated.
- Explain every classification with concrete reasons, citing file and detail.
- Keep each pipeline stage a pure function, testable in isolation.
- Guarantee deterministic output: same input, same JSON, byte for byte.
- Write error messages that say what to do ("routes file not found at src/routes.tsx; adjust routes.file").
- Record decisions, blockers and deviations in DECISIONS.md and PROGRESS.md.
- Prefer the real behavior of the TypeScript compiler to any reimplementation.

Don't

- Do not execute code of the analyzed repository in analyze: no require, dynamic import(), running ESLint, Vitest or the project's configs.
- Do not access the network, except in the comment command.
- Do not implement Datadog weights, mutation testing, screenshots, numeric scores, backend support or other frameworks (Next.js, Vue, file-system routes). If there is time left, improve tests and the README.
- Do not create abstractions or plugin systems beyond the route adapter interface.
- Do not use regex, Babel or tree-sitter to understand imports, exports or routes.
- Do not swallow exceptions: every failure becomes unknown with the error in diagnostics.
- Do not make analyze fail CI because of the class or the signals.
- Do not change the decisions of this prompt. If one proves unworkable, record the reason in DECISIONS.md, choose the most conservative alternative and move on.
- Do not mark a milestone as done with failing, skipped or commented-out tests.
- Do not modify the real frontend.

## Definition of done

v0 is done when all of the following is true:

- [ ] npm ci && npm run build && npm run typecheck && npm run lint && npm test passes from scratch, with no skipped tests.
- [ ] The 20 classification scenarios and the signal scenarios pass as golden tests.
- [ ] node dist/cli.js analyze --base <ref> --head <ref> --coverage <file> --eslint <file> on a fixture repository produces JSON valid against the schema.
- [ ] node dist/cli.js report --in revscope.json produces the markdown with the marker, the visible signals and the class inside the collapsed block.
- [ ] routes, impact and history work on the base fixture.
- [ ] comment is tested with mocked fetch.
- [ ] action/action.yml, examples/workflow.yml and examples/revscope.config.json exist and are consistent with the CLI.
- [ ] dist/ is committed and up to date.
- [ ] The README explains installation, configuration, each command, the meaning of each class, the signals, the known limitations and the security model of the two jobs.
- [ ] docs/PROGRESS.md ends with a summary: what works, what does not, deviations from the prompt, limitations found and, if the real frontend was available, the count of PRs per class in history.

When done, leave the repository clean (no temporary files) and with every commit made.
