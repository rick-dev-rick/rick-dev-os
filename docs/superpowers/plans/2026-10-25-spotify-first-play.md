# Spotify first play Implementation Plan

**Goal:** Start Spotify playback from RICK_DEV OS without first opening an official client.
**Architecture:** Preserve remote controls for an existing playback device. Add a lazy Web Playback SDK device named RICK_DEV OS for cold starts, activated only by an explicit play click. Use last source or recently played track when no Spotify queue exists. Allow an explicit track/playlist link as a fallback.
**Tech Stack:** Existing vanilla JavaScript, OAuth PKCE, Spotify Web Playback SDK, node:test.
**Spec:** User authorized automatic implementation on 2026-10-25; Premium confirmed.

## Constraints
- Preserve PKCE state validation and refresh-token handling; no client secret.
- Request streaming, user-read-email, user-read-private and user-read-recently-played in addition to current scopes; existing authorizations must reconnect once.
- No automatic transfer/play on page load or minimization; disconnect tears down SDK.
- Support browser SDK failures and unavailable history with actionable messages.

## Review Focus
- Missing scopes must preserve current remote playback while offering reconnection.
- First play with no active device must use the browser device id.
- Stale asynchronous initialization must not reconnect after disconnect/account change.
- SDK failures, timeouts and revoked permissions must leave retry possible.
- Existing cover, timeline, pause/skip and PKCE behavior must remain intact.

## Task 1: Browser playback and first play
- [ ] Extend VM harness; add failing tests for cold starts, authorization migration, errors and lifecycle.
- [ ] Implement SDK loading, browser lifecycle, first-play source and requested scopes in spotify-player.js.
- [ ] Add a track/playlist start form and cache version in index.html; style in style.css.
- [ ] Run node --test tests/*.test.cjs and node --check spotify-player.js.
- [ ] Review full diff, publish authorized update and verify deployment.
