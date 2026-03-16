const { App } = require("octokit");
const fs = require("fs");
const express = require("express");
const { createNodeMiddleware } = require("@octokit/webhooks");
const { createReactAgent } = require("@langchain/langgraph/prebuilt");
const { DynamicTool } = require("@langchain/core/tools");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
require("dotenv").config();

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
 * Helper to call MCP with Dynamic Auth Token
 */
async function callMCP(tool, args, githubToken) {
  try {
    if (!githubToken) {
      return "Error: Missing GitHub installation token";
    }

    console.log(`\x1b[33m[MCP Call]\x1b[0m Tool: ${tool}`);
    const res = await fetch(`http://localhost:8000/mcp/tools/${tool}`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "X-GitHub-Token": githubToken // Passing the App's dynamic token
      },
      body: JSON.stringify(args),
    });

    const raw = await res.text();
    let data = null;
    try {
      data = JSON.parse(raw);
    } catch {
      // Leave data as null and use raw body below.
    }

    if (!res.ok) {
      return `Error: MCP ${res.status} ${res.statusText} - ${raw}`;
    }

    return data?.content?.[0]?.text || raw;
  } catch (err) {
    console.error(`\x1b[31m[MCP Error]\x1b[0m`, err.message);
    return `Error: ${err.message}`;
  }
}

const resolveGithubToken = (config) => {
  return config?.configurable?.token || runtimeGithubToken || process.env.GITHUB_TOKEN || null;
};

/**
 * Logic to unwrap Gemini's tool arguments
 */
const unwrap = (input) => {
  let args = typeof input === "string" ? JSON.parse(input) : input;
  return args.input ? JSON.parse(args.input) : args;
};

// Tool Definitions
// Note: We use the 'config' parameter to get the token passed from handleEvent
const tools = [
  new DynamicTool({
    name: "comment_on_issue",
    description: "Comment on an issue. Args: { repo: string, issue_number: number, comment: string }",
    func: async (input, config) => await callMCP("comment_on_issue", unwrap(input), resolveGithubToken(config)),
  }),
  new DynamicTool({
    name: "react_to_issue",
    description: "React to an issue description. Args: { repo: string, issue_number: number, reaction: string }",
    func: async (input, config) => await callMCP("react_to_issue", unwrap(input), resolveGithubToken(config)),
  }),
  new DynamicTool({
    name: "get_issue",
    description: "Get issue details. Args: { repo: string, issue_number: number }",
    func: async (input, config) => await callMCP("get_issue", unwrap(input), resolveGithubToken(config)),
  }),
];

const agent = createReactAgent({ llm: model, tools });

const handleEvent = async (input, octokit) => {
  console.log("\n--- Starting Agent Execution ---");
  try {
    // Generate a temporary token for this specific installation
    const { token } = await octokit.auth({ type: "installation" });
    runtimeGithubToken = token;

    const result = await agent.invoke(
      { messages: [{ role: "user", content: input }] },
      { configurable: { token: token } } // Pass token to tools via config
    );

    console.log(`\nFinal Response: ${result.messages[result.messages.length - 1].content}`);
  } catch (error) {
    console.error("\x1b[31m[Agent Crash]\x1b[0m", error);
  } finally {
    runtimeGithubToken = null;
  }
};

// Webhook Handlers
app.webhooks.on("issues.opened", async ({ octokit, payload }) => {
  const repo = payload.repository.full_name;
  const issue = payload.issue;
  await handleEvent(
    `New issue #${issue.number} in ${repo}: "${issue.title}". Body: ${issue.body}. Acknowledge and react with rocket.`,
    octokit
  );
});

server.listen(3000, () => console.log("Backend listening on port 3000"));

