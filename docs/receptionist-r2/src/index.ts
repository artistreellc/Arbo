/** Arbo receptionist server — base layer. Webhook receiver + agent tool endpoints. */
import express from "express";
import { config } from "./config.js";
import { handlePostCall } from "./webhooks/postCall.js";
import { bookEstimate, emergencyAlert, photoLink } from "./tools/index.js";

const app = express();

// Keep the raw body around for webhook HMAC verification.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
    },
  })
);

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "arbo-receptionist", agentId: config.elevenLabs.agentId });
});

// ElevenLabs post-call webhook (configure in dashboard -> Webhooks -> point at this URL)
app.post("/webhooks/post-call", handlePostCall);

// Agent server tools (wire in ElevenLabs agent -> Tools as webhook tools)
app.post("/tools/book-estimate", bookEstimate);
app.post("/tools/emergency-alert", emergencyAlert);
app.post("/tools/photo-link", photoLink);

app.listen(config.port, () => {
  console.log(`arbo-receptionist listening on :${config.port}`);
});

export default app;
