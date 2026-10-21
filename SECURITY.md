# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Report them privately through GitHub's
[private vulnerability reporting](https://github.com/winnin/farol/security/advisories/new). Include:

- a description of the problem and its impact;
- the steps or a minimal repository that reproduces it.

We will acknowledge the report within a few business days, keep you informed, and credit you in the advisory unless
you prefer otherwise.

## What farol guarantees

farol is meant to run on untrusted pull requests, so these properties are part of its security model:

- **It never executes code of the analyzed repository.**
  - TypeScript is read with the compiler API from git objects.
  - Go with `go list` and `go/types` (offline, `GOPROXY=off`, no cgo, no `go generate`).
  - Python with `ast` in an isolated interpreter (`python3 -I`); project modules are never imported.
- **It only uses the network in the `comment` command,** to call the GitHub API with the token you give it.
- **The example workflows separate two jobs:**
  - the job that runs PR code has no secrets and a read-only token;
  - the job that comments never runs PR code, and validates the JSON against its schema before rendering it.
- **The HTML report** contains no scripts from the analyzed repository. Every value from the JSON is escaped. It loads one external script, Mermaid, pinned to an exact version, and only when a route graph is opened.

A way to make farol execute analyzed code, reach the network outside `comment`, or inject markup into its reports is
a vulnerability. Please report it.

## Supported versions

Security fixes go to the latest release on the `main` branch.
