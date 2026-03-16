# Server.js ↔ GitHub MCP (`server.py`) Integration Workflow

This document explains the complete runtime workflow between:

- Node webhook/agent server: `server/server.js`
- Python MCP GitHub tools server: `github-mcp/server.py`

It includes setup, required credentials, dependencies, request flow, and troubleshooting.

---

## 1) High-Level Architecture

1. GitHub sends webhook events (for installed GitHub App) to Node server.
2. `server.js` verifies webhook signature and processes event.
3. Node obtains a **GitHub App installation token** dynamically from Octokit.
4. LangGraph agent decides which tool to call (`react_to_issue`, `comment_on_issue`, `get_issue`).
5. Node calls MCP compatibility endpoint:
   - `POST http://localhost:8000/mcp/tools/<tool_name>`
6. Python `server.py` extracts token from `X-GitHub-Token` header.
7. Python calls GitHub REST API and returns tool result text.
8. Node prints final agent response in terminal.

---

## 2) Exact Code Responsibilities

### Node side (`server/server.js`)

- Creates GitHub App client with:
  - `APP_ID`
  - `PRIVATE_KEY_PATH`
  - `WEBHOOK_SECRET`
- Listens for `issues.opened` webhook
- Uses Gemini model through LangChain/LangGraph
- Calls MCP via `callMCP()` with dynamic token header `X-GitHub-Token`
- Uses fallback token resolution:
  - `config?.configurable?.token`
  - runtime token from current webhook
  - `process.env.GITHUB_TOKEN` (fallback)

### Python side (`github-mcp/server.py`)

- Registers MCP tools:
  - `comment_on_issue`
  - `react_to_issue`
  - `get_issue`
- Adds compatibility route expected by Node:
  - `POST /mcp/tools/{tool_name}`
- Reads auth token from header:
  - `X-GitHub-Token` (or env `GITHUB_TOKEN` fallback)
- Calls GitHub REST API using `requests`
- Returns result as:
  - `{ "content": [{ "text": "..." }] }`

---

## 3) Required Credentials / Secrets

## A. Required in `server/.env` (Node)

```env
APP_ID=<github_app_id>
WEBHOOK_SECRET=<github_webhook_secret>
PRIVATE_KEY_PATH=./<your-private-key-file>.pem
GEMINI_API_KEY=<google_gemini_api_key>
PORT=3000
```

### Meaning

- `APP_ID`: GitHub App ID from app settings
- `WEBHOOK_SECRET`: must match GitHub App webhook secret exactly
- `PRIVATE_KEY_PATH`: path to downloaded GitHub App private key `.pem`
- `GEMINI_API_KEY`: for LangChain Gemini model
- `PORT`: Node server listen port (currently code listens on `3000`)

## B. Optional in `github-mcp` environment (Python)

```env
GITHUB_TOKEN=<optional_fallback_token>
```

- Usually **not required** during webhook flow, because Node passes installation token in headers.
- Useful for manual testing without Node.

---

## 4) GitHub App Configuration Requirements

Create GitHub App in: `GitHub Settings → Developer settings → GitHub Apps`

### Webhook

- Webhook URL: your public URL to Node root path (example via ngrok)
- Webhook Secret: same as `WEBHOOK_SECRET` in Node `.env`

### Permissions (minimum for this workflow)

- Issues: Read & Write (commenting/reactions)
- Metadata: Read-only

### Events to subscribe

- `issues`

### Installation

- Install app on target repository/repositories.

---

## 5) Dependency List (Current Project)

## A. Node dependencies (`server/package.json`)

- `@langchain/anthropic` `^1.3.23`
- `@langchain/core` `^1.1.32`
- `@langchain/google-genai` `^2.1.25`
- `@langchain/langgraph` `^1.2.2`
- `@langchain/openai` `^1.2.13`
- `@octokit/app` `^16.1.2`
- `@octokit/webhooks` `^14.2.0`
- `dotenv` `^17.3.1`
- `express` `^5.2.1`
- `fs` `^0.0.1-security`
- `langchain` `^1.2.32`
- `octokit` `^5.0.5`

## B. Python dependencies (`github-mcp/pyproject.toml`)

- Python `>=3.13`
- `mcp[cli]>=1.26.0`
- `requests>=2.32.5`

(Starlette/FastAPI objects are available via MCP stack; direct `fastapi.Request` import is not required.)

## C. External tools needed

- Node.js + npm
- Python + `uv` (recommended in this project)
- ngrok (or another tunnel) for GitHub webhooks to localhost

---

## 6) End-to-End Run Instructions

## Step 1: Install dependencies

### Node

```bash
# in /server
npm install
```

### Python

```bash
# in /github-mcp
uv sync
```

## Step 2: Start Python MCP server

```bash
# in /github-mcp
uv run server.py
```

Expected:
- Uvicorn starts on `http://127.0.0.1:8000`

## Step 3: Start Node server

```bash
# in /server
npm start
```

Expected:
- `Backend listening on port 3000`

## Step 4: Expose Node with ngrok

```bash
ngrok http 3000
```

Use ngrok HTTPS forwarding URL in GitHub App webhook URL.

## Step 5: Trigger event

- Open a new issue in installed repository.
- Observe:
  - Node logs: `--- Starting Agent Execution ---`, `[MCP Call] Tool: ...`
  - Python logs: `POST /mcp/tools/<tool>` request
  - GitHub issue gets bot action (reaction/comment)

---

## 7) Runtime Request/Response Contract

## Node → Python MCP

### Request

- Method: `POST`
- URL: `/mcp/tools/<tool_name>`
- Headers:
  - `Content-Type: application/json`
  - `X-GitHub-Token: <installation_token>`
- Body examples:

```json
{ "repo": "owner/repo", "issue_number": 17, "reaction": "rocket" }
```

```json
{ "repo": "owner/repo", "issue_number": 17, "comment": "Thanks!" }
```

## Python → Node

```json
{
  "content": [
    { "text": "Reaction added" }
  ]
}
```

Node reads: `data.content?.[0]?.text`.

---

## 8) Common Failure Modes + Fixes

## A) `404 Not Found` on `/mcp/tools/react_to_issue`

Cause:
- Old MCP server process without compatibility route, or wrong server version running.

Fix:
1. Stop all old Python MCP processes.
2. Restart from updated `github-mcp/server.py`.
3. Ensure port `8000` belongs to current process.

## B) `address already in use` on port 8000

Cause:
- Another process already bound to 8000.

Fix:
- Stop previous process and restart MCP server.

## C) `Missing GitHub installation token`

Cause:
- Token not passed/resolved.

Fix:
- Ensure webhook event comes from installed app.
- Ensure Node calls include `X-GitHub-Token` (already implemented).

## D) GitHub API 401/403/404 from tools

Cause:
- App not installed on repo, missing permissions, wrong repo path, or wrong issue number.

Fix:
- Verify app installation scope, permissions, and repo/issue values.

## E) Webhook not reaching Node

Cause:
- ngrok URL changed or webhook URL mismatch.

Fix:
- Update GitHub App webhook URL with current ngrok URL.

---

## 9) Security Notes

- Rotate keys/secrets if leaked.
- Prefer installation tokens (short-lived, least privilege scope) over static PATs.

---

## 10) Minimal Operational Checklist

- [ ] Python MCP server running on `127.0.0.1:8000`
- [ ] Node server running on `:3000`
- [ ] ngrok forwarding active to `:3000`
- [ ] GitHub App webhook URL updated
- [ ] App installed on repository
- [ ] Required app permissions/events configured
- [ ] `server/.env` has valid values
- [ ] New issue triggers MCP call and GitHub action
