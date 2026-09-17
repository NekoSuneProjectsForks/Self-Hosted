# TODO — dashboard branch repair progress

Source of requirements: [TODONEEDFIXES.md](TODONEEDFIXES.md).
This file tracks **what is actually done**, and is updated as work lands.

Legend: `[x]` done & self-verified · `[~]` partially done · `[ ]` not started · `[!]` needs a real Epic/FNLB account to verify

Last updated: 2026-09-17

---

## Audit findings (bugs confirmed by reading the code)

| # | Bug | Fixed in | Status |
|---|-----|----------|--------|
| 1 | Routes picked the engine from **saved config**, not the running engine → UI could talk to the wrong engine after a config change | `src/runtime/RuntimeManager.js`, `src/server.js` | [x] |
| 2 | `import FNLB from 'fnlb'` at module top → local fnbr could not start if `fnlb` was broken | `src/runtime/LegacyFnlbRuntime.js` | [x] |
| 3 | `"fnlb": "latest"` uncontrolled; no lockfile | `package.json`, `package-lock.json` | [x] |
| 4 | `postinstall: npm rebuild sqlite3 --build-from-source` forced a C++ toolchain | `package.json` | [x] |
| 5 | Scheduled restart reused stale `runtime.startConfig` | `RuntimeManager.restart()` | [x] |
| 6 | `acceptFriendRequests` existed but was **never implemented** | `LocalFnbrRuntime` | [x] |
| 7 | `acceptInvites` existed but was **never implemented** | `LocalFnbrRuntime` | [x] |
| 8 | Friend DMs were only logged; no way to send one | `LocalFnbrRuntime`, routes, `FriendMessage` | [x] |
| 9 | Pending friend requests could not be accepted/declined/cancelled | `LocalFnbrRuntime` | [x] |
| 10 | `privacy` config existed but party privacy was never applied | `LocalFnbrRuntime.setPrivacy()` | [x] |
| 11 | `applyCategory()` could fail the whole start | `LocalFnbrRuntime.start()` | [x] |
| 12 | `applyLocalCosmetic()` silently no-opped when offline — UI showed false success | cosmetics route | [x] |
| 13 | `BotSession.isActive` never set false; `endedAt` never written | `sessionHistory.js` | [x] |
| 14 | No `MatchRound` concept | `models.js`, `matchTracker.js` | [x] |
| 15 | Session not regenerated on login/register → session fixation | `src/server.js` | [x] |
| 16 | No `trust proxy` support | `src/server.js` (`TRUST_PROXY`) | [x] |
| 17 | Party chat with an empty party threw an unexplained error | `LocalFnbrRuntime.sendPartyMessage()` | [x] |
| 18 | No `GET /api/health` | routes | [x] |
| 19 | No SIGINT/SIGTERM graceful shutdown | `index.js` | [x] |
| 20 | Local disabled state was in-memory only | `localBotEnabled` column | [x] |
| 21 | No Docker files | — | [ ] |
| 22 | No tests | — | [ ] |

---

## Done so far

### Architecture
- [x] Runtime adapters: `src/runtime/BaseRuntime.js`, `LocalFnbrRuntime.js`, `LegacyFnlbRuntime.js`, `RuntimeManager.js`
- [x] `configuredMode` / `activeMode` / `restartRequired` / `restartReason` tracked separately and exposed via `/api/bot/status`
- [x] Routes resolve the **active** adapter (`runtime.requireActive()`), never the saved config
- [x] Switching engine while online sets `restartRequired: true` instead of swapping the runtime underneath the user
- [x] Lazy `await import('fnlb')` isolated to the legacy adapter only
- [x] Honest per-engine `getCapabilities()`; unsupported operations throw HTTP 501 instead of doing nothing
- [x] Auto-restart reloads config from the database and rebuilds the adapter

### Local fnbr (verified against installed **fnbr 4.3.1** typings, not old examples)
- [x] Auto-accept incoming friend requests, direction re-checked so outgoing are never treated as incoming
- [x] Auto-accept party invites with expired/full/private/already-joined errors reported
- [x] Party privacy applied live via `Enums.PartyPrivacy` presets
- [x] Startup loadout failures no longer abort the whole start
- [x] Realtime cosmetics: equip confirmed by the runtime **before** the UI is told, real error text on rejection
- [x] "Equip Now" separated from "Save as Startup Loadout" (`applyNow` / `saveDefault`)
- [x] Friend DMs send + receive, persisted to `FriendMessage`, pushed over Socket.IO
- [x] Accept / decline / cancel pending requests, block / unblock, invite, join, kick, promote
- [x] Ready / unready / sit out / playlist / fill / hide members — all live, no restart
- [x] Leader-only actions return `Requires Party Leader` instead of a cryptic Epic error
- [x] Party chat while alone returns a useful 409, not a 500
- [x] Staged startup logging; credentials never logged
- [x] Auth failure surfaces `Authentication Required` + `Clear Device Auth` endpoint

### Data & history
- [x] `FriendMessage` and `MatchRound` models + migration for `localBotEnabled`
- [x] Match rounds opened on `lobby → in_match`, closed on return, multiple rounds per `BotSession`
- [x] `match:started` / `match:ended` / `match:updated` socket events
- [x] Sessions closed on stop/restart/shutdown; orphaned sessions and rounds closed at boot
- [x] Match stats stay `null` unless a replay or manual entry supplies them; `source` records origin

### API
- [x] Generic endpoints: `/api/dashboard`, `/api/bots`, `/api/bots/:botId/{friends,blocked,party,cosmetics,matches}`, `/api/bots/:botId/friends/:friendId/{accept,decline,block,unblock,messages}`, `/api/users/search`, `/api/bot/restart`, `/api/health`
- [x] Legacy `/api/fnlb/*` routes kept working for the existing frontend

### Ops & security
- [x] `fnbr` upgraded 4.2.0 → **4.3.1** and every method re-verified against its typings
- [x] `fnlb` pinned to `^1.1.14`; `package-lock.json` present for `npm ci`
- [x] Forced sqlite3 source build removed
- [x] Session regeneration on login and register
- [x] `TRUST_PROXY` support; `APP_URL` already used for reset links
- [x] Graceful SIGINT/SIGTERM shutdown in the correct order

---

## In progress
- [~] **Modularising `src/server.js`** — routes being split into `src/routes/*` so no single file carries everything

## Not started
- [ ] Docker (`Dockerfile`, `docker-compose.yml`, `.dockerignore`)
- [ ] Tests with mocked fnbr/FNLB adapters
- [ ] Frontend: Friends / Messages / Lobby / Matches views (backend is ready; `public/app.js` not yet rewired)
- [ ] README rewrite

## Deferred, with reasons
- [ ] **Live FNLB cosmetics** — no verified FNLB live-cosmetic command exists and the task says not to guess command names. The adapter therefore reports `realtimeCosmetics: false` and returns `appliedLive: false` + `requiresReload: true` rather than pretending it applied.
- [ ] **Multi-account local bots** (`LocalBotAccount`) — adapter layer leaves room for it; deliberately not built before one local bot is stable.

## Cannot be verified here
- [!] Anything needing a real Epic account: device auth round-trip, live cosmetic equip, real friends/party/match transitions
- [!] Anything needing a real FNLB API token
