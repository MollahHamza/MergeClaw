# Creating a GitHub App

This guide explains how to create and configure a GitHub App for this server.

## 1) Create the app

1. Go to **GitHub → Settings → Developer settings → GitHub Apps**.
2. Click **New GitHub App**.
3. Fill in:
   - **App name**: any unique name
   - **Homepage URL**: your GitHub profile or repository URL
   - **Webhook URL**: your ngrok forwarding URL (example: `https://xxxx.ngrok-free.app`)
   - **Webhook secret**: a strong random string
4. Click **Create GitHub App**.

## 2) Repository permissions

Recommended permissions for maintainer-style automation:

- **Contents**: Read & write
- **Pull requests**: Read & write
- **Issues**: Read & write
- **Metadata**: Read-only
- **Checks**: Read & write
- **Commit statuses**: Read & write
- **Deployments**: Read & write (optional)
- **Actions**: Read & write (optional)
- **Discussions**: Read & write (optional)
- **Labels**: Read & write
- **Releases**: Read & write (optional)
- **Projects**: Read & write (optional)

If you are using organization repos, you may also need:

- **Members**: Read-only
- **Repository hooks**: Read & write

## 3) Subscribe to webhook events

Recommended events:

- `pull_request`
- `pull_request_review`
- `push`
- `issues`
- `issue_comment`
- `check_run` / `workflow_run`
- `label`
- `release`
- `discussion`

## 4) Get app credentials

After app creation, collect:

- **App ID**
- **Private key (.pem)** from **Generate a private key**
- **Webhook secret**

Put these in your local `.env` file:

```env
APP_ID=123456
WEBHOOK_SECRET=replace_with_strong_secret
PRIVATE_KEY_PATH=./repo-orca.2026-03-14.private-key.pem
```

> Adjust `PRIVATE_KEY_PATH` if your key filename/path is different.

## 5) Install the app

1. Open your GitHub App settings.
2. Click **Install App** in the sidebar.
3. Install it on the target repository (or repositories).

## 6) Test

1. Start your local server.
2. Make sure ngrok is running and forwarding to your server port.
3. Trigger an event (for example, open a new issue in an installed repo).
4. Verify:
   - ngrok shows a `POST` request
   - your server logs show webhook handling
   - GitHub shows the bot action (comment/reaction/etc.)

## Notes

- Free ngrok URLs change when restarted. If URL changes, update **Webhook URL** in GitHub App settings.
- Keep your private key and webhook secret secure.
- Never commit `.env` or private key files.
