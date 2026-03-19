// Imports necessary modules and environment configuration.
import { App } from "@octokit/app";
import fs from "fs";
import express from "express";
import { createNodeMiddleware } from "@octokit/webhooks";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { DynamicTool } from "@langchain/core/tools";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import NodeCache from "node-cache"; // <-- ADDED node-cache
import dotenv from "dotenv";
dotenv.config();

// Sets up Telegram credentials
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Initializes NodeCache. stdTTL: 3540s (59 minutes). checkperiod: 60s (sweeps memory every minute).
const pendingActions = new NodeCache({ stdTTL: 3540, checkperiod: 60 });

// Notifies user if a token expires before they hit Approve/Reject
pendingActions.on("expired", (key, value) => {
  console.log(`[Cache] Action ${key} expired.`);
  sendTelegram(`⏳ *Pending Action Expired*\nThe request \`${key}\` (${value.tool}) timed out after 60 minutes because the GitHub security token expired. It has been cleared from memory.`);
});

// Generates a random short ID for tracking pending Telegram actions.
const genId = () => Math.random().toString(36).slice(2, 8);

// EXACT ORIGINAL TELEGRAM FUNCTION - UNTOUCHED
async function sendTelegram(text) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
    console.warn("[Telegram] Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID in .env");
    return;
  }
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: "Markdown" }),
    });
  } catch (err) {
    console.error("[Telegram Error]", err.message);
  }
}

// Initializes the GitHub App configuration using local environment variables and keys.
const app = new App({
  appId: process.env.APP_ID,
  privateKey: fs.readFileSync(process.env.PRIVATE_KEY_PATH, "utf8"),
  webhooks: { secret: process.env.WEBHOOK_SECRET },
});

// Sets up an Express server attached to the GitHub webhook middleware.
const server = express();
server.use(createNodeMiddleware(app.webhooks, { path: "/" }));

// Initializes the Gemini 2.5 Flash model with LangChain for the agent's brain.
const model = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-flash", 
  apiKey: process.env.GEMINI_API_KEY,
  temperature: 0,
});

// Stores the dynamic GitHub token generated for the current webhook runtime scope.
let runtimeGithubToken = null;

// Calls the local Python FastMCP server to execute GitHub API functions using the dynamic token.
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
        "X-GitHub-Token": token 
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

// Safely parses JSON strings into JavaScript objects to prevent tool argument crashes.
const unwrap = (input) => {
  try {
    let args = typeof input === "string" ? JSON.parse(input) : input;
    if (!args || typeof args !== "object") return {};
    return args.input ? JSON.parse(args.input) : args;
  } catch {
    return {};
  }
};

// Truncates overly long text strings to prevent token limits when sending data to the AI.
const toSafeText = (value, max = 1200) => {
  if (value === null || value === undefined) return "";
  const text = String(value).replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
};

// Checks if a webhook payload originated from a bot to prevent infinite AI loops.
const isBotSender = (payload) => {
  const login = payload?.sender?.login || "";
  return payload?.sender?.type === "Bot" || login.endsWith("[bot]");
};

// Resolves the proper GitHub token from either LangGraph config, runtime global, or .env fallback.
const resolveGithubToken = (config) => {
  return config?.configurable?.token || runtimeGithubToken || process.env.GITHUB_TOKEN || null;
};

// Defines the array of interactive tools available to the AI agent.
const tools = [
  // Posts an issue comment immediately and notifies the user via Telegram.
  new DynamicTool({
    name: "comment_on_issue",
    description: "Comment on an issue. Args: { repo: string, issue_number: number, comment: string }",
    func: async (input, config) => {
      const args = unwrap(input);
      const res = await callMCP("comment_on_issue", args, resolveGithubToken(config));
      await sendTelegram(`💬 *Commented on Issue #${args.issue_number}* in ${args.repo}:\n\n"${args.comment}"`);
      return res;
    },
  }),
  // Posts an emoji reaction to an issue immediately and notifies the user via Telegram.
  new DynamicTool({
    name: "react_to_issue",
    description: "React to an issue. Args: { repo: string, issue_number: number, reaction: string }",
    func: async (input, config) => {
      const args = unwrap(input);
      const res = await callMCP("react_to_issue", args, resolveGithubToken(config));
      await sendTelegram(`👍 *Reacted to #${args.issue_number}* in ${args.repo} with [${args.reaction}]`);
      return res;
    },
  }),
  // Posts a PR comment immediately and notifies the user via Telegram.
  new DynamicTool({
    name: "comment_on_pull_request",
    description: "Comment on a pull request. Args: { repo: string, pull_number: number, comment: string }",
    func: async (input, config) => {
      const args = unwrap(input);
      const res = await callMCP("comment_on_pull_request", args, resolveGithubToken(config));
      await sendTelegram(`💬 *Commented on PR #${args.pull_number}* in ${args.repo}:\n\n"${args.comment}"`);
      return res;
    },
  }),
  // Submits an official PR review (Approve/Changes Requested) immediately and notifies Telegram.
  new DynamicTool({
    name: "create_pull_request_review",
    description: "Submits an official PR Review. 'event' must be APPROVE, REQUEST_CHANGES, or COMMENT. Args: { repo: string, pull_number: number, event: string, body: string }",
    func: async (input, config) => {
      const args = unwrap(input);
      const res = await callMCP("create_pull_request_review", args, resolveGithubToken(config));
      await sendTelegram(`📝 *PR Review Submitted (${args.event})* on PR #${args.pull_number} in ${args.repo}:\n\n"${args.body}"`);
      return res;
    },
  }),
  // Assigns a user to an issue or PR immediately and notifies the user via Telegram.
  new DynamicTool({
    name: "assign_issue",
    description: "Assign users to an issue or pull request. Args: { repo: string, issue_number: number, assignees: string[] }",
    func: async (input, config) => {
      const args = unwrap(input);
      const res = await callMCP("assign_issue", args, resolveGithubToken(config));
      await sendTelegram(`👤 *Assigned ${args.assignees.join(", ")}* to #${args.issue_number} in ${args.repo}`);
      return res;
    },
  }),
  // Requires user approval via Telegram before closing an issue.
  new DynamicTool({
    name: "close_issue",
    description: "Close an issue. Args: { repo: string, issue_number: number }",
    func: async (input, config) => {
      const args = unwrap(input);
      const token = resolveGithubToken(config);
      const id = genId();
      pendingActions.set(id, { tool: "close_issue", args, token });
      await sendTelegram(`⚠️ *ISSUE CLOSURE APPROVAL REQUIRED*\nAgent wants to close Issue #${args.issue_number} in ${args.repo}.\n\nReply:\nAPPROVE ${id}\nREJECT ${id}`);
      return `Action queued. Closure request sent to Telegram. The user will handle it asynchronously. You have successfully completed your job, please conclude your response.`;
    },
  }),
  // Requires user approval via Telegram before merging a pull request.
  new DynamicTool({
    name: "merge_pull_request",
    description: "Merge a pull request. Args: { repo: string, pull_number: number, merge_method?: 'merge'|'squash'|'rebase' }",
    func: async (input, config) => {
      const args = unwrap(input);
      const token = resolveGithubToken(config);
      const id = genId();
      pendingActions.set(id, { tool: "merge_pull_request", args, token });
      await sendTelegram(`⚠️ *MERGE APPROVAL REQUIRED*\nAgent wants to merge PR #${args.pull_number} in ${args.repo} (CI tests passed).\n\nReply:\nAPPROVE ${id}\nREJECT ${id}`);
      return `Action queued. Merge request sent to Telegram. The user will handle it asynchronously. You have successfully completed your job, please conclude your response.`;
    },
  }),
  // Silently fetches details of a specific issue.
  new DynamicTool({ name: "get_issue", description: "Get issue details.", func: async (input, config) => await callMCP("get_issue", unwrap(input), resolveGithubToken(config)) }),
  // Silently lists issues from a repository.
  new DynamicTool({ name: "list_issues", description: "List issues in a repo.", func: async (input, config) => await callMCP("list_issues", unwrap(input), resolveGithubToken(config)) }),
  // Silently creates a new issue.
  new DynamicTool({ name: "create_issue", description: "Create a new issue.", func: async (input, config) => await callMCP("create_issue", unwrap(input), resolveGithubToken(config)) }),
  // Silently reopens a closed issue.
  new DynamicTool({ name: "reopen_issue", description: "Reopen an issue.", func: async (input, config) => await callMCP("reopen_issue", unwrap(input), resolveGithubToken(config)) }),
  // Silently adds labels to an issue.
  new DynamicTool({ name: "add_issue_labels", description: "Add labels to issue.", func: async (input, config) => await callMCP("add_issue_labels", unwrap(input), resolveGithubToken(config)) }),
  // Silently fetches repository metadata.
  new DynamicTool({ name: "get_repository", description: "Get repository details.", func: async (input, config) => await callMCP("get_repository", unwrap(input), resolveGithubToken(config)) }),
  // Silently fetches the list of repositories accessible to the installation.
  new DynamicTool({ name: "get_installation_repositories", description: "List repos.", func: async (input, config) => await callMCP("get_installation_repositories", unwrap(input), resolveGithubToken(config)) }),
  // Silently fetches details for a specific pull request.
  new DynamicTool({ name: "get_pull_request", description: "Get PR details.", func: async (input, config) => await callMCP("get_pull_request", unwrap(input), resolveGithubToken(config)) }),
  // Silently fetches the raw text diff of a pull request.
  new DynamicTool({ name: "get_pr_diff", description: "Get raw diff.", func: async (input, config) => await callMCP("get_pr_diff", unwrap(input), resolveGithubToken(config)) }),
  // Silently fetches the status of recent GitHub Actions CI/CD runs.
  new DynamicTool({ name: "get_workflow_runs", description: "Get CI/CD status.", func: async (input, config) => await callMCP("get_workflow_runs", unwrap(input), resolveGithubToken(config)) }),
  // Silently fetches the decoded text content of a specific file.
  new DynamicTool({ name: "get_file_content", description: "Get file plaintext.", func: async (input, config) => await callMCP("get_file_content", unwrap(input), resolveGithubToken(config)) }),
  // Silently fetches a list of files modified within a pull request.
  new DynamicTool({ name: "list_pr_files", description: "List files changed in PR.", func: async (input, config) => await callMCP("list_pr_files", unwrap(input), resolveGithubToken(config)) }),
  // Silently fetches the entire directory tree mapping of the repository.
  new DynamicTool({ name: "get_repo_tree", description: "List all file paths.", func: async (input, config) => await callMCP("get_repo_tree", unwrap(input), resolveGithubToken(config)) }),
  // Silently searches the codebase for a specific query and returns matching file paths.
  new DynamicTool({ name: "search_repo_code", description: "Search codebase.", func: async (input, config) => await callMCP("search_repo_code", unwrap(input), resolveGithubToken(config)) }),
];

// Creates the LangGraph agent equipped with the LLM and the tools defined above.
const agent = createReactAgent({ llm: model, tools });

// Authenticates the app, supplies the token to the agent, and invokes it with the user prompt.
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

    const { token } = await octokit.auth({ type: "installation" });
    runtimeGithubToken = token;

    const result = await agent.invoke(
      { messages: [{ role: "user", content: input }] },
      { configurable: { token: token } }
    );

    console.log(`\nFinal Response for ${eventName}: ${result.messages[result.messages.length - 1].content}`);
  } catch (error) {
    console.error("\x1b[31m[Agent Crash]\x1b[0m", error);
  } finally {
    runtimeGithubToken = null;
  }
};

// Filters out bot-originated events and ensures a valid repository exists before triggering the agent.
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

  await handleEvent({ input: prompt, installationId, eventName, action: payload?.action, repo, octokit });
};

// Intercepts general issue events like opens, edits, and closes to instruct the AI.
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

// Intercepts issue comments to instruct the AI to reply to questions or assign users if asked.
app.webhooks.on("issue_comment", async ({ payload, octokit }) => {
  if (payload.action !== "created") return;

  const repo = payload.repository.full_name;
  const issue = payload.issue;
  const comment = toSafeText(payload.comment?.body);
  const author = payload.comment?.user?.login || "unknown";

  const prompt = `New issue comment in ${repo} on issue #${issue.number} by ${author}: "${comment}". If a reply is needed, post a concise helpful response. If they ask to be assigned, assign them. And please reply to them if they ask any kind of questions.`;
  await processWebhook({ eventName: "issue_comment", payload, prompt, octokit });
});

// Intercepts pull request creations/updates to instruct the AI to review code, run impact analysis, and leave feedback.
app.webhooks.on("pull_request", async ({ payload, octokit }) => {
  const action = payload.action;
  const repo = payload.repository.full_name;
  const pr = payload.pull_request;
  const title = toSafeText(pr?.title);
  const body = toSafeText(pr?.body);

  let prompt = null;
  if (action === "opened" || action === "synchronize" || action === "ready_for_review") {
    prompt = `
      Pull request ${action} in ${repo}. PR #${pr.number}: "${title}".
      Body: "${body}".

      You are a Senior AI Code Reviewer. Perform a thorough, structured review following this SOP:

      1. FILE ANALYSIS
        - Use 'list_pr_files' to retrieve all modified, added, and deleted files.
        - Identify high-impact files (core logic, shared modules, configs).

      2. DIFF REVIEW
        - Use 'get_pr_diff' to inspect the exact code changes.
        - Focus on: logic correctness, edge cases, readability, and security.

      3. REPOSITORY CONTEXT MAPPING
        - Use 'get_repo_tree' to understand overall project structure if needed.

      4. IMPACT ANALYSIS (CRITICAL)
        - If any core function, module, or shared component is modified:
          a. Use 'search_repo_code' to locate where it is used across the repo.
          b. For each relevant file found, use 'get_file_content' to inspect usage and verify nothing breaks.

      5. DECISION MAKING
        Based on your analysis:
        ✅ If everything is correct: Use 'create_pull_request_review' with event "APPROVE" and summarize why.
        ❌ If issues are found: Use 'create_pull_request_review' with event "REQUEST_CHANGES" and detail what needs fixing.

      6. IMPORTANT CONSTRAINTS
        - DO NOT merge the PR under any circumstances. Let CI/CD pipeline finish first.
      `;
  } else if (action === "closed" && pr?.merged) {
    prompt = `Pull request merged in ${repo}. PR #${pr.number}: "${title}". Use 'react_to_issue' to add a rocket or hooray emoji.`;
  }

  await processWebhook({ eventName: "pull_request", payload, prompt, octokit });
});

// Intercepts user pull request reviews to instruct the AI to summarize if necessary.
app.webhooks.on("pull_request_review", async ({ payload, octokit }) => {
  if (payload.action !== "submitted") return;
  const repo = payload.repository.full_name;
  const pr = payload.pull_request;
  const reviewState = payload.review?.state || "commented";

  const prompt = `Pull request review submitted in ${repo}. PR #${pr.number}, review state: ${reviewState}. If needed, post a follow-up comment summarizing the review status.`;
  await processWebhook({ eventName: "pull_request_review", payload, prompt, octokit });
});

// Intercepts CI/CD pipeline completion events to prompt merges on success, or code investigation on failure.
app.webhooks.on("workflow_run", async ({ payload, octokit }) => {
  if (payload.action !== "completed") return;

  const repo = payload.repository.full_name;
  const run = payload.workflow_run;
  const prs = run.pull_requests;

  if (!prs || prs.length === 0) return;

  const prNumber = prs[0].number;
  const conclusion = run.conclusion;

  let prompt = null;
  if (conclusion === "success") {
    prompt = `
      CI Workflow "${run.name}" passed successfully for PR #${prNumber} in ${repo}. 
      The code is tested and safe. Execute the 'merge_pull_request' tool to queue the PR for final human merge approval via Telegram.
    `;
  } else if (conclusion === "failure" || conclusion === "cancelled") {
    prompt = `
      CI Workflow "${run.name}" FAILED for PR #${prNumber} in ${repo}.
      1. Use 'get_pr_diff' and 'list_pr_files' to quickly see what might have broken the build.
      2. Use 'comment_on_pull_request' to kindly inform the author that their tests failed and suggest where they should look to fix it.
      (Do not attempt to merge).
    `;
  }

  await processWebhook({ eventName: "workflow_run", payload, prompt, octokit });
});

// Intercepts code push events to instruct the AI to leave status updates on explicitly linked open issues.
app.webhooks.on("push", async ({ payload, octokit }) => {
  const repo = payload.repository.full_name;
  const ref = payload.ref;
  const commits = payload.commits?.length || 0;
  const prompt = `Push event in ${repo} on ${ref} with ${commits} commit(s). Create a concise status note as an issue comment only if there is an open issue explicitly requesting update tracking.`;
  await processWebhook({ eventName: "push", payload, prompt, octokit });
});

// Logs basic text output to the console whenever the GitHub app is installed to a new account.
app.webhooks.on("installation", async ({ payload }) => {
  const action = payload.action;
  const account = payload.installation?.account?.login || "unknown";
  console.log(`[Installation] action=${action} account=${account}`);
});

// Catches and logs any unexpected errors thrown inside the webhook routing middleware.
app.webhooks.onError((error) => {
  console.error("[Webhook Error]", error.message || error);
});

// Receives HTTP POST requests from the Telegram bot with approval/rejection commands to execute queued AI tools.
server.post("/telegram", express.json(), async (req, res) => {
  res.sendStatus(200); 

  const text = (req.body?.message?.text || "").trim();
  const parts = text.split(" ");
  const command = parts[0]?.toUpperCase();
  const id = parts[1];

  if (!id) return;

  if (!pendingActions.has(id)) {
    await sendTelegram(`⚠️ No pending action found for ID: \`${id}\`. It may have expired.`);
    return;
  }

  const pending = pendingActions.get(id);
  pendingActions.del(id); // Deletes immediately from cache upon execution

  // Temporarily load the saved GitHub token into the global variable 
  // so the AI tools have permission to read the repo during this REJECT flow.
  runtimeGithubToken = pending.token;

  try {
    if (command === "APPROVE") {
      console.log(`[Telegram] Action ${id} approved. Executing...`);
      const result = await callMCP(pending.tool, pending.args, pending.token);
      await sendTelegram(`✅ *Action Approved and Executed!*\n\n${result}`);
    } else if (command === "REJECT") {
      console.log(`[Telegram] Action ${id} rejected.`);
      await sendTelegram(`❌ *Action rejected*. Instructing agent to review and request changes...`);

      // If a merge request was rejected, re-invoke the agent to request changes instead.
      if (pending.tool === "merge_pull_request") {
        const prompt = `The repository maintainer explicitly REJECTED the merge for PR #${pending.args.pull_number} in ${pending.args.repo}. Please use 'get_pr_diff' and 'list_pr_files' to review the code again, figure out what might be wrong, and use 'create_pull_request_review' with event "REQUEST_CHANGES" to leave detailed feedback on what the author needs to fix.`;
        
        try {
          const result = await agent.invoke(
            { messages: [{ role: "user", content: prompt }] }
          );
          console.log(`\nFinal Response for REJECT: ${result.messages[result.messages.length - 1].content}`);
        } catch (err) {
          console.error("\x1b[31m[Agent Crash on Reject]\x1b[0m", err);
        }
      }
    }
  } finally {
    // Clear the token after the AI finishes so we don't leak permissions
    runtimeGithubToken = null; 
  }
});


// Starts the Express application on port 3000 to listen for incoming GitHub webhooks and Telegram callbacks.
server.listen(3000, () => console.log("Backend listening on port 3000"));