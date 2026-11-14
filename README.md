# Fortnite Lobby Bot Dashboard

A self-hosted dashboard for running and managing a Fortnite lobby bot in real time.

It supports **two independent engines**:

| | **Local fnbr** (default) | **Legacy FNLB** |
|---|---|---|
| Runtime | `fnbr.js` running in this process | FNLB cloud platform + `fnlb` package |
| Needs an FNLB account/API token | **No** | Yes |
| Needs `fnlb.net` / `api.fnlb.net` | **No** | Yes |
| Multiple bots | Main bot + up to 15 extra accounts ([Bot Lobby](#bot-lobby-multiple-local-bots)) | Shards / many bots |
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

- **Use a dummy Epic account, never your main.** A bot account carries a high risk of being banned if it is abused. The **Get code from Epic** button shows this warning, and you must confirm it before the link opens or can be copied.
- **Sign in with Epic (recommended):** press **Sign in with Epic / get code**, tick the dummy-account warning, and sign in on Epic's own page with the account's email and password. Epic handles captcha and 2FA. The dashboard never sees the password; it gets a device auth back and saves it encrypted. There's nothing to copy. This works for the main bot, for new extra bots, and for signing an extra bot in again. Plain email/password login isn't offered, because Epic blocks it for game clients (captcha) and storing passwords would be a liability.
- Or get a one-time authorization code from Epic, paste it into **Config**, and start the bot. Paste the bare code, the whole JSON page Epic shows, or the redirect URL; the code is pulled out of any of them.
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
bot immediately. On the Items page, the slot comes from each item's type, so
equipping Back Bling never replaces the Outfit. **Add to loadout** collects one
item per slot, and **Equip loadout** applies them all at once (the emote goes
last). Emotes have **Play emote** and **Stop emote**. Emotes **play once** by default:
Fortnite keeps showing an emote until it is cleared, so the bot clears it after
the emote length (6 s by default, 1–60 s). That applies to Play emote, the
loadout, the join emote and `EID_` DMs. Switch it off, or change the length,
under **Bot Lobby → Lobby behaviour**.

**Profile** — battle pass level (e.g. 100) and whether the pass is owned, banner
icon and colour, and crowns (shown with the Crowned emote). **Browse** next to
the banner fields opens a searchable icon grid and a colour swatch grid
(from fortnite-api.com via `GET /api/fortnite/banners`, cached for 12 h). IDs can
still be typed by hand. **Apply now**
changes the bot for this party; **Save as join default** keeps it.

**Join defaults** — the look every local bot (main and extra) goes back to
whenever it lands in a party, whether it joined someone, was invited, or made
its own fresh party: outfit, back bling, pickaxe, kicks, join emote, battle pass
level, banner and crowns. Everything changed live (the Items page, Lobby,
`CID_…` / `!level` DMs) is temporary and lasts only for the current party.
**Reset bots to defaults now** puts every running bot back immediately. Privacy
is only applied when the bot leads the party.

API: `GET/PUT /api/bot-defaults`, `POST /api/bot-defaults/apply`,
`PATCH /api/bots/:botId/profile`, `PATCH /api/bots/:botId/loadout`. "Equip Now" and "Save as Startup Loadout" are separate actions:
saving a default never forces a restart, and equipping is only reported as
successful once the runtime confirms it.

## Layout

The sidebar is grouped:

- **Dashboard**
- **Play**: Lobby, Friends, Messages, Matches
- **Bots**: Bots (every bot, with a settings pop-up), Locker (cosmetics, loadouts, join defaults)
- **System**: Console (live runtime output with filters), Categories (FNLB only), Account, Admin

There's no separate config page. Server-wide settings (engine, manual device
auth, restart schedule, Epic session options, FNLB token) are in the main bot's
settings pop-up under **Advanced**, also reachable from **Bots → Advanced
settings**.

The top bar shows the engine and status, the **control picker** (which bot the
live pages act on), and Start/Stop.

On **Bots**, click any bot (main or extra) to open its settings pop-up:

- **Overview**: status, platform, battle pass level, party, start/stop, control in Lobby, join the main lobby, leave the party
- **Look & level**: battle pass level (with 1/50/100/200 presets), battle pass owned, banner, crowns, applied to that bot or saved as join default; **copy a player's look** from the bot's party
- **Account**: sign in (with the dummy-account warning), platform, presence status, plus label, auto-start and remove for extra bots
- **Advanced** (main bot): engine, manual device auth, restart schedule, Epic session options, FNLB token

On **Lobby**, every other player has **Copy look to bot** (outfit, back bling,
pickaxe, kicks, battle pass level and banner; styles can't be copied), each
player shows their level, and the bot's own card has a quick battle pass level
box. Players can also type `!copy` in lobby chat.

`public/styles.css` is committed already built, so a host that runs
`node index.js` without `npm run build` still gets every style.

## Bot Lobby (multiple local bots)

The **Bot Lobby** page runs extra Epic accounts as their own fnbr clients next to
the main bot, so you can fill a lobby with your own bots. No FNLB account is
needed.

- **Add a bot account**: give it a label and a one-time authorization code taken
  while signed in as *that* account. Use a private window for each one. After the
  first login its device auth is encrypted into SQLite and reused, just like the
  main bot's.
- **Start / Stop** each bot, or **Start all**. Starting while the main bot is
  online seats the bot in the main lobby straight away.
- **Join main lobby** tries a direct join first. If the party is private, the
  main bot friends the extra bot and invites it, and the extra bot accepts.
  Your own bots always accept each other's friend requests and invites, even
  with auto-accept turned off.
- **All join**: every online extra bot joins a friend's party, by name or party
  ID. Each bot must be friends with that person. A private party gets a join
  request instead.
- **Auto-start** bots log in and join the main lobby whenever the main bot starts.
- **Control**: the picker at the top switches the Lobby, Friends, Messages,
  Matches and Items pages to any online extra bot. Every `/api/bots/:botId/*`
  route accepts an extra bot's account ID.

Each extra bot can show as its own platform (PC, PS5, Xbox Series X|S, Switch,
mobile and so on), or use the main bot's. The platform is fixed at login, so a
change applies the next time that bot starts. Extra bots use the main bot's
status and loadout. A party holds 16,
so the limit is 15 extra accounts.

### Friend DM commands

Friends can message any local bot (main or extra):

| Message | Effect |
|---|---|
| `CID_…` / `BID_…` / `Pickaxe_ID_…` / `EID_…` | Equip that outfit / backpack / pickaxe / emote |
| `!ready` / `!unready` / `!sitout` | Readiness |
| `!stopemote` | Clear the emote |
| `!status <text>` | Presence status |
| `!copy` | Bot copies the sender's look (they must be in its party) |
| `!level <n>` / `!crowns <n>` | Battle pass level / crowns, for this party |
| `!stats [name]` | The sender's (or that player's) BR wins, kills, matches and K/D |
| `!join` / `!leave` | Join the sender's party / leave the party |
| `!help` | List the commands |

Messages between your own bots are ignored, so two bots can never get into a
loop.

### Matchmaking (the FNLB way)

FNLB's guide: invite **one** bot, use **Duos, Trios or Squads** (not Solo) with
**No Fill**, and ready up; the bot readies with you. These bots do the same:

- **Ready last**: once every player is ready, the bot readies (auto-ready).
- **Solo is fixed or flagged**: a Solo playlist can't queue a party of two or
  more. If the bot leads the party, it switches to the Duo/Trio/Squad version
  (Battle Royale and Zero Build). Otherwise it says so once in lobby chat and
  doesn't ready. The Lobby page shows the same warning.
- **One bot per party**: if several of your bots share a party, one (the same
  one, picked on every bot) goes along and the others leave when the players
  are ready.
- **No Fill**: a bot that leads the party turns squad fill off.
- **Leave when the match starts**: when a player loads in (`InGame`), the bot
  leaves the party a few seconds later, so it's free again.
- **Rejoin after the match**: when that player's presence shows them back in a
  lobby, the bot rejoins their party (if it's joinable; otherwise invite it).

**Game build (netCL)**: fnbr creates the bot's first party at login with the
build ID `1:3:` (no Fortnite build number) and advertises the same in its
presence, so Fortnite can treat the bot as being on another game version. Since
fnbr 4.2.70 the number is only looked up when *joining* a party (reported in
Fortnite-LobbyBot/fnbr.js#11). The bot now looks it up right after login and
recreates its own party with it (only while it's alone), falls back to a
friend's party presence, and can be set by hand under **Lobby behaviour →
Fortnite build**.

**Match the leader's mode** (42.x lobbies): every member publishes its own
mode selection (`MatchmakingInfo.islandSelection`: Build/Zero Build, team size,
fill, region) and loading state (`DownloadOnDemandProgress_d`,
`LobbyState.hasPreloadedAthena`). A real client copies the leader's; fnbr never
does when the bot isn't leader, so the bot kept saying "Build · Solo · EU · 0%
downloaded" while the leader picked e.g. Zero Build Duo. The bot now copies the
leader's mode selection whenever the leader changes it and right before it
readies. It does **not** copy the leader's queue record (`MatchmakingData1/2`,
`matchmakingId`, `bHasOwnerStartedMM`): an earlier version did, which made two
members claim the same matchmaking slot and crashed the leader's PS5 Fortnite
(CE-108255-1) as the queue started. Leftover copies are cleared automatically.
While the leader queues, the bot records their progress (including Epic's
`failReason`) into a timeline shown by the Matchmaking check.

**Its own queue slot and sub-game.** Like rebootpy, the bot publishes its *own*
empty queue slot (`MatchmakingData1/2` with no group ID, barrier bits 0) instead
of none, so the leader's client sees a well-formed member rather than a missing
record. It also mirrors the leader's `SubGame_u`: fnbr hard-codes `1`, while a
console in Battle Royale sends `2`, and the check flags any mismatch as
"Sub-game differs".

**Why the local engine can't queue with you (Nov 2026).** The leader's console
waits at barrier 268 until every member reports, through `MatchmakingData1`,
that it's following the queue. Echoing that progress from the bot crashed the
leader's PS5 twice (CE-108255-1): once with the full record copied (7e161c0
reverted it) and once with only the counters copied (bfa40ac, disabled in
a4d3718). No public library implements this. rebootpy (moved to Epic Parties,
experimental, Sept 2026) and fnbr only publish an idle slot. FNLB fixed bot-lobby
matchmaking in its closed runtime (status.fnlb.net, May 2026, bots 2.0.149+).
For bot lobbies, use the **Legacy FNLB engine**. With the local engine, use
**Step out when you ready up**.

**Leave when the queue starts** (off by default) is a fallback: if matchmaking
still fails with the bot in the party, the bot steps out as soon as the leader
readies or presses Play, so they queue alone, and rejoins once their match has started and ended.
Toggle: **Lobby behaviour → Match the leader's mode**.

**Matchmaking check** (Lobby page) shows what the bot is telling Fortnite: build,
party build, each member's readiness, mode (build mode, team size, fill,
region), download progress, crossplay and platform, a list of problems, and
every non-cosmetic field that differs between the bot and the leader. The raw output is there to copy when asking for help.

Turn each of these on or off under **Bots → Lobby behaviour**. **Sit out instead
of readying** is still there (off by default) for parties that want to play
without the bot.

### Auto-ready and lobby chat commands

- **Auto-ready**: every bot readies up once every player in the lobby is ready,
  about 1.5 s after the last player, so the bots always ready last (in a duo,
  trio or squad, after all the others).
  Sitting out counts as done, and your own bots don't count as players. If a
  player unreadies, the bots unready too, but a bot you readied by hand with
  `!ready` or the dashboard stays ready.
- **Lobby chat**: any player can type `!ready`, `!unready` or `!sitout` in lobby
  chat, and every bot in the party follows.

Turn each of these on or off under **Bot Lobby → Lobby behaviour**, along with
DM commands, accepting invites and accepting friend requests. Changes apply to
every running bot at once, with no restart.

### Player stats

The Lobby page has a **Stats** button on each party member. It shows overall,
solo, duo and squad wins, kills, K/D and matches from Epic's stats service
(`GET /api/bots/:botId/stats?user=`). Players who set their stats to private
show as private; nothing is guessed. The bots only sit in the lobby and never
play a match, so per-match kills and placement still come only from replay
uploads or manual entry.

### What is *not* claimed

- Match stats (kills, placement, win) are **not** invented. Epic presence only
  reports *where* the bot is, so those fields stay empty unless a replay upload
  or a manual entry provides them. Every stored value records its `source`.
- This controls what the bot **presents in its lobby** through the supported
  party APIs. It does not modify the Fortnite locker or account inventory.

---

## Match stats (any engine)

**Matches** shows the stats of **your own bots**, read from each bot account's
public Epic stats, with nothing to type in:

- Bots are picked up automatically: local main and extra bots (local engine),
  and FNLB bots once they're logged in on this server (their Epic account ID
  comes from the fnlb SDK).
- **Pick a bot** (or "All bots and players") to see:
  - Matches, wins and win rate, **K/D** (kills per non-winning match, like
    Epic), kills per match, top-10 rate, and average match time with hours
    played.
  - **Career (all time, from Epic)**: overall, solo, duo, trio, squad and LTM
    matches, wins, win rate, kills and K/D, loaded on demand.
  - A **paged** match table: time, mode, input, result (Victory Royale or Top
    N), kills, players outlived, time and score.
- You can still track a player by name under "Also track a player"
  (up to 10; bots don't count toward that).

Stats are read by the admin's **server tracker** (Admin → Tracker), which never
joins a party. Members aren't shown which account it is. Epic updates stats a
few minutes after a match ends, and the first check only records a starting
point. Bot accounts' stats must be public.

### FNLB bot lobby queues

With the Legacy FNLB engine, the Matches page also lists (paged, and filtered to
the selected bot) every queue FNLB's bot reports in its log, with a summary
(queues, bot-lobby rate, average queue time, failures). Errors are shortened
to one readable line (for example "The matchmaking ticket expired (heartbeat
failed)"). It reads the lines (`Starting matchmaking [v3]`, `Matchmaking ended
successfully (...). Real players in the match: N`). It shows the mode, region,
queue time and whether it was a real bot lobby (you were the only real player).

FNLB's log also shows how its bot lobbies work: FNLB's own bot requests a
matchmaking ticket (Matchmaking V3, with a `ticketId`) through FNLB's private
gateway servers (`fnlbgw-*.on.tnfangel.net`). The local engine has no such
gateway and can't make the signed ticket request a real client makes. That's
why bot lobbies need the Legacy FNLB engine.

## Pages

| Path | What | Login |
|---|---|---|
| `/` | Homepage: what the platform is, live public-bot counts, how to use a public bot, and what Free / In use / Offline / Banned / Private mean | No |
| `/public-lists` | The public bot list (only bots free right now) | No |
| `/login`, `/register` | Log in or create an account (when registration is open) | No |
| `/dashboard` | The dashboard (everything that used to be on `/`) | Yes |

Old links keep working: `/community` redirects to `/public-lists`, and reset
links that pointed at `/?reset_token=…` go to `/login?reset_token=…` (new
reset emails link there directly). Signed-out visits to `/dashboard` go to
`/login`, and after logging in you land on `/dashboard`. Unknown pages go to
the homepage.

## Community bots (public list)

**`/public-lists`** is a public page (no login) listing bots their owners chose
to share. Each member decides per bot on **Bots → Community listing**:

- **Public**: shown on the community page **only while it's available**:
  running, not banned and free. Hidden while offline; while busy (anyone else
  in its party, or, for local bots, matchmaking or in a match) until it's free
  again; while FNLB reports a matchmaking ban (until it ends), an invalid
  login or the bot as disabled. The page shows the name, type (FNLB bot lobby
  bot or lobby bot) and an optional note (160 characters), plus a count of
  busy bots. Owners see on their Bots page why a public bot is hidden.
- **Private** (default): only the owner uses it.

**Legacy FNLB categories**: the panel groups FNLB bots by the categories your
cluster boots (the Advanced categories filter, or every category with bots
when the filter is empty). Each category has **All private / All public**:
it switches every bot in the category, and bots added to the category later
take the same choice. Single bots can still be switched on their own.

The public page is read-only. It never shows owners, emails or account IDs,
and it has no controls: friends, DMs, skins and settings stay with the owner.
Ownership is checked when publishing (a local bot must be your main or extra
account; an FNLB bot must be on your FNLB token). Bots of suspended members are
hidden. The list is cached for 20 seconds.

## Local engine: admins only (for now)

While the local engine can't do bot lobbies, **Admin → Server → Local engine
access** keeps it admin-only (default). Members:

- can't select or start the local engine or extra bots (403)
- are moved to Legacy FNLB automatically while their bot is stopped
- see a notice on the Bots page

Legacy FNLB (bot lobbies, friends, DMs, skins) is not affected. Switch it to
**Everyone** when the local engine is ready.

## Admin panel

- **Overview**: members, bots online, tracked players, matches today, server
  tracker status, dashboard version/commit, uptime, Node, memory, database size.
- **Members**: search; role; temporary or permanent suspension; per-member bot,
  tracking and match counts; start/stop; **reset password** (shows a one-time
  random password); **delete** (stops their bots and removes their data; you
  type the name to confirm).
- **Running bots**: every main and extra bot on the server with owner, engine,
  status and party size; stop one, or **Stop all**.
- **Tracker**: the server tracker bot: sign in or out, start/stop, start with
  the server, check interval, platform, check everyone now, live log.
- **Server**: open or close registration (the first account can always be
  created), an announcement banner shown to every member, local engine access
  (admins only or everyone), and Stop all bots.

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
GET    /api/bot-accounts
POST   /api/bot-accounts
PATCH  /api/bot-accounts/:id
DELETE /api/bot-accounts/:id
POST   /api/bot-accounts/:id/start | /stop | /join-main | /clear-auth
POST   /api/bot-lobby/start-all | /stop-all | /join-main | /join | /leave
POST   /api/bot/start | /api/bot/stop | /api/bot/restart
POST   /api/config/device-auth/clear
```

The older `/api/fnlb/*` routes still work for backwards compatibility.

Socket.IO events: `bot:status`, `bot:log`, `bot:updated`, `friends:updated`,
`friend:message`, `party:updated`, `party:message`, `cosmetics:updated`,
`match:started`, `match:updated`, `match:ended`, `bot-accounts:updated`.
Every bot event carries a `botId`, so the UI only applies events from the bot it
is controlling.

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

### Automatic fnlb / fnbr updates

`.github/workflows/update-fnlb-packages.yml` checks npm every 6 hours for new
`fnlb` and `@fnlb-project/fnbr` releases. When one is out, it bumps
`package.json` and the lockfile, runs the tests, and commits to `dashboard` only
if they pass. You can also run it by hand from the Actions tab. A running server
picks up the update with the normal `git pull && npm ci && npm start`. On
Pterodactyl, enable the egg's git-pull-on-start option. The workflow needs
**Settings → Actions → General → Workflow permissions → Read and write**.

---

## Troubleshooting

**"Authentication Required"** — the stored device auth was rejected. Clear it and
sign in again.

**"Sorry the account credentials you are using are invalid"** — Epic rejected the
one-time authorization code: it was already used, it expired (codes last about 5
minutes), or what was pasted wasn't the `authorizationCode`. The dead code is now
removed automatically. Use **Sign in with Epic**, or get a fresh code and start
straight away. Codes that obviously aren't codes, such as an `eg1~` access token,
are refused when you save them.

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
