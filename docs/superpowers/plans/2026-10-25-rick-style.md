# RICK_STYLE Implementation Plan

**Goal:** Independent RICK_STYLE tab inside RICK_FINANCE with product name, store link, selectable category (camisa/calça/bermuda/acessório/tênis) and BRL value.
**Architecture:** Match existing RICK_FIT tab pattern. Inline core validates product records and integer cents; inline UI renders safe DOM, permits CRUD only for ADM, and uses rickDevStorage. Register rick-dev-style with backup validation and legacy migration; do not seed any purchases or modify database schema.
**Tech Stack:** Existing vanilla HTML/CSS/JS and Supabase state storage; node:test.
**Spec:** User confirmed requested fields and independent tab on 2026-10-25. Automatic implementation and publishing preference carries forward.

## Global Constraints
- Keep RICK_PC and its progress untouched.
- Preserve links for read-only guests; editing requires admin and initialized storage.
- Validate link scheme and decimal BRL input; money stored as nonnegative integer cents.
- Invalid saved data must not be replaced automatically.
- Include style data in cloud snapshots, exports and imports.

## Review Focus
- Guest cannot mutate entries; can navigate tabs and open links.
- Add/edit/delete preserve other items and module data.
- Currency grouping and comma decimals avoid rounding mistakes.
- Dangerous URLs, duplicate identifiers and malformed saved/backup records are rejected.
- Layout remains usable on mobile and keyboard tab controls follow existing behavior.

## Task 1: Core, UI and persistence
- [x] Write failing core and integration tests.
- [x] Add inline rick-style-core and rick-style-tools with CRUD and tab navigation.
- [x] Add finance tab markup and responsive styles.
- [x] Register backup validation and migration key.
- [x] Run full node test suite; check inline script syntax and diff.
- [ ] Review, publish authorized changes and verify deployment.

## Validation
30 tests passed and all 17 inline scripts parsed. Independent review approved without critical or important findings. Static DOM structure checks passed. Actual browser layout will be checked after publication because the cloud browser cannot access the local preview server.
