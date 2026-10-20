/*
  SLOW::ARBO — a write switch. The note at the top of src/db/client.ts
  applies here in full.
*/

/**
 * R33 — GOOGLE AND QUO CONNECTED READ-ONLY. Mike, 2026-10-20, verbatim:
 * "Connect Google as a read only and connect quo as read only".
 *
 * GOOGLE is read-only BY CONSTRUCTION. Arbo asks Google for three read
 * permissions and nothing else (`GOOGLE_SCOPES`, googleTokenStore.ts), and
 * every Google write Arbo's code could make refuses IN CODE whatever a token
 * can do — a token Mike granted before R33 still carries `calendar.events`,
 * and it is treated as read-only all the same. Off with it: the R18
 * calendar hold, the D36 won-estimate recolor, and the Drive folder create.
 * There is no variable that turns a Google write back on: that takes a code
 * change AND a new Google consent with a write permission, both on Mike's
 * word only.
 *
 * QUO API keys cannot be scoped, so Arbo enforces it here: ONE switch,
 * read-only unless `ARBO_QUO_SEND` is EXACTLY `live` — a value only Mike
 * sets, on his explicit word. Until then every Quo write Arbo's code can
 * make refuses by name: a text (R22 — the catch-up, the follow-ups, any
 * route), and registering, replacing or deleting Arbo's own webhooks.
 * Reads keep working: calls, texts, transcripts, summaries, the R24 study,
 * and the webhook intake.
 *
 * §1B: "off on purpose (read-only)" is its own state everywhere — never
 * "failed", never "nothing to send", never "not connected". Logs carry
 * counts and ids only (§4.3).
 *
 * Read at call time, never cached — a restart or a test sees the truth.
 */

// ─── Google ──────────────────────────────────────────────────────────────

/** Google writes are OFF (R33). Typed `boolean` so the code that runs once Mike rules them back on stays checked. */
export const GOOGLE_READ_ONLY: boolean = true;

/** What every hold result says while Google is read-only — the Calls cards, Today, Talk, the records route. */
export const GOOGLE_HOLDS_OFF_LINE =
  'Calendar holds are off — Google is connected read-only (Mike, 2026-10-20). Sona’s requested time is shown on the call card for you to book.';

export type GoogleWrite = 'calendar.create' | 'calendar.recolor' | 'drive.createFolder';

/** A Google write refused before anything left Arbo — not a Google outage, not a failed call. */
export class GoogleReadOnlyError extends Error {
  constructor(readonly write: GoogleWrite) {
    super(`Google is connected read-only (R33, Mike 2026-10-20) — ${write} refused; nothing was sent to Google`);
    this.name = 'GoogleReadOnlyError';
  }
}

// ─── Quo ─────────────────────────────────────────────────────────────────

/** The one Quo write switch. Exactly `live` — set only on Mike's explicit word. */
export const QUO_SEND_VAR = 'ARBO_QUO_SEND';

/** True only when ARBO_QUO_SEND is exactly 'live'. Unset, empty, 'LIVE', 'true', a stray space: read-only. */
export function quoWritesLive(): boolean {
  return process.env[QUO_SEND_VAR] === 'live';
}

/** The app's send and catch-up buttons say this while Quo is read-only. */
export const QUO_READ_ONLY_LINE = 'Quo is read-only — send from the Quo app.';

/** A webhook Arbo would have registered, and won't while read-only. */
export const QUO_HOOK_MISSING_LINE =
  'Quo webhook missing — Arbo is read-only and won’t create it; texts and calls are read from Quo’s record instead.';

/** A webhook that exists, whose signing key Quo will not show Arbo — Arbo used to replace it, and won't while read-only. */
export const QUO_HOOK_NO_KEY_LINE =
  'Quo webhook found, but Quo won’t show Arbo its signing key — Arbo is read-only and won’t replace it; texts and calls are read from Quo’s record instead.';

export type QuoWrite = 'message.send' | 'webhook.create' | 'webhook.delete';

/** A Quo write refused before anything left Arbo. */
export class QuoReadOnlyError extends Error {
  constructor(readonly write: QuoWrite) {
    super(`Quo is read-only (R33, ${QUO_SEND_VAR} is not "live") — ${write} refused; nothing was sent to Quo`);
    this.name = 'QuoReadOnlyError';
  }
}

// ─── Boot ────────────────────────────────────────────────────────────────

/** The two boot lines — one per mode, never a secret, never a number. */
export function readOnlyBootLines(): string[] {
  return [
    GOOGLE_READ_ONLY
      ? '[google] READ-ONLY (R33) — Arbo asks Google to read Gmail, the calendar and Drive, nothing else; calendar holds, the won-estimate recolor and Drive folders are OFF, and an older sign-in that could write is still used read-only'
      : '[google] WRITES ON — calendar holds may be created (R18)',
    quoWritesLive()
      ? `[quo] WRITES ON — ${QUO_SEND_VAR}=live (Mike's word): Arbo may text through Quo (R22) and register its own webhooks`
      : `[quo] READ-ONLY (R33) — ${QUO_SEND_VAR} is not "live": no text is sent and no webhook is created or replaced; calls, texts, transcripts and the customer study are read`,
  ];
}
