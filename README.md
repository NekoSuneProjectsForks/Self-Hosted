# Fortnite Lobby Bot Dashboard

Self-hosted dashboard for running Fortnite lobby bots with a local `fnbr.js` runtime. Legacy FNLB token/category support is still available as an optional engine, but the default setup no longer needs an FNLB API token.

## Features

- Login/register system with first-user admin.
- Dark green Tailwind dashboard.
- Encrypted SQLite storage for Epic device auth, one-time auth codes, legacy FNLB tokens, config, sessions, and logs.
- Local `fnbr.js` bot runtime with party, friend, blocked-user, presence, cosmetics, chat, and command actions.
- Session history with manual console stats, PC replay uploads, and screenshot/video evidence uploads.
- Admin user management, suspensions, and remote start/stop.

## Setup

```bash
npm install
npm run build:css
npm start
```

Set the dashboard port in `.env`:

```env
PORT=3000
HOST=0.0.0.0
DATA_DIR=./data
```

## Epic Auth

The local engine uses Epic device auth through `fnbr.js`.

In the dashboard Config page, use either:

- a one-time Epic authorization code, or
- existing device auth fields: `accountId`, `deviceId`, and `secret`.

When a one-time authorization code is used successfully, the app saves the generated device auth encrypted in SQLite and clears the code.

`fnbr.js` does not use email/password login because Epic commonly requires captcha.

## Legacy FNLB Mode

If you still want the old FNLB runtime/API path, choose `Legacy FNLB cloud API/runtime` in Config and save your FNLB API token and category IDs.
