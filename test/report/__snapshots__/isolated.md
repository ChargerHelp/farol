<!-- farol -->
### farol · PR reading (shadow mode)

Signals computed on the lines this PR changes. farol only informs: it never approves or blocks.

- **Review:** ✓ fast track — only new code, tests or low-risk changes; nothing existing is widely affected; diff coverage not verified: risk is counted as if nothing were tested
- **Merge risk score:** 8/100 (low; higher is riskier)
- **Risk:** 0 high, 0 medium, 4 low
- **Vulnerabilities in added or changed dependencies:** not verified
- **Diff coverage:** not verified
- **Lint on changed lines:** not verified
- **Added suppressions:** none
- **Modified existing tests:** none

<details>
<summary>Classification — open only after reviewing</summary>

**Class:** `isolated` — isolated: only adds new paths (new routes and files)

**Reasons:**
- new route (`route-added`) `src/routes.tsx`: /reports (/reports) renders src/pages/ReportsPage.tsx
- routes only added (`routes-additive`) `src/routes.tsx`: every existing route is unchanged and no line was removed
- new file used only by new routes (`new-file-in-new-route`) `src/components/reports/ReportChart.tsx`: reached only by new route(s): /reports
- new file used only by new routes (`new-file-in-new-route`) `src/components/reports/ReportTable.tsx`: reached only by new route(s): /reports
- new file used only by new routes (`new-file-in-new-route`) `src/pages/ReportsPage.tsx`: reached only by new route(s): /reports
- no existing code touched (`no-existing-code-touched`): the PR only adds new files, routes, exports or keys, or changes tests

**New routes:**
- `/reports` → `src/pages/ReportsPage.tsx`

**Affected existing routes:** none

**Was the classification right? Tick one option:**
- [ ] I agree with the classification
- [ ] I disagree: the PR changed existing behavior
- [ ] I disagree: the PR was isolated and farol missed it

</details>

<details>
<summary>Manual test checklist (1)</summary>

- [ ] new: `/reports` (renders ReportsPage.tsx)

</details>

<sub>farol 0.1.0 · analyzed commit 0123456789ab · shadow mode</sub>
