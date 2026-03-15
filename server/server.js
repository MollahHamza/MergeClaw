const { App } = require("octokit");
const fs = require("fs");
const express = require("express");
const { createNodeMiddleware } = require("@octokit/webhooks");
require("dotenv").config();

const app = new App({
  appId: process.env.APP_ID,
  privateKey: fs.readFileSync(process.env.PRIVATE_KEY_PATH, "utf8"),
  webhooks: {
    secret: process.env.WEBHOOK_SECRET,
  },
});

const server = express();

// Use the official middleware. 
// This automatically handles the path, validation, and headers.
server.use(createNodeMiddleware(app.webhooks, { path: "/" }));

app.webhooks.on("issues.opened", async ({ octokit, payload }) => {
  const issueNumber = payload.issue.number;
  const repoName = payload.repository.name;
  const owner = payload.repository.owner.login;

  console.log(`🚀 Received an issue event for #${issueNumber} in ${repoName}`);

  try {
    // Add the rocket reaction to the issue
    await octokit.rest.reactions.createForIssue({
      owner,
      repo: repoName,
      issue_number: issueNumber,
      content: "rocket", // This adds the 🚀 emoji
    });

    console.log(`✅ Successfully reacted with a rocket to issue #${issueNumber}`);
  } catch (error) {
    console.error(`❌ Error reacting to issue: ${error.message}`);
  }
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`🚀 App is listening for webhooks at: http://localhost:${PORT}/api/github/webhooks`);
});

