# TODO — dashboard branch repair progress

Source of requirements: [TODONEEDFIXES.md](TODONEEDFIXES.md).
This file tracks **what is actually done**, and is updated as work lands.

Legend: `[x]` done & self-verified · `[~]` partial · `[ ]` not started · `[!]` needs a real Epic/FNLB account to verify

Last updated: 2026-09-17

**Test status: 42/42 unit tests pass · 34/34 live API checks pass against a running server.**

---

## Audit findings (bugs confirmed by reading the code)

| # | Bug | Fixed in | Status |
|---|-----|----------|--------|
| 1 | Routes picked the engine from **saved config**, not the running engine → UI could talk to the wrong engine | `runtime/RuntimeManager.js` | [x] |
| 2 | `import FNLB from 'fnlb'` at module top → local fnbr could not start if `fnlb` was broken | `runtime/LegacyFnlbRuntime.js` | [x] |
| 3 | `"fnlb": "latest"` uncontrolled; no lockfile | `package.json` + `package-lock.json` | [x] |
| 4 | `postinstall: npm rebuild sqlite3 --build-from-source` forced a C++ toolchain | `package.json` | [x] |
| 5 | Scheduled restart reused stale `runtime.startConfig` | `RuntimeManager.restart()` | [x] |
| 6 | `acceptFriendRequests` existed but was **never implemented** | `LocalFnbrRuntime` | [x] |
| 7 | `acceptInvites` existed but was **never implemented** | `LocalFnbrRuntime` | [x] |
| 8 | Friend DMs were only logged; no way to send one | `LocalFnbrRuntime` + `FriendMessage` | [x] |
| 9 | Pending requests could not be accepted/declined/cancelled | `LocalFnbrRuntime` | [x] |
| 10 | `privacy` config existed but was never applied | `LocalFnbrRuntime.setPrivacy()` | [x] |
| 11 | `applyCategory()` could fail the whole start | `LocalFnbrRuntime.start()` | [x] |
| 12 | `applyLocalCosmetic()` silently no-opped when offline — UI showed false success | `routes/legacy.routes.js` | [x] |
| 13 | `BotSession.isActive` never set false; `endedAt` never written | `services/sessionHistory.js` | [x] |
| 14 | No `MatchRound` concept | `models/MatchRound.js`, `services/matchTracker.js` | [x] |
| 15 | Session not regenerated on login/register → session fixation | `http/helpers.js` | [x] |
| 16 | No `trust proxy` support | `server.js` (`TRUST_PROXY`) | [x] |
| 17 | Party chat with an empty party threw an unexplained error | `LocalFnbrRuntime` | [x] |
| 18 | No `GET /api/health` | `routes/bots.routes.js` | [x] |
| 19 | No SIGINT/SIGTERM graceful shutdown | `index.js` | [x] |
| 20 | Local disabled state was in-memory only | `localBotEnabled` column | [x] |
| 21 | No Docker files | `Dockerfile`, `docker-compose.yml`, `.dockerignore` | [x] |
| 22 | No tests | `tests/` (42 tests) | [x] |

---

## Project structure (tidied — no more one-giant-file)

```
src/
├── server.js                 167 lines: wiring only (was 1459)
├── http/                     helpers.js, session.js
├── lib/                      paths.js, secrets.js
├── models/                   one file per model + sequelize.js,
│                             associations.js, migrations.js, index.js
├── routes/                   auth, config, quickCommands, bots,
│                             legacy, uploads, admin  (*.routes.js)
├── runtime/                  BaseRuntime, LocalFnbrRuntime,
│                             LegacyFnlbRuntime, RuntimeManager
└── services/                 configStore, sessionHistory, matchTracker,
                              fnlbApi, fortniteItems, replayParser, mailer
```

`models.js` (618 lines) is now 14 focused files. `server.js` (1459 lines) is now 7 route
modules plus a 167-line wiring file.

---

## Done

### Architecture
- [x] Runtime adapters with a common interface; unsupported ops throw HTTP 501 rather than doing nothing
- [x] `configuredMode` / `activeMode` / `restartRequired` / `restartReason` tracked separately
- [x] Routes resolve the **active** adapter via `runtime.requireActive()`
- [x] Switching engine while online sets `restartRequired` instead of swapping the runtime — *covered by a regression test*
- [x] Lazy `await import('fnlb')` isolated to the legacy adapter
- [x] Honest per-engine `getCapabilities()`
- [x] Auto-restart reloads config from the database and rebuilds the adapter

### Local fnbr (verified against installed **fnbr 4.3.1** typings, not old examples)
- [x] Auto-accept friend requests, direction re-checked so outgoing are never mistaken for incoming
- [x] Auto-accept party invites with expired/full/private errors reported
- [x] Party privacy live via `Enums.PartyPrivacy`
- [x] Startup loadout failures no longer abort the start
- [x] Realtime cosmetics confirmed by the runtime **before** the UI is told; real error text on rejection
- [x] "Equip Now" separated from "Save as Startup Loadout" (`applyNow` / `saveDefault`)
- [x] Friend DMs send + receive, persisted, pushed over Socket.IO
- [x] Accept/decline/cancel, block/unblock, invite, join, kick, promote
- [x] Ready / unready / sit out / playlist / fill / hide members — all live, no restart
- [x] Leader-only actions return `Requires Party Leader`
- [x] Party chat while alone returns a useful 409
- [x] Staged startup logging; credentials never logged
- [x] `Authentication Required` state + `Clear Device Auth` endpoint

### Data & history
- [x] `FriendMessage` + `MatchRound` models; `localBotEnabled` migration
- [x] Match rounds open on `lobby → in_match`, close on return; multiple rounds per `BotSession`
- [x] `match:started` / `match:ended` / `match:updated` events
- [x] Sessions closed on stop/restart/shutdown; orphans closed at boot
- [x] Match stats stay `null` unless a replay or manual entry supplies them; `source` records origin

### API
- [x] Generic endpoints: `/api/dashboard`, `/api/bots`, `/api/bots/:botId/{friends,blocked,party,cosmetics,matches}`, friend accept/decline/block/unblock/messages, `/api/users/search`, `/api/bot/restart`, `/api/health`
- [x] Legacy `/api/fnlb/*` kept working

### Frontend (minimal, high-value only)
- [x] "Configuration changed / Restart required" banner with a Restart Now button
- [x] "Authentication Required" banner with Clear Device Auth
- [x] `usingLocalFnbr()` follows the **active** engine, not the saved config
- [x] Equip toast only claims a live change when the runtime confirmed one

### Ops & security
- [x] `fnbr` 4.2.0 → **4.3.1**, every method re-verified against its typings
- [x] `fnlb` pinned `^1.1.14`; lockfile present for `npm ci`
- [x] Forced sqlite3 source build removed
- [x] Session regeneration on login and register
- [x] `TRUST_PROXY` support (documented in `.env.example`); `APP_URL` for reset links
- [x] Graceful SIGINT/SIGTERM shutdown in the correct order
- [x] Docker: Node 22 slim, non-root, healthcheck on `/api/health`, `/app/data` volume

---

## Verification actually performed

| What | How | Result |
|------|-----|--------|
| Unit tests | `npm test` (42 tests, mocked adapters, no network) | **42/42 pass** |
| Live API | server booted on a clean DB, 34 scripted checks | **34/34 pass** |
| Engine desync | regression test: start fnbr → save fnlb → assert active stays fnbr | **pass** |
| Cosmetic failure | fake client rejects `setOutfit`; assert no success + no event | **pass** |
| Secret leakage | asserted config responses omit apiToken/deviceAuth/authorizationCode | **pass** |
| Offline routing | 5 runtime routes return 409, never 500 | **pass** |
| fnbr API surface | every method checked against `node_modules/fnbr` 4.3.1 `.d.ts` | **confirmed** |
| Module loading | every module imported cleanly after the restructure | **pass** |

---

## Not done
- [ ] Frontend Friends / Messages / Lobby / Matches **pages** — the backend and Socket.IO events are ready, but `public/app.js` still has the original single dashboard view
- [ ] README rewrite

## Deferred, with reasons
- [ ] **Live FNLB cosmetics** — no verified FNLB live-cosmetic command exists and the task says not to guess command names. The adapter reports `realtimeCosmetics: false` and returns `appliedLive: false` + `requiresReload: true` rather than pretending.
- [ ] **Multi-account local bots** (`LocalBotAccount`) — the adapter layer leaves room for it; deliberately not built before one local bot is stable.

## Could NOT be verified here
- [!] Anything needing a real Epic account: device auth round-trip, live cosmetic equip in-game, real friends/party/match transitions
- [!] Anything needing a real FNLB API token
- [!] `docker compose build` — Docker is not installed in this environment, so the Dockerfile is **unbuilt and unverified**
- [!] A real SIGTERM shutdown — Windows does not deliver POSIX signals to child processes; the shutdown path is covered by unit tests instead
