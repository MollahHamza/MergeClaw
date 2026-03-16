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