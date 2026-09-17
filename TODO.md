# TODO — dashboard branch repair progress

Source of requirements: [TODONEEDFIXES.md](TODONEEDFIXES.md).
This file tracks **what is actually done**, and is updated as work lands.

Legend: `[x]` done & self-verified · `[~]` partial · `[ ]` not started · `[!]` needs a real Epic/FNLB account to verify

Last updated: 2026-09-17

**Test status: 54/54 unit tests · 34/34 live API checks · 22/22 frontend render checks — all pass.**

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

## Frontend (done)
- [x] `public/app.js` (1651 lines) split into `public/js/` modules: `core/`, `data/`, `views/`, `actions.js`, `app.js`
- [x] **Lobby** page — live party, members, cosmetics, match state; ready/unready, sit out, fill, hide, privacy, playlist, presence, invite, kick, promote, leave; leader-only actions labelled
- [x] **Friends** page — online/offline/incoming/outgoing/blocked with a detail panel; add, accept, decline, cancel, remove, block, unblock, invite, join
- [x] **Messages** page — DM threads with unread counts, kept separate from lobby chat
- [x] **Matches** page — current match + history; blank stats where no source supplied them
- [x] Socket.IO wired for targeted updates (`friend:message`, `party:updated`, `match:*`, `cosmetics:updated`) — no full dashboard reload per event
- [x] Controls hidden/disabled from the engine capability report
- [x] README rewritten

## Deferred, with reasons
- [ ] **Live FNLB cosmetics** — still deferred. The `fnlb` package only starts/stops/updates processes (verified in its typings) and no live cosmetic command is exposed; an attempt to consult the hosted FNLB docs did not yield a verifiable command list. Guessing is explicitly ruled out by the task, so the adapter reports `realtimeCosmetics: false` and returns `appliedLive: false` + `requiresReload: true`.
- [ ] **Multi-account local bots** (`LocalBotAccount`) — the task says to architect for it but not to build it before one local bot is stable. The adapter layer supports it (one adapter instance per account, `RuntimeManager` already keys by user), so adding it is additive. No unused model was committed.

## Legacy FNLB adapter gap (reported: "does not support declining friend requests")
- [x] **Root cause**: the FNLB adapter only overrode a handful of methods, so `addFriend`, `acceptFriend`, `declineFriend`, `removeFriend`, `blockUser`, `unblockUser`, `inviteUser`, `joinParty`, `kickMember`, `leaveParty`, `setStatus`, `setPlaylist`, `setReadiness` and `hideMembers` all inherited `BaseRuntime`'s "unsupported" throw. Most of the Friends page and Lobby controls were dead in FNLB mode — a regression from the adapter refactor.
- [x] Implemented all of the above on top of the **already-verified** `FNLB_COMMANDS` map — no command name was invented
- [x] Accept ↔ `add_friend`, decline/cancel ↔ `remove_friend`, per Epic's single endpoint pair (confirmed in fnbr's `FriendManager` source and docblocks)
- [x] Routes now pass `botId` to every adapter call — FNLB needs it to target a bot, and it was being dropped
- [x] `friendRequests` capability flipped to `true` for FNLB in both the adapter and the offline capability map
- [x] Guard added: an FNLB cosmetic write without a caller-built config previously would have PATCHed the category with `config: undefined` and **wiped the saved loadout** — now refused with a clear message
- [x] Still honestly unsupported on FNLB: friend DMs, party privacy, promote, sit out, squad fill, realtime cosmetics, match tracking
- [x] New test suite `tests/legacyFnlbRuntime.test.js` (12 tests) covering the command mapping and the refusals

## Deployment fixes (Pterodactyl crash)
- [x] `engines: { node: ">=22" }` and a fail-fast startup check with a readable message — `connect-session-sequelize` 8 requires Node 22, the host was on the `nodejs_20` yolk
- [x] Clear, actionable error when the `sqlite3` native binding is missing or blocked by npm's allow-scripts policy, instead of a bare exit 1
- [x] Fixed `rootDir` regression from the restructure — `src/lib/paths.js` resolved the project root one level short, breaking static file serving and the default `data/` location

## Could NOT be verified here
- [!] Anything needing a real Epic account: device auth round-trip, live cosmetic equip in-game, real friends/party/match transitions
- [!] Anything needing a real FNLB API token
- [!] `docker compose build` — Docker is not installed in this environment, so the Dockerfile is **unbuilt and unverified**
- [!] A real SIGTERM shutdown — Windows does not deliver POSIX signals to child processes; the shutdown path is covered by unit tests instead
