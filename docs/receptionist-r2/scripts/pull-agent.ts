/**
 * Pull the LIVE agent config into the repo (snapshot -> agent/).
 * Live agent wins on pull; repo files are overwritten. Run before editing.
 *
 *   npm run agent:pull
 */
import { writeFileSync } from "node:fs";
import { getAgent } from "../src/elevenlabs/client.js";

const agent = await getAgent();

writeFileSync("agent/agent.live-snapshot.json", JSON.stringify(agent, null, 2) + "\n");
writeFileSync("agent/prompt/system-prompt.md", agent.conversation_config.agent.prompt.prompt.trimEnd() + "\n");
writeFileSync("agent/first-message.txt", agent.conversation_config.agent.first_message.trimEnd() + "\n");

console.log(`Pulled ${agent.name} (${agent.agent_id})`);
console.log(`  prompt  -> agent/prompt/system-prompt.md (${agent.conversation_config.agent.prompt.prompt.length} chars)`);
console.log(`  greeting-> agent/first-message.txt`);
console.log(`  full    -> agent/agent.live-snapshot.json`);
