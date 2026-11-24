---
name: final-review
description: Use when implementation is complete and ready for comprehensive PR review with parallel code review agents, testing, and merge preparation
---

# Final Review - Comprehensive PR Review & Testing

## Step 0: Determine Review Pass

Before starting, check the git history to determine if this is a follow-up review:

```bash
git log -10 --format=%B | grep -i "Co-Authored-By: Claude"
```

- **First pass**: No recent Claude co-authored commits on this branch, or the Claude commits are from a different feature.
- **Follow-up pass**: Recent Claude co-authored commits exist from a previous `/final-review` run on this same feature.

If this is a follow-up pass:
- Note this in the summary as "Review Pass #2" (or #3, etc.)
- Tell the review agents to check git history to understand WHY recent changes were made before suggesting reversals
- Be more conservative with changes - the previous pass already applied significant improvements
- Focus agents on catching issues introduced BY the previous review, not re-litigating decisions already made

## Step 1: Create or Update the PR

First, check which branch you're on:
- **If on `main`**: Create a new feature branch using the repo convention `<author>/<linear-id>-<slug>` (e.g., `alex/eng-123-add-user-metrics`, `sam/eng-456-fix-dashboard-loading`), then commit the changes to that branch.
- **If already on a feature branch**: Continue with existing branch.

Then handle the PR:
- If a PR doesn't exist for this branch, create one with a clear title and description summarizing the changes.
- If a PR already exists, do not push uncommitted changes yet. The review and tests below check them first; Step 5 commits and pushes only the changes you intend to ship.

## Step 2: Launch Three Review Agents in Parallel

Launch these three review agents in parallel.

**Important context for all agents**: If this is a follow-up pass, include in each agent's prompt:
- "Check git log to see recent commits and their messages before making recommendations"
- "If a pattern looks intentional based on recent commit messages, don't recommend reversing it without strong justification"
- "Focus on issues that may have been INTRODUCED by recent changes, not re-reviewing the entire file"

### Agent 1: Codebase Consistency Reviewer
Review the code changes with these focuses:
- Are we duplicating logic that already exists elsewhere in the codebase? Search for similar patterns, helper methods, or services that we should be using instead.
- Are there other places in the codebase with similar situations where this same logic/fix should be applied? We don't want inconsistency.
- Check for opportunities to consolidate with existing utilities, concerns, or services.

### Agent 2: SOLID & Clean Code Reviewer
Review the code changes through the lens of Uncle Bob's Clean Code principles:
- Single Responsibility: Are classes/methods doing one thing?
- Open/Closed: Can we extend without modifying?
- Look for opportunities to replace conditionals with polymorphism or strategy patterns
- Identify deeply nested if statements that could be flattened or extracted
- Flag long methods that should be decomposed
- Check for proper abstraction levels

### Agent 3: Defensive Code Auditor
Review for overly defensive code that could hide real issues:
- Catch/rescue blocks that swallow errors silently
- Fallback values that mask null/nil errors we'd want to know about
- Optional chaining (`?.` / `&.`) that hides broken assumptions
- Empty array/object fallbacks that hide missing data
- Conditional checks that prevent useful errors from being raised
- Any pattern that would make debugging harder in production

## Step 3: Reconcile and Apply Fixes

When the three agents return their recommendations:

1. **Apply most recommendations** - If you're on the fence, lean toward doing it. Base the decision on scope, impact, and ownership. Don't dismiss useful improvements as "out of scope" unless they would meaningfully expand the change or require separate coordination.

2. **Handle conflicts intelligently** - If Agent 1 says "use existing method X" and Agent 2 says "extract to new method Y", prefer using existing code (Agent 1) to keep the codebase DRY.

3. **Track what you skip** - Only skip if you're genuinely confident it's wrong for this codebase. Note these for the summary.

4. **On follow-up passes, aim for convergence** - If agents are only finding minor issues or suggesting stylistic preferences, note this in the summary. The goal is to converge, not to endlessly refactor. If changes from this pass are minimal, recommend that the user proceed without another review pass.

## Step 4: Comprehensive Testing

farol is a TypeScript CLI built with npm. Run ALL of these steps.

**4a. Type Checking**
```bash
npm run typecheck
```

**4b. Linting & Tests**
```bash
npm run lint
npm test
```
`UPDATE_GOLDEN=1 npm test` rewrites `test/fixtures/*/expected.json`. Use it only for an output change you intend, and review every golden diff by hand.

**4c. Build Verification**
```bash
npm run build
```
`dist/` is committed. Rebuild it before you commit source changes, and commit `dist/cli.js` with them.

**4d. Real Repository Check**
If the change alters what farol reports, run the old and the new build on a real repository, read-only (for example, a local clone in a scratch folder), and compare the output (`farol routes`, `farol analyze`). Never run code of the analyzed repository.

## Step 5: Push Final Changes

After all fixes and tests pass, commit and push the changes to the PR.

## Step 6: Final Summary

Provide a summary with these sections:

### Review Pass
- State which pass this is (e.g., "Review Pass #1" or "Review Pass #2")
- If follow-up pass, briefly note what the previous pass addressed

### Changes Applied
- List the recommendations you implemented from each agent

### Recommendations Skipped
- For each skipped item, explain WHY you decided not to do it

### Test Coverage
- Which tests/type checks/builds passed
- What was verified via runtime checks (rails runner, build output, etc.)

### Unable to Test
- List anything that couldn't be tested and why
- Explain what you'd want me to manually verify

### Another Pass Needed?
- If this pass made substantial changes (new classes, significant refactoring), recommend running `/final-review` again
- If changes were minor (small tweaks, style fixes), recommend proceeding to merge
- Be honest: "This pass was substantial - I'd recommend one more review" or "Changes were minimal - ready to merge"
