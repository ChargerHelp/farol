<!-- farol -->
### farol · PR reading (shadow mode)

Signals computed on the lines this PR changes. farol only informs: it never approves or blocks.

- **Review:** ⚠ careful review — farol could not read part of the change (unknown): nothing here is guaranteed; merge risk score 28/100; existing code changed: 2 existing page(s) run it
  - `src/routes.tsx` risk 28
- **Merge risk score:** 28/100 (low; higher is riskier)
- **Risk:** 0 high, 0 medium, 1 low
- **Vulnerabilities in added or changed dependencies:** not verified
- **Diff coverage:** not verified
- **Lint on changed lines:** not verified
- **Added suppressions:** none
- **Modified existing tests:** none

<details>
<summary>Classification — open only after reviewing</summary>

**Class:** `unknown` — unknown: farol could not analyze this PR safely

**Reasons:**
- route farol cannot read (`dynamic-route`) `src/routes.tsx`: line 18: spread in route array "...simplePages.map(({ path, Page }) =&gt; ({ path, element: &lt;Page /&gt; }))"
- existing routes changed (`routes-not-additive`) `src/routes.tsx`: 2 line(s) removed (line 13, 14 of the base)
- existing routes changed (`routes-not-additive`) `src/routes.tsx`: route /about (/ &gt; about) was removed
- existing routes changed (`routes-not-additive`) `src/routes.tsx`: route /products (/ &gt; products) was removed

**New routes:** none

**Affected existing routes:**
- `/about` (`/ > about`) via `src/routes.tsx`
- `/products` (`/ > products`) via `src/routes.tsx`

**Was the classification right? Tick one option:**
- [ ] I agree with the classification
- [ ] I disagree: the PR changed existing behavior
- [ ] I disagree: the PR was isolated and farol missed it

</details>

<details>
<summary>Manual test checklist (2)</summary>

- [ ] `/about` (via routes.tsx)
- [ ] `/products` (via routes.tsx)

</details>

<sub>farol &lt;version&gt; · analyzed commit 0123456789ab · shadow mode</sub>
