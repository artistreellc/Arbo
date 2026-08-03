/**
 * Agent tool endpoints — the server tools ARBOR will call mid-conversation once wired
 * up in ElevenLabs (Agent -> Tools -> Webhook tool pointing at these routes).
 *
 * Base-layer stubs: validate input, enforce the guardrails that belong in CODE
 * (not just the prompt), persist a record, return what the agent should say.
 * No external side effects yet (no calendar write, no SMS) — that's the next layer.
 *
 * Brief guardrails enforced here:
 *  - bookEstimate NEVER commits a date/time — it records a request; Mike confirms. (Golden Rule 3)
 *  - service area is validated in code, not trusted to the model. (Service-area rule)
 *  - emergencyAlert is its own path so a fallen-tree call never slots as a normal estimate.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import type { Request, Response } from "express";

const SERVICE_AREA = ["virginia beach", "norfolk", "chesapeake", "portsmouth"];

function saveRecord(kind: string, record: Record<string, unknown>): string {
  const id = `${kind}-${Date.now()}`;
  mkdirSync(`data/${kind}`, { recursive: true });
  writeFileSync(`data/${kind}/${id}.json`, JSON.stringify({ id, receivedAt: new Date().toISOString(), ...record }, null, 2) + "\n");
  return id;
}

export function inServiceArea(city: string | undefined): boolean {
  return !!city && SERVICE_AREA.includes(city.trim().toLowerCase());
}

/** POST /tools/book-estimate — records an estimate REQUEST (never a confirmed slot). */
export function bookEstimate(req: Request, res: Response): void {
  const { callerName, phone, address, city, jobType, treeDetails, nearPowerLines } = req.body ?? {};
  if (!callerName || !phone || !address || !city) {
    res.status(400).json({ ok: false, agentMessage: "I still need a name, phone number, and address before I can get you on the schedule." });
    return;
  }
  if (!inServiceArea(String(city))) {
    res.json({
      ok: false,
      outOfArea: true,
      agentMessage: "We actually focus on Virginia Beach, Norfolk, Chesapeake, and Portsmouth. I'd hate to book you and not be able to make it out — let me point you the right direction.",
    });
    return;
  }
  const id = saveRecord("estimate-requests", { callerName, phone, address, city, jobType, treeDetails, nearPowerLines: !!nearPowerLines });
  res.json({
    ok: true,
    requestId: id,
    agentMessage: `You're on the list for a free estimate, ${callerName} — Mike will confirm the exact time.`,
  });
}

/** POST /tools/emergency-alert — fallen tree / tree on structure. Never a normal estimate. */
export function emergencyAlert(req: Request, res: Response): void {
  const { callerName, phone, address, situation } = req.body ?? {};
  if (!address || !phone) {
    res.status(400).json({ ok: false, agentMessage: "I need the address and a callback number first so we can get someone moving." });
    return;
  }
  const id = saveRecord("emergencies", { callerName, phone, address, situation });
  // TODO(next layer): actually page Mike (SMS/push). Base layer records it loudly.
  console.error(`[emergency] ${id}: ${address} — ${situation ?? "no details"}`);
  res.json({ ok: true, requestId: id, agentMessage: "We treat these as priority — Mike is being alerted right away." });
}

/** POST /tools/photo-link — caller wants to text photos of the tree. */
export function photoLink(req: Request, res: Response): void {
  const { phone } = req.body ?? {};
  if (!phone) {
    res.status(400).json({ ok: false, agentMessage: "What's the best number to text that link to?" });
    return;
  }
  const id = saveRecord("photo-link-requests", { phone });
  // TODO(next layer): send the actual SMS with an upload link.
  res.json({ ok: true, requestId: id, agentMessage: "I'll have that link texted over so you can send us pictures of the tree." });
}
