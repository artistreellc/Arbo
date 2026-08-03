/**
 * Push the repo prompt + first message to the LIVE agent.
 * Safety: shows what would change and requires an explicit --yes.
 *
 *   npm run agent:push          (dry run — shows the diff summary)
 *   npm run agent:push -- --yes (actually updates the live agent)
 */
import { readFileSync } from "node:fs";
import { getAgent, updateAgent } from "../src/elevenlabs/client.js";

const localPrompt = readFileSync("agent/prompt/system-prompt.md", "utf8").trimEnd();
const localFirst = readFileSync("agent/first-message.txt", "utf8").trim();

const live = await getAgent();
const livePrompt = live.conversation_config.agent.prompt.prompt.trimEnd();
const liveFirst = live.conversation_config.agent.first_message.trim();

const promptChanged = localPrompt !== livePrompt;
const firstChanged = localFirst !== liveFirst;

console.log(`Live agent: ${live.name} (${live.agent_id})`);
console.log(`  prompt:        ${promptChanged ? `CHANGED (${livePrompt.length} -> ${localPrompt.length} chars)` : "unchanged"}`);
console.log(`  first message: ${firstChanged ? "CHANGED" : "unchanged"}`);

if (!promptChanged && !firstChanged) {
  console.log("Nothing to push.");
  process.exit(0);
}

if (!process.argv.includes("--yes")) {
  console.log("\nDry run only. Re-run with --yes to update the LIVE agent.");
  process.exit(0);
}

await updateAgent({
  conversation_config: {
    agent: {
      first_message: localFirst,
      prompt: { prompt: localPrompt },
    },
  },
});

console.log("Pushed to live agent.");
