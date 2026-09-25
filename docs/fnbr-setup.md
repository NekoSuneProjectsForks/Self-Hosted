# Local fnbr bot setup

This guide takes you from a fresh install to a bot that is online, accepting
friends, and sitting in your Fortnite lobby. It covers the **Local fnbr** engine
(the default). You do not need an FNLB account or API token for any of this.

> **Use a separate Epic account for the bot.** The bot logs in as a real Epic
> account and shows up as a real player. Don't use your main account: the bot
> takes over that account's presence and party. Automating an account may also
> go against Epic's terms, and the account is at risk if Epic acts on it.

---

## 1. Install and start the dashboard

You need **Node 22 or newer**.

```bash
cp .env.example .env
npm install
npm start
```

Open <http://localhost:3000> and register. **The first account you register
becomes the admin.**

If you run it in Docker instead, see the Docker quick start in the
[README](../README.md#quick-start-docker).

---

## 2. Get a one-time Epic authorization code

The bot signs in with a one-time code. After the first successful login it saves
a long-lived **device auth** and never needs the code again.

1. In a browser, sign in to <https://www.epicgames.com> **as the bot account**.
   If your main account is already signed in, sign out first, or use a private
   window.
2. In the same browser, open:

   ```
   https://www.epicgames.com/id/api/redirect?clientId=3f69e56c7649492c8cc29f1af08a8a12&responseType=code
   ```

3. The page shows some JSON. Copy the value of `authorizationCode`: 32
   characters of letters and numbers.

```json
{ "redirectUrl": "...", "authorizationCode": "a1b2c3d4e5f6...", "sid": null }
```

The code **expires within a few minutes** and works **once**. If login fails,
reload the page from step 2 to get a new one.

> That client ID belongs to the Fortnite Android client, which is the client fnbr
> signs in with. A code made with any other client ID will be rejected.

---

## 3. Configure the bot

Go to **Config** in the dashboard:

| Field | What to put |
|---|---|
| Runtime engine | **Local fnbr** |
| Authorization Code | The code from step 2 |
| Device auth (accountId / deviceId / secret) | Leave empty. It fills itself in after the first login. |
| Platform | What platform the bot appears on (`WIN` is fine) |
| Default Status | The status text friends see, e.g. `Battle Royale Lobby - 1 / 16` |
| Kill other Fortnite tokens | Leave **off**, unless this server is the only thing using the bot account |

Click **Save Config**, then **Start Cluster** at the top.

Watch the log panel. A good first start looks like this:

```
[Local fnbr] Preparing authentication
[Local fnbr] Authenticating with Epic
[Local fnbr] Device auth accepted, encrypted in SQLite, authorization code deleted.
[Local fnbr] Ready as YourBotName
```

From now on, **Start** just works. You won't need another code unless the device
auth is revoked, for example after the bot account's password changes.

---

## 4. Get the bot into your lobby

The bot has to be **your friend** before it can join you. It **accepts friend
requests and party invites automatically**, and both are on by default. You can
check them on the **Categories** page.

### Option A: invite it from Fortnite (easiest)

1. In Fortnite, on your own account, send a friend request to the bot's display
   name. The bot accepts it straight away.
2. Invite the bot to your party. It accepts and joins.

### Option B: send it from the dashboard

1. On the **Friends** page, type your own display name into **Add Friend**. The
   bot sends you a friend request. Accept it in Fortnite.
2. Then use one of these on your friend entry:
   - **Invite**: the bot invites you to *its* party.
   - **Join Party**: the bot joins *your* party. This only shows up when your
     party is joinable, meaning its privacy is **Public** or **Friends**, not
     Private or invite-only.

### Once it's in the lobby

Open the **Lobby** page to see the party and control the bot:

- **Ready / Unready**, **Leave Party**
- Change the **outfit, backpack, pickaxe and emote** on the **Items** page. These
  update live.
- Set **party privacy** and the **playlist**. These need the bot to be **party
  leader**, and the page tells you when it isn't.
- Set the **presence status**. This works whether or not the bot is leader.
- Party chat from **Lobby**, direct messages from **Messages**.

When the party goes into a game, the bot records it on the **Matches** page
(start and end time, duration, playlist, party size). Kills and placement aren't
in the live data. Add them by uploading a replay or entering them by hand.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `Add Epic device auth or a one-time Epic authorization code...` | You started without a code. Do step 2 again, paste the code, and save. |
| Login fails with `invalid_grant` or "authorization code" | The code expired, was already used, or came from the wrong client ID. Get a new one from the URL in step 2. |
| **Authentication Required** banner | The saved device auth was rejected, usually after a password change. Tick **Clear saved device auth**, save, then sign in with a new code. |
| Bot doesn't accept your invite | Check that you're friends and that auto-accept invites is on. The log line `Could not accept party invite: ...` gives Epic's reason (full, expired, private). |
| No **Join Party** button | Your party is Private, or you're offline. Set your privacy to Public or Friends. |
| Lobby controls greyed out | The bot isn't party leader. Promote it in Fortnite. |
| Your own game gets kicked when the bot starts | **Kill other Fortnite tokens** is on while you're using the same account. Turn it off, and use a separate bot account. |
