import { getConfig } from "./lib/config";
import { Anthropic } from "@anthropic-ai/sdk";

async function test() {
  const config = getConfig();
  console.log("Config loaded:", { sapUrl: config.sapUrl, emailUser: config.emailUser });
  
  if (config.anthropicApiKey) {
    try {
      const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });
      console.log("Anthropic API Key found. Testing...");
      // We won't actually call the API to save tokens, just check if it's there
      console.log("Anthropic SDK initialized OK");
    } catch (e) {
      console.error("Anthropic Init Error:", e);
    }
  } else {
    console.error("Anthropic API Key MISSING");
  }
}

test();
