# AI GitHub Maintainer using MCP + LangChain + Node.js

This tutorial explains how to build an automated GitHub pull-request reviewer using:

* Python MCP server (tools)
* Node.js webhook server
* LangChain agent
* LLM decision making
* GitHub API actions

This version **matches your secrets setup** and supports **configurable LLM providers**:

* `.env`
* `APP_ID`
* `PRIVATE_KEY_PATH`
* `WEBHOOK_SECRET`
* Flexible LLM API provider (OpenAI, Claude, DeepSeek, local, etc.)

---

# System Architecture

```
GitHub PR Event
      ↓
Node.js GitHub App (webhook server)
      ↓
LangChain Agent (LLM)
      ↓
MCP Client
      ↓
Python MCP Server
      ↓
GitHub API
```

Responsibilities:

| Component       | Responsibility                |
| --------------- | ----------------------------- |
| GitHub Webhook  | Sends PR events               |
| Node.js Server  | Receives event and runs agent |
| LangChain Agent | Reasoning and tool selection  |
| MCP Server      | Executes tools                |
| GitHub API      | Performs repo actions         |

---

# Project Structure

```
project/
│
├─ server.js
├─ .env
│
├─ llm.js
│
├─ mcp-server/
│   └─ server.py
```

---

# Step 1 --- Environment Variables

Create a `.env` file with provider selection:

```
# LLM provider: openai, claude, deepseek, local
LLM_PROVIDER=openai

LLM_MODEL=gpt-4o-mini
LLM_API_KEY=your_api_key
LLM_BASE_URL=https://api.openai.com/v1

APP_ID=123456
PRIVATE_KEY_PATH=/path/to/private-key.pem
WEBHOOK_SECRET=your_webhook_secret
GITHUB_TOKEN=your_github_token
```

Explanation:

| Variable         | Purpose                                          |
| ---------------- | ------------------------------------------------ |
| LLM_PROVIDER     | Model provider (openai, claude, deepseek, local) |
| LLM_MODEL        | Model name                                       |
| LLM_API_KEY      | API key for the model                            |
| LLM_BASE_URL     | Endpoint of the model API                        |
| APP_ID           | GitHub App ID                                    |
| PRIVATE_KEY_PATH | Path to GitHub App private key                   |
| WEBHOOK_SECRET   | Webhook validation                               |
| GITHUB_TOKEN     | Used by MCP tools                                |

---

# Step 2 --- Python MCP Server

Install uv:

```
pip install uv
```

Create project:

```
uv init github-mcp
cd github-mcp
uv add "mcp[cli]" requests
```

Create `server.py`:

```python
from mcp.server.fastmcp import FastMCP
import requests
import os

mcp = FastMCP("github-tools")

GITHUB_TOKEN = os.getenv("GITHUB_TOKEN")
headers = {
    "Authorization": f"Bearer {GITHUB_TOKEN}",
    "Accept": "application/vnd.github+json"
}

@mcp.tool()
def get_pr_diff(repo: str, pr_number: int) -> str:
    url = f"https://api.github.com/repos/{repo}/pulls/{pr_number}"
    r = requests.get(url, headers=headers)
    diff_url = r.json()["diff_url"]
    diff = requests.get(diff_url, headers=headers).text
    return diff

@mcp.tool()
def comment_on_pr(repo: str, pr_number: int, comment: str) -> str:
    url = f"https://api.github.com/repos/{repo}/issues/{pr_number}/comments"
    requests.post(url, headers=headers, json={"body": comment})
    return "Comment posted"

@mcp.tool()
def merge_pr(repo: str, pr_number: int) -> str:
    url = f"https://api.github.com/repos/{repo}/pulls/{pr_number}/merge"
    r = requests.put(url, headers=headers)
    return "Merged successfully" if r.status_code == 200 else "Merge failed"

if __name__ == "__main__":
    mcp.run()
```

Run MCP server:

```
uv run server.py
```

---

# Step 3 --- Node.js GitHub App Server

Install packages:

```
npm init -y
npm install express dotenv langchain @langchain/openai @langchain/anthropic @octokit/app @octokit/webhooks
```

---

# Step 4 --- LLM Wrapper with Provider Selection

Create `llm.js`:

```javascript
const { ChatOpenAI } = require("@langchain/openai");
const { ChatAnthropic } = require("langchain/anthropic");

function createLLM() {
  const provider = process.env.LLM_PROVIDER;

  if (provider === "claude") {
    return new ChatAnthropic({
      modelName: process.env.LLM_MODEL,
      apiKey: process.env.LLM_API_KEY,
      temperature: 0,
    });
  }

  if (provider === "local" || provider === "deepseek" || provider === "openai") {
    return new ChatOpenAI({
      model: process.env.LLM_MODEL,
      apiKey: process.env.LLM_API_KEY,
      configuration: { baseURL: process.env.LLM_BASE_URL },
      temperature: 0,
    });
  }

  throw new Error(`Unsupported LLM_PROVIDER: ${provider}`);
}

module.exports = { createLLM };
```

---

# Step 5 --- Webhook Server

Create `server.js`:

```javascript
const { App } = require("octokit");
const fs = require("fs");
const express = require("express");
const { createNodeMiddleware } = require("@octokit/webhooks");
require("dotenv").config();

const { createLLM } = require("./llm");
const { AgentExecutor, createOpenAIToolsAgent } = require("langchain/agents");

const app = new App({
  appId: process.env.APP_ID,
  privateKey: fs.readFileSync(process.env.PRIVATE_KEY_PATH, "utf8"),
  webhooks: { secret: process.env.WEBHOOK_SECRET },
});

const server = express();
server.use(createNodeMiddleware(app.webhooks, { path: "/" }));

const llm = createLLM();

async function callMCP(tool, args) {
  const res = await fetch("http://localhost:8000/tools/" + tool, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  return await res.text();
}

const tools = [
  { name: "get_pr_diff", description: "Get PR diff", func: async ({ repo, pr_number }) => await callMCP("get_pr_diff", { repo, pr_number }) },
  { name: "comment_on_pr", description: "Comment on PR", func: async ({ repo, pr_number, comment }) => await callMCP("comment_on_pr", { repo, pr_number, comment }) },
  { name: "merge_pr", description: "Merge PR", func: async ({ repo, pr_number }) => await callMCP("merge_pr", { repo, pr_number }) },
];

app.webhooks.on("pull_request.opened", async ({ payload }) => {
  const repo = payload.repository.full_name;
  const pr_number = payload.pull_request.number;

  console.log(`PR opened: ${repo} #${pr_number}`);

  const agent = await createOpenAIToolsAgent({ llm, tools });
  const executor = new AgentExecutor({ agent, tools });

  await executor.invoke({ input: `PR opened: ${repo} #${pr_number}` });
});

server.listen(3000, () => console.log("Server listening on port 3000"));
```

---

# Step 6 --- GitHub Webhook

Webhook URL:

```
http://your-server/api/github/webhooks
```

Subscribe to events:

```
Pull requests
Issues
```

---

# Step 7 --- Runtime Flow

```
PR opened
↓
GitHub webhook
↓
Node server
↓
LangChain agent
↓
LLM (provider selected from .env)
↓
MCP tools
↓
GitHub API
```

---

# Step 8 --- Safety Recommendations

* CI status checks
* Test passes
* No merge conflicts
* Reviews/approvals

---

# Step 9 --- Improvements

* Diff chunking
* File-level review comments
* Static analysis
* Repo embeddings
* CI/CD integration

---

# Conclusion

You now have an AI-powered GitHub maintainer using **MCP + LangChain + configurable LLM API**. You can **switch models (OpenAI, Claude, DeepSeek, local, etc.) just by changing `.env`**, with zero code changes.
