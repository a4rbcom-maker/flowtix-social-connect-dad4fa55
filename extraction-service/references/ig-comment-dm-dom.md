# IG mention + DM — live DOM shapes

Captured during implementation of the IG action feature (2026-08-29). IG DOM
shifts silently, so re-run the probes before trusting these selectors:

- `extraction-service/src/debug-ig-comment.ts <igSessionId> <shortcode> [--via-sender]`
- `extraction-service/src/debug-ig-dm.ts <igSessionId> <username> [--via-sender]`

## Comment box (verified baseline, re-confirm before ship)
- selector: `article textarea`, or `article [contenteditable="true"][role="textbox"]`, fallback `div[role="dialog"] textarea`
- it is LAZY-mounted: poll up to 45s, do not `waitForSelector` hard
- publish button text matches /post|نشر|share/i on an `article button`
- type via focus + keyboard.type (no clicks — overlays intercept pointer events)
- positive delivery = the comment text appears in `document.body.innerText`
- post-send restriction banners render only AFTER the write — check twice

## DM composer (verified baseline, re-confirm before ship)
- entry: profile → `a[aria-label*="Message" i]` / `a[aria-label*="رسالة" i]` → click
- composer: `div[contenteditable="true"][role="textbox"]` or `textarea`
- private / non-existent / blocked target → no Message entry → `thread_unavailable` (skipped, not failed)
- positive delivery = the message text appears in the thread view text

## Rate ceilings used (Instagram, live-audited 2026-08-29)
- @mentions per comment: hard ceiling 5 (defaults to 4)
- comment rate: 12–14/hour, 350–400s gap (default 8/h, 380–520s)
- DM cold outreach: 10–20/day new account (default 15/day, 90–240s)
- defaults are kept ~30% under the documented ceiling on purpose

## Pitfalls (do not repeat)
- `page.evaluate` with a function gets `__name` injected by tsx → use a template
  string `(() => { ... })()` instead.
- Old service on :3100 serves stale code — kill by port, grep logs for EADDRINUSE.
- message_jobs is shared FB+IG via `platform`/`mode` columns (defaults keep FB safe).
- Enforce ceilings SERVER-SIDE (ig-actions.ts) — the client can never raise them.
