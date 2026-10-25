# SoundCloud saved playlists in music panel

Goal: User chose free SoundCloud integration by saving public playlist links once and playing them directly in RICK_DEV OS, alongside a Spotify tab in the existing panel.
Architecture: Keep Spotify panel IDs/PKCE and use the official visible SoundCloud iframe + Widget API for playback. New inline core validates named public URLs and cloud collection key rick-dev-soundcloud; inline music controller manages provider tabs, CRUD of named links, lazy SDK loading and iframe lifecycle. Existing storage/backup adapter, no schema changes or account credentials.
Constraints: No SoundCloud account login, API key, private playlist secret links or autoplay. Only explicit user selection loads external player; actual Play is in native SoundCloud widget. ADM saves/removes; guests can select/play existing entries. Provider switch pauses previous source; failed cross-provider pause prevents overlapping SoundCloud playback. Keep existing Spotify behavior/tests.

- [x] Add failing tests for URLs, saved links, guest rights, provider switching and error cleanup.
- [x] Add core/controller, tab markup and visible official SoundCloud player; register cloud/backups.
- [x] Coordinate pause and hidden polling with Spotify; add tests.
- [x] Run complete suite, inline syntax/DOM validation and independent review.
- [ ] Publish reviewable update and verify live deployment.

Review focus: Stored lists survive reload/backup; malicious/private links rejected; no secret data; no autoplay on page load; SDK or iframe errors retry cleanly; stale loads/callbacks cannot revive discarded player; guest cannot write; no hidden dual playback or Spotify OAuth regressions.

## Verification and review
60 tests passed; 20 inline scripts parsed; DOM IDs/panel nesting/no initial iframe source verified. Independent review identified iframe cache reuse and stale PLAY callbacks; both fixed with fresh iframe instances and generation guards, each regression verified RED to GREEN. Added and verified current Spotify playback query when its tab has not polled, plus provider-switch guard to prevent stale pause checks. No live playlists were seeded or modified.
