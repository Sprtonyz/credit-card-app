# Macq and Macquerie Problem

## Goal

This document captures the investigation into the bug where **Macquarie** and **Macqbill** sometimes accumulate amount they should not when assigning transactions to **Tony** or **Nugs**.

No fix was implemented during the investigation. This document is intended to support implementation later in the correct environment.

---

## Reported bug

When assigning a transaction to Tony or Nugs, sometimes the amount appears to be:

- partially counted toward **Macquarie**
- partially counted toward **Macqbill**
- or visually looks split/halved when it should not be

The issue appears to affect tally accumulation rather than just a display label.

---

## Main finding

The most likely root cause is **not** in the Macquarie excess calculation itself.

The likely root cause is in:

- `utils/reconciliation.js`
  - `getAssigneeContributionRatio`

That function can assign tally contribution to Macquarie/Macqbill **before the submission is actually resolved**.

---

## Relevant code paths

## 1. Contribution calculation

File:

- `utils/reconciliation.js`

Relevant function:

- `getAssigneeContributionRatio(submission, assignee, referenceDateKey, users)`

This is the key place where tally contribution gets decided.

---

## 2. Dashboard tally accumulation

File:

- `utils/creditCardAppData.js`

Relevant function:

- `buildDashboardMetrics(...)`

This function loops through submissions and accumulates totals into:

- `userTallies`
- `assigneeTotals`

Important lines conceptually:

- it calls `getAssigneeContributionRatio(...)`
- if ratio > 0, it adds `transaction.amount * contributionRatio`

So if contribution logic is wrong upstream, totals here will also be wrong.

---

## 3. UI display

File:

- `components/CreditCardApp.jsx`

Relevant values:

- `macTally = dashboardMetrics.assigneeTotals.Macquarie || 0`
- `macqbillTally = dashboardMetrics.assigneeTotals.Macqbill || 0`

This means the UI is faithfully rendering the computed totals. The display layer does not look like the primary source of the bug.

---

## 4. Derived Macquarie excess

File:

- `utils/macquarieExcess.js`

This logic computes excess above the threshold and allocates derived shares to users.

The investigation result was:

- this file looks internally consistent
- it is more likely **downstream of the real bug**
- if the raw Macquarie tally is wrong, excess-share output will also look wrong

---

## Why the bug happens

## The problematic logic

Inside `getAssigneeContributionRatio`, there is a branch that handles **current-day submissions**.

It effectively does this:

1. collect all live picked values for the users
2. remove duplicates
3. ignore `Unsure`
4. return the **maximum contribution ratio** for the requested assignee across those live values

That means unresolved live selections can still contribute to tallies.

---

## Example scenario

Suppose the same transaction currently has:

- Tony picked `Tony`
- Nugs picked `Macqbill`

The submission is not actually resolved in a stable final sense, but the function still inspects both live values.

For the assignee `Tony`:

- `Tony` contributes ratio `1`

For the assignee `Macqbill`:

- `Macqbill` contributes ratio `1`

So the transaction can contribute to **both tallies simultaneously**.

That is the likely source of “Macquarie/Macqbill accumulates when it shouldn’t”.

---

## Why it can look like a half/split amount

There are two layers in play:

1. **raw tally contribution**
   - from `getAssigneeContributionRatio`
   - used by `buildDashboardMetrics`

2. **derived Macquarie excess share**
   - from `utils/macquarieExcess.js`
   - layered on top in the UI

If the raw Macquarie tally is already wrong because unresolved submissions are being counted too early, the derived excess-share layer can make the end result look like:

- a split
- a half
- a strange partial allocation

So the “half” symptom is likely a **secondary appearance** caused by the first bug.

---

## Why this is probably not just a UI bug

The UI is reading:

- `dashboardMetrics.assigneeTotals.Macquarie`
- `dashboardMetrics.assigneeTotals.Macqbill`

Those values are produced before rendering.

That means the issue is likely:

- **business logic**
not
- **presentation only**

---

## Evidence from existing tests

File:

- `scripts/verify-reconciliation.mjs`

There is already evidence in the reconciliation tests that unresolved situations are intended to contribute **zero**.

Relevant section:

- unresolved post-fix cross-day assignments are expected to return `0` contribution

This is important because it suggests the current-day unresolved branch is inconsistent with the broader intended tally behavior.

---

## Best current hypothesis

The intended behavior should likely be:

- unresolved current-day mixed picks -> contribute **0**
- only resolved assignments should contribute to final tallies

But the current implementation instead allows live current-day picks to influence totals immediately by taking the max ratio across all active picks.

That is the strongest candidate for the bug.

---

## Suggested implementation direction later

When back in the correct environment, focus first on:

- `utils/reconciliation.js`
  - `getAssigneeContributionRatio`

### Likely change area

Review and possibly change the `hasCurrentDaySubmission` branch so that unresolved live submissions do **not** contribute to:

- `Tony`
- `Nugs`
- `Macquarie`
- `Macqbill`

until they are in the appropriate resolved state.

---

## Validation plan in the correct environment

## 1. Run the reconciliation tests

At minimum:

```bash
node ./scripts/verify-reconciliation.mjs
```

If available through npm:

```bash
npm run test:reconciliation
```

Then run the broader suite if needed:

```bash
npm test
```

---

## 2. Reproduce the bug manually

Use a transaction that is easy to identify and check the tallies while changing assignments.

### Suggested scenarios

#### Scenario A: mixed live picks

1. Tony picks `Tony`
2. Nugs picks `Macqbill`
3. Observe:
   - Tony tally
   - Nugs tally
   - Macquarie tally
   - Macqbill tally

Expected for a correct fix:

- unresolved mixed picks should not prematurely contribute to Macquarie/Macqbill totals

#### Scenario B: mixed live picks with Macquarie

1. Tony picks `Tony`
2. Nugs picks `Macquarie`
3. Observe tallies again

Expected for a correct fix:

- no premature Macquarie accumulation unless the submission state is actually meant to count

#### Scenario C: both users resolve to Tony

1. Tony picks `Tony`
2. Nugs picks `Tony`
3. Confirm:
   - Tony gets full intended contribution
   - Macquarie and Macqbill do not accumulate

#### Scenario D: both users resolve to Macqbill

1. Tony picks `Macqbill`
2. Nugs picks `Macqbill`
3. Confirm:
   - Macqbill gets the intended contribution
   - Tony/Nugs do not incorrectly keep residual tally

---

## 3. Check the raw numbers, not only UI appearance

When validating, inspect both:

1. what the UI shows
2. what `dashboardMetrics.assigneeTotals` contains

If possible, temporarily log or inspect:

- `dashboardMetrics.assigneeTotals`
- `dashboardMetrics.userTallies`
- `getAssigneeContributionRatio(...)` return values for the active transaction

This will confirm whether the bug is fixed at the logic layer rather than just masked visually.

---

## 4. Validate Macquarie excess separately

After fixing the primary tally bug, also verify:

- `macTally` only reflects legitimate Macquarie assignments
- `buildMacquarieExcessShares(...)` now produces sensible values
- user-side excess additions no longer create confusing split-like artifacts

This is important because excess-share calculations can look wrong even when they are only reacting to wrong upstream totals.

---

## 5. Regression cases to test

After a future fix, validate:

1. Tony-only assignments
2. Nugs-only assignments
3. Split assignments
4. Macquarie assignments
5. Macqbill assignments
6. Unsure assignments
7. same-day unresolved submissions
8. older locked/resolved submissions
9. tally breakdown modal
10. statement-cycle filtered totals

---

## Recommended next implementation steps

When back in the right environment:

1. write a targeted failing test in `scripts/verify-reconciliation.mjs` for a same-day mixed live assignment involving Tony/Macqbill or Tony/Macquarie
2. update `getAssigneeContributionRatio(...)`
3. rerun reconciliation tests
4. manually verify main-app tallies
5. confirm Macquarie excess output still behaves correctly

---

## Environment limitation during this investigation

This environment did not have:

- `node`
- `npm`

So the investigation was done through static code tracing only. The next step is to reproduce and verify behavior in the proper runtime environment before implementing a fix.
