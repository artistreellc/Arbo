/*
  SLOW::ARBO — a link switch. The note at the top of src/db/client.ts
  applies here in full.
*/

/**
 * VENDOR LINK SWITCHES — owner instruction, 2026-09-24 (R21). Mike: "make
 * sure you disconnect the twilio and eleven labs links while we develop off
 * sona".
 *
 * Arbo's own phone line (Twilio number → ElevenLabs agent → Arbo's guarded
 * Opus bridge) is CUT while Sona (Quo) answers the calls. Same opt-in shape
 * as the data links: a link is open ONLY when its variable is exactly
 * 'live'. Missing, misspelled, or miscased leaves it cut — reconnecting is a
 * deliberate act, never an accident of a stale config.
 *
 * Cutting a link refuses every door that link opens, BY NAME (§1B):
 *   elevenlabs — the voice bridge (/voice/llm), the post-call webhook, the
 *                Talk-to-Arbo page, and the spoken brief (ElevenLabs TTS);
 *   twilio     — the incoming-text webhook on the Arbo number.
 * Nothing is deleted: the agent, the number, and every secret stay exactly
 * where they are, one variable away from coming back.
 *
 * Independent of ARBO_DATA_LINKS — these are phone vendors, not tables.
 */

export type VendorLink = 'elevenlabs' | 'twilio';

export const VENDOR_LINKS: VendorLink[] = ['elevenlabs', 'twilio'];

export function vendorEnvVar(link: VendorLink): string {
  return `ARBO_LINK_${link.toUpperCase()}`;
}

/** Read at call time, never cached — a restart or a test sees the truth. */
export function vendorLinked(link: VendorLink): boolean {
  return process.env[vendorEnvVar(link)] === 'live';
}

export function cutVendorLinks(): VendorLink[] {
  return VENDOR_LINKS.filter((l) => !vendorLinked(l));
}

/** The refusal body every cut door answers with. No caller content, ever. */
export function vendorCutBody(link: VendorLink): { error: 'link_cut'; link: VendorLink; message: string } {
  return {
    error: 'link_cut',
    link,
    message: `The ${link === 'elevenlabs' ? 'ElevenLabs' : 'Twilio'} link is CUT while Sona (Quo) handles calls (R21). Set ${vendorEnvVar(link)}=live to reconnect. Nothing was deleted.`,
  };
}
