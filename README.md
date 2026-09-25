# Fortnite Lobby Bot Dashboard

A self-hosted dashboard for running and managing a Fortnite lobby bot in real time.

It supports **two independent engines**:

| | **Local fnbr** (default) | **Legacy FNLB** |
|---|---|---|
| Runtime | `fnbr.js` running in this process | FNLB cloud platform + `fnlb` package |
| Needs an FNLB account/API token | **No** | Yes |
| Needs `fnlb.net` / `api.fnlb.net` | **No** | Yes |
| Multiple bots | One account | Shards / many bots |
| Realtime cosmetics | Yes | No (see [Engine capabilities](#engine-capabilities)) |
| Friend DMs | Yes | No |

The two engines are isolated. The `fnlb` package is imported lazily and only by
the legacy adapter, so **if FNLB is offline, broken or unreachable, local fnbr
mode still starts and runs normally**.

---

## Quick start (Node)

**Requires Node 22 or newer.** `connect-session-sequelize` 8 requires it, and the
app exits immediately with a clear message on anything older. On Pterodactyl,
set the server egg/image to a Node 22+ build (the `nodejs_20` yolk will not work).

```bash
cp .env.example .env
npm ci          # use `npm install` for a first-time setup without a lockfile
npm run build
npm start
```

Then open <http://localhost:3000>. **The first account you register becomes the admin.**

```bash
npm test        # unit tests; no Epic or FNLB account required
```

## Quick start (Docker)

```bash
cp .env.example .env
docker compose build
docker compose up -d
docker compose logs -f
```

The dashboard is on <http://localhost:3000>. Everything persistent lives in the
`./data` volume, so accounts, Epic device auth and configuration survive:

```bash
docker compose down
docker compose up -d
```

The container runs as a non-root user and reports health on `/api/health`.

---

## Configuration

All bot credentials are configured **per user in the dashboard**, not in `.env`.
`.env` only holds process-level settings:

| Variable | Purpose |
|---|---|
| `PORT` / `HOST` | Where the dashboard listens |
| `DATA_DIR` | SQLite database, generated secrets, replays, media |
| `SQLITE_PATH` | Override the database file path |
| `SESSION_SECRET` / `ENCRYPTION_KEY` | Optional; generated into `DATA_DIR` if omitted |
| `COOKIE_SECURE` | Set `true` only when served over HTTPS |
| `TRUST_PROXY` | Set (usually `1`) behind Nginx, Traefik or Cloudflare |
| `APP_URL` | Base URL for password-reset links, instead of the `Host` header |
| `SMTP_*` | Password-reset email; without it, reset links print to the console |

### Reverse proxy

Behind a proxy set both:

```env
TRUST_PROXY=1
COOKIE_SECURE=true
APP_URL=https://dashboard.example.com
```

The dashboard uses WebSockets, so the proxy must forward `Upgrade` and
`Connection` headers for Socket.IO to work.

---

## Epic authentication (local fnbr mode)

Step-by-step walkthrough, from getting the code to getting the bot into your
lobby: **[docs/fnbr-setup.md](docs/fnbr-setup.md)**.

Epic account login uses **device auth**. Email/password is not used, because
Epic normally requires a captcha for it.

First run:

```
One-time authorization code
        ↓
Epic login
        ↓
deviceauth:created
        ↓
Device auth encrypted into SQLite
        ↓
Authorization code deleted
```

Every later start reuses the stored device auth automatically.

- Get a one-time authorization code from Epic, paste it into **Config**, and start the bot.
- The code is single-use, never logged, never returned by any API, and is deleted once device auth exists.
- Device auth secrets are encrypted at rest and are never sent to the browser.

If the stored device auth stops working, the dashboard shows
**Authentication Required** with a **Clear Device Auth** button, instead of a
generic crash. Clear it and sign in again with a fresh authorization code.

---

## What you can do while the bot is online

None of the following require a restart.

**Lobby** — live party view: members, leader, privacy, playlist, party size,
fill state, readiness, sitting out, per-member cosmetics and match state.
Controls for ready/unready, sit out, fill, hide members, privacy, playlist,
presence status, invite, kick, promote and leave. Leader-only actions are
labelled **Requires Party Leader** rather than failing with a cryptic error.

**Friends** — online, offline, incoming requests, outgoing requests and blocked
users, with a detail panel for each person. Add, accept, decline, cancel,
remove, block, unblock, invite and join. Auto-accept of incoming friend requests
is implemented and can be toggled live.

**Messages** — two-way direct messages with friends, stored in the database and
delivered over Socket.IO with unread counts. Lobby chat is kept separate, on the
Lobby page.

**Matches** — a `MatchRound` record is opened when the bot enters a match and
closed when it returns to the lobby, so one bot session contains many rounds.

**Cosmetics** — outfit, backpack, pickaxe, shoes and emote change on the running
bot immediately. "Equip Now" and "Save as Startup Loadout" are separate actions:
saving a default never forces a restart, and equipping is only reported as
successful once the runtime confirms it.

### What is *not* claimed

- Match stats (kills, placement, win) are **not** invented. Epic presence only
  reports *where* the bot is, so those fields stay empty unless a replay upload
  or a manual entry provides them. Every stored value records its `source`.
- This controls what the bot **presents in its lobby** through the supported
  party APIs. It does not modify the Fortnite locker or account inventory.

---

## Engine capabilities

The API reports what the active engine can actually do, and the UI hides or
disables the rest rather than showing a control that silently does nothing.

| Capability | Local fnbr | Legacy FNLB |
|---|---|---|
| Friends list / block list | Yes | Yes |
| Add / remove friends | Yes | Yes |
| Accept / decline friend requests | Yes | Yes |
| Block / unblock | Yes | Yes |
| Friend direct messages | Yes | No |
| Party view and chat | Yes | Yes |
| Invite / join / kick | Yes | Yes |
| Playlist / readiness / hide members | Yes | Yes |
| Sit out / squad fill | Yes | No |
| Party privacy | Yes | No |
| Promote member | Yes | No |
| Realtime cosmetics | Yes | **No** |
| Match tracking | Yes | No |
| Multiple bots | No | Yes |

Accept and decline work on both engines because Epic exposes friendships through
a single endpoint pair — `POST /friends/{id}` sends *or accepts* a request, and
`DELETE /friends/{id}` removes a friend *or declines/cancels a pending one*. The
FNLB adapter maps those onto its existing `add_friend` and `remove_friend`
commands.

**On FNLB and realtime cosmetics:** the `fnlb` package only starts, stops and
updates bot processes, and no verified live cosmetic command exists for the FNLB
API. Rather than guess a command name, cosmetic edits in FNLB mode are saved to
the category and returned with `appliedLive: false` and `requiresReload: true`.
The dashboard says the change applies on the next reload instead of pretending
the running bot changed.

---

## Engine switching and restarts

The dashboard tracks the configured engine and the running engine separately:

- `configuredMode` — what is saved
- `activeMode` — what is actually running
- `restartRequired` — the two disagree, or a process-level setting changed

Changing the engine while a bot is online does **not** swap the runtime
underneath you. It sets `restartRequired` and shows
**Configuration changed / Restart required to switch runtime engine**, with a
Restart button. API routes always talk to the engine that is really running.

Lobby settings (cosmetics, privacy, presence status, auto-accept) apply live.
Only process-level settings (engine, platform, API token, release channel,
category and bot filters, shards,
cluster name, log level) require a restart.

---

## Project layout

```
index.js                    entry point + graceful shutdown
src/
├── server.js               express wiring only
├── http/                   shared helpers, session middleware
├── lib/                    paths, secret encryption
├── models/                 one file per Sequelize model
├── routes/                 auth, config, bots, legacy, uploads, admin
├── runtime/                BaseRuntime + LocalFnbrRuntime, LegacyFnlbRuntime,
│                           RuntimeManager
└── services/               configStore, sessionHistory, matchTracker,
                            fnlbApi, fortniteItems, replayParser, mailer
public/js/
├── app.js                  entry
├── core/                   state, api, socket, ui, selectors
├── data/                   loaders
└── views/                  one file per page
tests/                      unit tests with mocked adapters
```

Adding an engine means implementing `BaseRuntime` and registering it in
`RuntimeManager`; routes and the UI adapt through the capability report.

---

## API

Engine-neutral endpoints; the adapter decides where each call goes.

```
GET    /api/health
GET    /api/dashboard
GET    /api/bots
GET    /api/bots/:botId/friends
POST   /api/bots/:botId/friends
DELETE /api/bots/:botId/friends/:friendId
POST   /api/bots/:botId/friends/:friendId/accept
POST   /api/bots/:botId/friends/:friendId/decline
POST   /api/bots/:botId/friends/:friendId/block
POST   /api/bots/:botId/friends/:friendId/unblock
GET    /api/bots/:botId/friends/:friendId/messages
POST   /api/bots/:botId/friends/:friendId/messages
GET    /api/bots/:botId/blocked
GET    /api/bots/:botId/party
PATCH  /api/bots/:botId/party
POST   /api/bots/:botId/party/messages
PATCH  /api/bots/:botId/cosmetics
GET    /api/bots/:botId/matches
GET    /api/bots/:botId/matches/:matchId
GET    /api/users/search
POST   /api/bot/start | /api/bot/stop | /api/bot/restart
POST   /api/config/device-auth/clear
```

The older `/api/fnlb/*` routes still work for backwards compatibility.

Socket.IO events: `bot:status`, `bot:log`, `bot:updated`, `friends:updated`,
`friend:message`, `party:updated`, `party:message`, `cosmetics:updated`,
`match:started`, `match:updated`, `match:ended`.

---

## Backups and updating

Everything stateful is in `DATA_DIR` (default `./data`): the SQLite database,
the generated encryption key and session secret, replays and media.

```bash
docker compose down          # or stop the node process
cp -r data data-backup-$(date +%F)
```

**Back up `data/encryption.key` together with the database.** Without it the
stored Epic device auth and FNLB tokens cannot be decrypted.

To update:

```bash
git pull
npm ci
npm run build
npm start
```

New database columns are added automatically at startup.

---

## Troubleshooting

**"Authentication Required"** — the stored device auth was rejected. Clear it and
use a new one-time authorization code.

**"No bot runtime is online. Start the bot first." (409)** — a live action was
attempted while the bot was offline. This is deliberate: the dashboard refuses
rather than pretending the action worked.

**"Requires Party Leader" (403)** — the bot is in someone else's party. Leave the
party or have the bot promoted.

**Party chat returns 409** — the bot is alone in its party. Invite someone first.

**Cosmetic rejected** — Epic refused the item ID (usually not owned by the
account). The real error is shown and the previous cosmetic is kept.

**Sessions stuck "active"** — fixed; sessions and match rounds are closed on
stop, restart and shutdown, and any left open by an unclean exit are closed at
startup.

**Reset emails not arriving** — without `SMTP_HOST` the reset link is printed to
the server console.

**Exits immediately with "requires Node 22 or newer"** — the runtime is too old.
On Pterodactyl switch the egg/image from `nodejs_20` to a Node 22+ build.

**"The SQLite driver could not be loaded"** — `sqlite3` is a native module and
its binding is missing or built for a different Node version. Run
`npm rebuild sqlite3`. If the host blocked the install script (npm prints
`allow-scripts ... sqlite3@6.0.1 (install: node-gyp rebuild)`), approve it first
with `npm approve-scripts sqlite3`, then rebuild. This downloads a prebuilt
binary where one exists; a compiler is only needed as a fallback.

---

## Scope

This dashboard implements ordinary lobby, account and social functionality
supported by `fnbr.js` and FNLB: friends, direct messages, party membership and
chat, presence and the bot's own party-member cosmetics.

It deliberately does not implement party crashing, packet flooding, rate-limit
abuse, credential harvesting, token dumping, account theft, anti-cheat bypass or
ban evasion, and contributions adding them will not be accepted. Use a dedicated
bot account and follow Epic's Terms of Service.

## License

ISC
