# RICK_STYLE purchase status and Finance progress

Goal: User can mark existing/new clothing products purchased or not purchased; purchased products contribute to RICK_FINANCE progress.
Architecture: Optional purchased boolean normalized to false for legacy style records, never rewrite data on load. Checkbox on product cards and in form, shared cloud storage and backup validation. Show style bought count, spent and own progress; aggregate PC + style item counts in an independent Finance progress renderer. Reuse existing Home finance ring and login pc cache key, updating labels to RICK_FINANCE.
Scope: Preserve products, prices, links and existing PC purchases. Count-based percentage, reversible status. No database writes from development or seeded products.

- [x] Add failing legacy normalization, status persistence, edit and permission tests.
- [x] Implement optional purchased validation/default, summarize, checkbox controls and style metrics.
- [x] Add Finance combined progress and connect existing Home/login progress without observer loops.
- [x] Run complete suite, inline syntax and DOM checks; review.
- [ ] Publish authorized change through reviewable PR and verify live deployment.

Review focus: Existing saved records/backups accepted; malformed status rejected; toggle/edit preserve all fields and unrelated products; guest cannot write; combined progress updates on both PC and style counts, including zero and unmark; login cache remains compatible.

Validation: 40 tests passed, 18 inline scripts parsed, DOM IDs checked. Independent review approved without critical or important findings. Existing products are normalized in memory only until an explicit user edit/toggle.
