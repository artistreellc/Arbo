/**
 * Post-call webhook receiver — ElevenLabs POSTs the transcript here after every call.
 * Brief rule this serves: "silence is never success" — every call must land somewhere Mike can see.
 *
 * Current behavior (base layer):
 *  - verifies the HMAC signature when ELEVENLABS_WEBHOOK_SECRET is set
 *  - saves the raw payload to data/transcripts/<conversation_id>.json
 *  - flags probable emergencies from the transcript text (stub heuristic)
 * Later layers: estimate/job record creation, calendar hold, Mike alert, Client Master DB.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import type { Request, Response } from "express";
import { config } from "../config.js";

const EMERGENCY_HINTS = [/fell/i, /fallen/i, /on (the |my )?(house|roof|car|truck|garage|fence|power line)/i, /emergency/i, /blocking (the )?(road|driveway)/i];

export function verifySignature(rawBody: Buffer, header: string | undefined): boolean {
  const secret = config.elevenLabs.webhookSecret;
  if (!secret) {
    console.warn("[postCall] ELEVENLABS_WEBHOOK_SECRET not set — SKIPPING signature verification (dev only).");
    return true;
  }
  if (!header) return false;
  // Header format: "t=<unix>,v0=<hex hmac of `${t}.${body}`>"
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const t = parts["t"];
  const v0 = parts["v0"];
  if (!t || !v0) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody.toString("utf8")}`).digest("hex");
  const a = Buffer.from(v0);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function handlePostCall(req: Request, res: Response): void {
  const raw = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
  if (!verifySignature(raw, req.header("ElevenLabs-Signature"))) {
    res.status(401).json({ error: "bad signature" });
    return;
  }

  const payload = req.body as { type?: string; data?: { conversation_id?: string; transcript?: Array<{ role: string; message: string }> } };
  const conversationId = payload?.data?.conversation_id ?? `unknown-${Date.now()}`;

  mkdirSync("data/transcripts", { recursive: true });
  writeFileSync(`data/transcripts/${conversationId}.json`, JSON.stringify(payload, null, 2) + "\n");

  const text = (payload?.data?.transcript ?? []).map((t) => t.message).join(" ");
  const emergency = EMERGENCY_HINTS.some((re) => re.test(text));
  if (emergency) {
    // TODO(next layer): real alert to Mike (SMS/push). Base layer just makes it impossible to miss in logs.
    console.error(`[postCall] EMERGENCY FLAG on conversation ${conversationId} — needs Mike, now.`);
  }

  console.log(`[postCall] saved transcript ${conversationId}${emergency ? " [EMERGENCY]" : ""}`);
  res.json({ ok: true, emergency });
}
