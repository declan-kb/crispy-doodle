# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"Pit Scout" — an FRC (FIRST Robotics Competition) scouting PWA for team 6996, built for the 2026 game. It's a **no-build, static, four-page app**: plain HTML + vanilla JS ES modules + one shared stylesheet, syncing through Firebase Firestore. There is no `package.json`, no bundler, no framework, no npm dependency tree — everything runs directly in the browser.

## Running it

Must be served over http(s); opening files directly (`file://`) leaves the page blank because module scripts can't import a sibling `.js` from a `file://` origin (each page detects this and shows an `#offline-note`).

```bash
python3 -m http.server 8791
```

A `.claude/launch.json` config named `pit-scout` already runs this on port 8791 — use the browser preview tool with that name rather than shelling out to Bash for it.

There is no lint, build, or test command/framework in this repo.

## The four pages and their ownership boundaries

Each page is self-contained: `<head>` links `style.css`, `<body>` is an empty `#app` div, and a single `<script type="module">` holds everything for that page (state → render → attachHandlers → startup, in that order within the file). `render()` rebuilds all of `#app` from a page-local `state` object, then `attachHandlers()` rebinds listeners — **any new interactive element needs a handler added there.** There's no virtual DOM/diffing; render is a full re-stringify.

- **[index.html](index.html)** — "Scouting Data": the active event's roster, scouted or not; click a team to open/edit its one pit-scouting record. Owns CSV import/export and is the only page that writes `pit-reports`.
- **[pick-list.html](pick-list.html)** — the same roster ranked by EPA or a custom drag order, with do-not-pick/picked marks, for alliance selection. Read-only on `pit-reports`. It is the **one writer** of the EPA/quals-rank cache on the event doc.
- **[schedule.html](schedule.html)** — one team's match schedule plus a per-match preview showing every team's pit report, EPA and quals rank. Read-only on the EPA/quals-rank cache (hydrates from it, then refetches live — never writes it). Navigation state lives in the URL hash (`#team=6996&match=2026ausc_qm11`) so previews are linkable/bookmarkable and Back works.
- **[settings.html](settings.html)** — event admin (create/switch/delete events, load/replace/clear a roster, set the TBA API key). **Not linked from the tab bar** on purpose (it can wipe a roster or switch which event everyone's app shows) — open and bookmark it directly. It's the only page that changes `activeEventId` or the shared TBA key.

Team numbers link across pages as `index.html#team=NNNN` to open that team's scouting form.

All four share [team-list-store.js](team-list-store.js) (Firebase init, Firestore helpers, EPA/roster fetch helpers) and [style.css](style.css) (one stylesheet for all pages — CSS variables in `:root` control the whole theme).

## Data model (Firestore)

Read [team-list-store.js](team-list-store.js)'s header comment for the full rationale; the short version:

- `pit-reports/<team>` — one doc per team, keyed by team number (not scoped to an event — a robot carries between competitions; the report records which event it was collected at and is tagged, not hidden, when that differs from the active event). Written only by `index.html`.
- `settings/event-index` — `{ activeEventId, tbaKey, events: { <id>: {code, label, epaCountry, offseason, createdAt} } }`. Config only, shared across all events, so switching events is cheap. Written only by `settings.html`.
- `settings/event--<id>` — one doc per event: `{ teams, doNotPick, picked, order, epa, qualRank }`. Kept separate per event so switching the active event never clobbers another event's pick list/order.
- `settings/team-list` — legacy pre-multi-event doc, one-time migrated into event id `"legacy"` by `ensureEventIndex()` on first load, then left untouched (rollback stays possible).
- `ALL_TEAMS_EVENT_ID` (`"__all__"`) — a pseudo-event selectable in `settings.html`'s picker: shows every team with a report across all events, not a real event, no config/roster doc of its own.

Firestore writes generally use `setDoc(ref, data, {mergeFields: Object.keys(data)})` rather than `{merge:true}` — this matters because `{merge:true}` deep-merges maps, so deleting a key from `doNotPick`/`picked` would never actually delete it server-side; `mergeFields` replaces each patched top-level field outright. Event-index per-event field edits use `updateDoc` with `FieldPath('events', eventId, key)` instead of a dotted string, because generated event ids contain hyphens.

`firebaseConfig` lives at the top of `team-list-store.js` — that's where a new deployment pastes in its own Firebase project's keys. `isConfigured` gates a "Firebase not configured yet" banner on every page.

## External data sources

- **Statbotics API** (`api.statbotics.io/v3`) — EPA ratings and quals rank for in-season events (`team_events?event=`), or EPA only via `team_years?country=` for offseason/unindexed events.
- **The Blue Alliance API** (`thebluealliance.com/api/v3`) — roster/schedule/rankings fallback, required for offseason events (Statbotics never indexes those) and needs a free Read API key (stored in `settings/event-index.tbaKey`, shared across devices; a locally-saved key is the fallback for a device that hasn't loaded the shared one yet).

`fetchEventStats()` in `team-list-store.js` is the single place that decides which source(s) answer for a given event, and it's designed to **never throw** — a failed source is just left out and named in `errors`, so a partial answer still renders. See its header comment for the exact source-selection logic per event type.

## Notable non-obvious constraints (don't "fix" these)

- **No Firestore on-disk persistence / no `getFirestore(app)`**: `team-list-store.js` deliberately avoids IndexedDB persistence and uses `initializeFirestore` with `experimentalAutoDetectLongPolling: true` instead of the default streaming transport, because Safari/WebKit (i.e. every iOS browser) has long-standing bugs with both that would otherwise leave the app permanently blank on phones at competitions — read the comments there before changing Firestore initialization.
- **`pagehide` calls `firestore.terminate(db)`**: this is a page-per-navigation app, and an abandoned Firestore connection can wedge the *next* page's connection on Safari; don't remove this without understanding why.
- Every page has a `pageLoadWatchdog()` that shows a plain "stuck loading, try reloading" message if `#app` is still empty 5s after load — deliberately not an auto-retry loop, since a retry loop that doesn't fix the underlying issue is worse than an honest error.
- Highlighted teams (`HIGHLIGHT_TEAMS` in `team-list-store.js`, currently `["6996","9976"]`) get a distinct highlight color across all tables via `teamCellClass()` — update that list, not per-page CSS, when the highlighted teams change.
- The PWA manifest (`manifest.json`) plus per-page `apple-mobile-web-app-title` meta tags exist because iOS Safari ignores most of the manifest for "Add to Home Screen" — each page needs its own short title so pinning several doesn't produce identically-labeled icons.
