# Setup

This document explains how to run the GitHub App webhook server locally.

## Prerequisites

- Node.js (LTS recommended)
- npm
- ngrok account + ngrok installed

## 1) Install dependencies

From the `server` directory:

```bash
npm install
```

## 2) Configure environment variables

Create a `.env` file in `server/`:

```env
APP_ID=your_app_id
WEBHOOK_SECRET=your_webhook_secret
PRIVATE_KEY_PATH=./repo-orca.2026-03-14.private-key.pem
PORT=3000
```

If your private key file has a different name/path, update `PRIVATE_KEY_PATH`.

## 3) Start the server

```bash
node server.js
```

You should see a startup log indicating the webhook server is listening.

## 4) Expose local server with ngrok

In a new terminal:

```bash
ngrok http 3000
```

Copy the ngrok forwarding URL (for example: `https://xxxx.ngrok-free.app`).

## 5) Set the GitHub App webhook URL

In GitHub App settings, set:

- **Webhook URL** = your ngrok forwarding URL
- **Webhook secret** = exactly the same value used in `.env`

## 6) Verify end-to-end flow

1. Install the app on a repository.
2. Trigger a subscribed event (for example, create an issue).
3. Check:
   - ngrok request log (`POST` received)
   - terminal logs from `server.js`
   - expected bot action on GitHub

## Troubleshooting

- **No webhook hits in ngrok**: check Webhook URL and app installation scope.
- **Signature/secret errors**: verify `WEBHOOK_SECRET` matches GitHub App setting.
- **Auth/key errors**: verify `APP_ID` and `.pem` path.
- **ngrok URL changed**: update the GitHub App Webhook URL.

## Security

- Do not commit `.env` or private files.
- Rotate webhook secret and private key if exposed.
