/** Central env config. Loaded via `node --env-file=.env` (no dotenv dependency needed on Node 20+). */

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name} — copy .env.example to .env and fill it in.`);
  return v;
}

export const config = {
  elevenLabs: {
    apiKey: () => required("ELEVENLABS_API_KEY"),
    agentId: process.env.ELEVENLABS_AGENT_ID ?? "agent_1901kyyxyj2sf9nsx9jascy2ssxj",
    webhookSecret: process.env.ELEVENLABS_WEBHOOK_SECRET ?? "",
    baseUrl: "https://api.elevenlabs.io",
  },
  port: Number(process.env.PORT ?? 3000),
};
