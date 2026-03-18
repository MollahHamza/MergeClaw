# Telegram Bot Setup Guide

This guide explains how to set up Telegram approval for MergeClaw, so the bot asks you before posting any GitHub comment.

---

## How It Works

1. A GitHub event triggers the bot (e.g. issue opened)
2. Instead of commenting directly, the bot sends you a Telegram message like:
   ```
   🤖 Bot wants to comment on Issue #5 in user/repo:

   "Acknowledged! Thanks for opening this issue."

   Reply:
   APPROVE abc123
   REJECT abc123
   ```
3. You reply `APPROVE abc123` → comment gets posted
4. You reply `REJECT abc123` → comment is dropped

---

## Step 1 — Create a Telegram Bot

1. Open Telegram and search for **@BotFather**
2. Send `/newbot`
3. Follow the prompts — give your bot a name and a username
4. BotFather will give you a **bot token** that looks like:
   ```
   123456789:ABCDefGhIJKlmNoPQRsTUVwxyZ
   ```
   Save this token.

---

## Step 2 — Get Your Chat ID

1. Search for your new bot in Telegram and press **Start** (or send it any message like `hello`)
2. Open this URL in your browser (replace `<TOKEN>` with your bot token):
   ```
   https://api.telegram.org/bot<TOKEN>/getUpdates
   ```
3. Look for this in the response:
   ```json
   "chat": { "id": 123456789 }
   ```
   That number is your **chat ID**.

---

## Step 3 — Update .env

Open `server/.env` and add:

```env
TELEGRAM_BOT_TOKEN=123456789:ABCDefGhIJKlmNoPQRsTUVwxyZ
TELEGRAM_CHAT_ID=123456789
```

---

## Step 4 — Register the Telegram Webhook

Telegram needs to know where to send your replies. Run this URL in your browser (replace `<TOKEN>` and `<YOUR_NGROK_URL>`):

```
https://api.telegram.org/bot<TOKEN>/setWebhook?url=<YOUR_NGROK_URL>/telegram
```

Example:
```
https://api.telegram.org/bot123456789:ABC.../setWebhook?url=https://abc123.ngrok-free.app/telegram
```

You should get back:
```json
{ "ok": true, "result": true, "description": "Webhook was set" }
```

> **Note:** Every time your ngrok URL changes (e.g. server restart), you need to re-run this step with the new URL.

---

## Step 5 — Update GitHub App Webhook URL

1. Go to **GitHub → Settings → Developer Settings → GitHub Apps**
2. Find your app and click **Edit**
3. Update the **Webhook URL** to your ngrok URL:
   ```
   https://abc123.ngrok-free.app
   ```

---

## Step 6 — Restart the Server

After updating `.env`, restart the Node server so it picks up the new variables:

```bash
cd server
node server.js
```

---

## Using the Approval Flow

When the bot wants to post a comment, you'll receive a Telegram message. Reply with:

| Command | Effect |
|---|---|
| `APPROVE abc123` | Posts the comment to GitHub |
| `REJECT abc123` | Drops the comment, nothing is posted |

The short ID (e.g. `abc123`) is unique per pending comment, so if multiple are queued you can approve/reject them individually.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| No Telegram message received | Check `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in `.env`, restart server |
| `APPROVE` not working | Make sure you include the ID: `APPROVE abc123` not just `APPROVE` |
| Webhook not receiving replies | Re-register the webhook — your ngrok URL may have changed |
| Bot still commenting without approval | Old server instance may be running — kill it and restart |
