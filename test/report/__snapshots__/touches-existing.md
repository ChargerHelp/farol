<!-- farol -->
### farol · PR reading (shadow mode)

Signals computed on the lines this PR changes. farol only informs: it never approves or blocks.

- **Review:** ◐ quick review — merge risk score 35/100; existing code changed: 2 existing page(s) run it; diff coverage not verified: risk is counted as if nothing were tested
  - `src/components/Card.tsx` risk 35
- **Merge risk score:** 35/100 (medium; higher is riskier)
- **Risk:** 1 high, 0 medium, 0 low
  - 🔴 `src/components/Card.tsx` 2/4 pages, 6 dependents
- **Vulnerabilities in added or changed dependencies:** not verified
- **Diff coverage:** not verified
- **Lint on changed lines:** not verified
- **Added suppressions:** none
- **Modified existing tests:** none

<details>
<summary>Classification — open only after reviewing</summary>

**Class:** `touches-existing` — touches existing code

**Reasons:**
- existing file modified (`existing-file-modified`) `src/components/Card.tsx`: func src/components/Card.tsx#Card changed: reached by 2 existing route(s): / &gt; (index); / &gt; products

**New routes:** none

**Affected existing routes:**
- `/` (`/ > (index)`) via `src/pages/HomePage.tsx` → `src/components/Card.tsx`
- `/products` (`/ > products`) via `src/pages/ProductsPage.tsx` → `src/components/Card.tsx`

**Was the classification right? Tick one option:**
- [ ] I agree with the classification
- [ ] I disagree: the PR changed existing behavior
- [ ] I disagree: the PR was isolated and farol missed it

</details>

<details>
<summary>Manual test checklist (2)</summary>

- [ ] `/` (via Card.tsx)
- [ ] `/products` (via Card.tsx)

</details>

<sub>farol 0.1.0 · analyzed commit 0123456789ab · shadow mode</sub>
