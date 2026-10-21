<!-- farol -->
### farol · PR reading (shadow mode)

Signals computed on the lines this PR changes. farol only informs: it never approves or blocks.

- **Review:** ◐ quick review — 3 new suppression(s) (lint/type/security ignores); diff coverage not verified: risk is counted as if nothing were tested
  - `src/lib/unsafe.ts` risk 8
- **Merge risk score:** 10/100 (low; higher is riskier)
- **Risk:** 0 high, 0 medium, 2 low
- **Vulnerabilities in added or changed dependencies:** not verified
- **Diff coverage:** not verified
- **Lint on changed lines:** not verified
- **Added suppressions:** 3
  - `src/lib/unsafe.ts:1` `eslint-disable-next-line`
  - `src/lib/unsafe.ts:3` `ts-expect-error`
  - `src/lib/unsafe.ts:4` `as-any`
- **Modified existing tests:** none

<details>
<summary>Classification — open only after reviewing</summary>

**Class:** `isolated` — isolated: only adds new paths (new routes and files)

**Reasons:**
- only new declarations, comments or formatting (Go) (`declarations-additive`) `src/lib/legacy.ts`: only additions: new declarations src/lib/legacy.ts#version
- new file no route reaches (`new-file-disconnected`) `src/lib/unsafe.ts`: new file that no route reaches
- no existing code touched (`no-existing-code-touched`): the PR only adds new files, routes, exports or keys, or changes tests

**New routes:** none

**Affected existing routes:** none

**New files no route reaches:**
- `src/lib/unsafe.ts`

**Was the classification right? Tick one option:**
- [ ] I agree with the classification
- [ ] I disagree: the PR changed existing behavior
- [ ] I disagree: the PR was isolated and farol missed it

</details>

<sub>farol 0.1.0 · analyzed commit 0123456789ab · shadow mode</sub>
