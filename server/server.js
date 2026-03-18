import { App } from "@octokit/app";
import fs from "fs";
import express from "express";
import { createNodeMiddleware } from "@octokit/webhooks";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { DynamicTool } from "@langchain/core/tools";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import dotenv from "dotenv";
dotenv.config();

// --- Telegram Approval Setup ---
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const pendingActions = new Map(); // id -> { tool, args, token }

const genId = () => Math.random().toString(36).slice(2, 8);

async function sendTelegram(text) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
    console.warn("[Telegram] Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID in .env");
    return;
  }
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text }),
    });
  } catch (err) {
    console.error("[Telegram Error]", err.message);
  }
}

// Fixed App Identity
const app = new App({
  appId: process.env.APP_ID,
  privateKey: fs.readFileSync(process.env.PRIVATE_KEY_PATH, "utf8"),
  webhooks: { secret: process.env.WEBHOOK_SECRET },
});

const server = express();
server.use(createNodeMiddleware(app.webhooks, { path: "/" }));

const model = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-flash", 
  apiKey: process.env.GEMINI_API_KEY,
  temperature: 0,
});

let runtimeGithubToken = null;

/**
 * Helper to call MCP. 
 * We now pass the 'token' dynamically so the MCP acts on the 
 * specific repo where the app is installed.
 */
async function callMCP(tool, args, token) {
  try {
    if (!token) {
      return "Error: Missing GitHub installation token";
    }

    console.log(`\x1b[33m[MCP Call]\x1b[0m Tool: ${tool}`);
    
    const res = await fetch(`http://localhost:8000/mcp/tools/${tool}`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "X-GitHub-Token": token // Installation token scoped to webhook installation
      },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify(args),
    });

    const raw = await res.text();
    if (!res.ok) return `Error: MCP ${res.status} - ${raw}`;

    let data = null;
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }

    return data?.content?.[0]?.text || raw;
  } catch (err) {
    console.error(`\x1b[31m[MCP Error]\x1b[0m`, err.message);
    return `Error: ${err.message}`;
  }
}

const unwrap = (input) => {
  try {
    let args = typeof input === "string" ? JSON.parse(input) : input;
    if (!args || typeof args !== "object") return {};
    return args.input ? JSON.parse(args.input) : args;
  } catch {
    return {};
  }
};

const toSafeText = (value, max = 1200) => {
  if (value === null || value === undefined) return "";
  const text = String(value).replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
};

const isBotSender = (payload) => {
  const login = payload?.sender?.login || "";
  return payload?.sender?.type === "Bot" || login.endsWith("[bot]");
};

const resolveGithubToken = (config) => {
  return config?.configurable?.token || runtimeGithubToken || process.env.GITHUB_TOKEN || null;
};

// 2. Tool Definitions
// Tools now pull the token from the LangGraph config
const tools = [
  new DynamicTool({
    name: "comment_on_issue",
    description: "Comment on an issue. Args: { repo: string, issue_number: number, comment: string }",
    func: async (input, config) => {
      const args = unwrap(input);
      const token = resolveGithubToken(config);
      const id = genId();
      pendingActions.set(id, { tool: "comment_on_issue", args, token });
      await sendTelegram(
        `🤖 Bot wants to comment on Issue #${args.issue_number} in ${args.repo}:\n\n"${args.comment}"\n\nReply:\nAPPROVE ${id}\nREJECT ${id}`
      );
      console.log(`[Telegram] Comment queued for approval. ID: ${id}`);
      return `Comment sent to Telegram for approval. ID: ${id}. Waiting for user to APPROVE or REJECT.`;
    },
  }),
  new DynamicTool({
    name: "react_to_issue",
    description: "React to an issue. Args: { repo: string, issue_number: number, reaction: string }",
    func: async (input, config) => await callMCP("react_to_issue", unwrap(input), resolveGithubToken(config)),
  }),
  new DynamicTool({
    name: "get_issue",
    description: "Get issue details. Args: { repo: string, issue_number: number }",
    func: async (input, config) => await callMCP("get_issue", unwrap(input), resolveGithubToken(config)),
  }),
  new DynamicTool({
    name: "list_issues",
    description: "List issues in a repo. Args: { repo: string, state?: 'open'|'closed'|'all' }",
    func: async (input, config) => await callMCP("list_issues", unwrap(input), resolveGithubToken(config)),
  }),
  new DynamicTool({
    name: "create_issue",
    description: "Create a new issue. Args: { repo: string, title: string, body?: string }",
    func: async (input, config) => await callMCP("create_issue", unwrap(input), resolveGithubToken(config)),
  }),
  new DynamicTool({
    name: "close_issue",
    description: "Close an issue. Args: { repo: string, issue_number: number }",
    func: async (input, config) => await callMCP("close_issue", unwrap(input), resolveGithubToken(config)),
  }),
  new DynamicTool({
    name: "reopen_issue",
    description: "Reopen an issue. Args: { repo: string, issue_number: number }",
    func: async (input, config) => await callMCP("reopen_issue", unwrap(input), resolveGithubToken(config)),
  }),
  new DynamicTool({
    name: "add_issue_labels",
    description: "Add labels to issue. Args: { repo: string, issue_number: number, labels: string[] }",
    func: async (input, config) => await callMCP("add_issue_labels", unwrap(input), resolveGithubToken(config)),
  }),
  new DynamicTool({
    name: "get_repository",
    description: "Get repository details. Args: { repo: string }",
    func: async (input, config) => await callMCP("get_repository", unwrap(input), resolveGithubToken(config)),
  }),
  new DynamicTool({
    name: "get_installation_repositories",
    description: "List repositories accessible to this installation token. Args: {}",
    func: async (input, config) => await callMCP("get_installation_repositories", unwrap(input), resolveGithubToken(config)),
  }),
  new DynamicTool({
    name: "get_pull_request",
    description: "Get pull request details. Args: { repo: string, pull_number: number }",
    func: async (input, config) => await callMCP("get_pull_request", unwrap(input), resolveGithubToken(config)),
  }),
  new DynamicTool({
    name: "comment_on_pull_request",
    description: "Comment on a pull request. Args: { repo: string, pull_number: number, comment: string }",
    func: async (input, config) => {
      const args = unwrap(input);
      const token = resolveGithubToken(config);
      const id = genId();
      pendingActions.set(id, { tool: "comment_on_pull_request", args, token });
      await sendTelegram(
        `🤖 Bot wants to comment on PR #${args.pull_number} in ${args.repo}:\n\n"${args.comment}"\n\nReply:\nAPPROVE ${id}\nREJECT ${id}`
      );
      console.log(`[Telegram] PR comment queued for approval. ID: ${id}`);
      return `Comment sent to Telegram for approval. ID: ${id}. Waiting for user to APPROVE or REJECT.`;
    },
  }),
  new DynamicTool({
    name: "merge_pull_request",
    description: "Merge a pull request. Args: { repo: string, pull_number: number, merge_method?: 'merge'|'squash'|'rebase' }",
    func: async (input, config) => await callMCP("merge_pull_request", unwrap(input), resolveGithubToken(config)),
  }),
  // --- New Tools Added Below ---
  new DynamicTool({
    name: "get_pr_diff",
    description: "Get the raw text diff of a Pull Request to review code changes. Args: { repo: string, pull_number: number }",
    func: async (input, config) => await callMCP("get_pr_diff", unwrap(input), resolveGithubToken(config)),
  }),
  new DynamicTool({
    name: "get_workflow_runs",
    description: "Get the status of recent CI/CD GitHub Actions workflow runs. Args: { repo: string, branch?: string }",
    func: async (input, config) => await callMCP("get_workflow_runs", unwrap(input), resolveGithubToken(config)),
  }),
  new DynamicTool({
    name: "assign_issue",
    description: "Assign users to an issue or pull request. Args: { repo: string, issue_number: number, assignees: string[] }",
    func: async (input, config) => await callMCP("assign_issue", unwrap(input), resolveGithubToken(config)),
  }),
  new DynamicTool({
    name: "get_file_content",
    description: "Get the plaintext content of a specific file in the repository. Args: { repo: string, path: string }",
    func: async (input, config) => await callMCP("get_file_content", unwrap(input), resolveGithubToken(config)),
  }),
];

const agent = createReactAgent({ llm: model, tools });

/**
 * Handle Event
 * We generate a fresh token for the specific installation that triggered the webhook.
 */
const handleEvent = async ({ input, installationId, eventName, action, repo, octokit }) => {
  console.log(`\n--- Starting Agent --- Event=${eventName} Action=${action || "n/a"} Repo=${repo}`);
  try {
    if (!installationId || !Number.isInteger(Number(installationId))) {
      console.warn(`[Skip] Invalid or missing installation id for ${eventName}`);
      return;
    }

    if (!octokit || typeof octokit.auth !== "function") {
      console.warn(`[Skip] Missing octokit installation context for ${eventName}`);
      return;
    }

    // Mint a temporary token (valid for 1 hour) for this installation scope
    const { token } = await octokit.auth({ type: "installation" });
    runtimeGithubToken = token;

    const result = await agent.invoke(
      { messages: [{ role: "user", content: input }] },
      { configurable: { token: token } } // Pass token to tools
    );

    console.log(`\nFinal Response: ${result.messages[result.messages.length - 1].content}`);
  } catch (error) {
    console.error("\x1b[31m[Agent Crash]\x1b[0m", error);
  } finally {
    runtimeGithubToken = null;
  }
};

const processWebhook = async ({ eventName, payload, prompt, octokit }) => {
  if (!prompt) return;

  if (isBotSender(payload)) {
    console.log(`[Skip] Ignoring bot-originated ${eventName} event.`);
    return;
  }

  const installationId = payload?.installation?.id;
  const repo = payload?.repository?.full_name;

  if (!repo) {
    console.warn(`[Skip] Missing repository in ${eventName} payload.`);
    return;
  }

  await handleEvent({
    input: prompt,
    installationId,
    eventName,
    action: payload?.action,
    repo,
    octokit,
  });
};

// 3. Webhook Handlers (organized by event type)
app.webhooks.on("issues", async ({ payload, octokit }) => {
  const action = payload.action;
  const repo = payload.repository.full_name;
  const issue = payload.issue;
  const body = toSafeText(issue?.body);
  const title = toSafeText(issue?.title);

  let prompt = null;
  if (action === "opened") {
    prompt = `Issue opened in ${repo}. Issue #${issue.number}: "${title}". Body: "${body}". React with rocket and post a helpful acknowledgement comment.`;
  } else if (action === "reopened") {
    prompt = `Issue reopened in ${repo}. Issue #${issue.number}: "${title}". Post a short comment acknowledging it is reopened and list next steps.`;
  } else if (action === "edited") {
    prompt = `Issue edited in ${repo}. Issue #${issue.number}: "${title}". Review current issue details and post a concise update comment.`;
  } else if (action === "closed") {
    prompt = `Issue closed in ${repo}. Issue #${issue.number}. Add a brief closing reaction if suitable.`;
  }

  await processWebhook({ eventName: "issues", payload, prompt, octokit });
});

app.webhooks.on("issue_comment", async ({ payload, octokit }) => {
  if (payload.action !== "created") return;

  const repo = payload.repository.full_name;
  const issue = payload.issue;
  const comment = toSafeText(payload.comment?.body);
  const author = payload.comment?.user?.login || "unknown";

  const prompt = `New issue comment in ${repo} on issue #${issue.number} by ${author}: "${comment}". If a reply is needed, post a concise helpful response. If they ask to be assigned, assign them.`;
  await processWebhook({ eventName: "issue_comment", payload, prompt, octokit });
});

app.webhooks.on("pull_request", async ({ payload, octokit }) => {
  const action = payload.action;
  const repo = payload.repository.full_name;
  const pr = payload.pull_request;
  const title = toSafeText(pr?.title);
  const body = toSafeText(pr?.body);

  let prompt = null;
  if (action === "opened") {
    // Prompt updated to encourage using the new tools
    prompt = `Pull request opened in ${repo}. PR #${pr.number}: "${title}". Body: "${body}". Use get_pr_diff to summarize the changes and check get_workflow_runs. Post a welcome review comment.`;
  } else if (action === "reopened" || action === "synchronize" || action === "ready_for_review") {
    prompt = `Pull request updated in ${repo}. PR #${pr.number}: "${title}". Use get_workflow_runs to verify tests are passing and add a short comment acknowledging the update.`;
  } else if (action === "closed" && pr?.merged) {
    prompt = `Pull request merged in ${repo}. PR #${pr.number}: "${title}". Post a brief merge acknowledgement comment.`;
  }

  await processWebhook({ eventName: "pull_request", payload, prompt, octokit });
});

app.webhooks.on("pull_request_review", async ({ payload, octokit }) => {
  if (payload.action !== "submitted") return;

  const repo = payload.repository.full_name;
  const pr = payload.pull_request;
  const reviewState = payload.review?.state || "commented";

  const prompt = `Pull request review submitted in ${repo}. PR #${pr.number}, review state: ${reviewState}. If needed, post a follow-up comment summarizing the review status.`;
  await processWebhook({ eventName: "pull_request_review", payload, prompt, octokit });
});

app.webhooks.on("push", async ({ payload, octokit }) => {
  const repo = payload.repository.full_name;
  const ref = payload.ref;
  const commits = payload.commits?.length || 0;
  const prompt = `Push event in ${repo} on ${ref} with ${commits} commit(s). Review repository context and create a concise status note as an issue comment only if there is an open issue explicitly requesting update tracking.`;
  await processWebhook({ eventName: "push", payload, prompt, octokit });
});

app.webhooks.on("installation", async ({ payload }) => {
  const action = payload.action;
  const account = payload.installation?.account?.login || "unknown";
  console.log(`[Installation] action=${action} account=${account}`);
});

app.webhooks.onError((error) => {
  console.error("[Webhook Error]", error.message || error);
});

// --- Telegram Webhook Endpoint ---
// Receives APPROVE <id> or REJECT <id> from the Telegram bot
server.post("/telegram", express.json(), async (req, res) => {
  res.sendStatus(200); // Respond immediately so Telegram doesn't retry

  const text = (req.body?.message?.text || "").trim();
  const parts = text.split(" ");
  const command = parts[0]?.toUpperCase();
  const id = parts[1];

  if (!id) return;

  if (!pendingActions.has(id)) {
    await sendTelegram(`⚠️ No pending action found for ID: ${id}`);
    return;
  }

  const pending = pendingActions.get(id);
  pendingActions.delete(id);

  if (command === "APPROVE") {
    console.log(`[Telegram] Action ${id} approved. Executing...`);
    const result = await callMCP(pending.tool, pending.args, pending.token);
    await sendTelegram(`✅ Done! Action ${id} executed.\n\n${result}`);
  } else if (command === "REJECT") {
    console.log(`[Telegram] Action ${id} rejected.`);
    await sendTelegram(`❌ Action ${id} rejected and discarded.`);
  }
});

server.listen(3000, () => console.log("Backend listening on port 3000"));