/*
  ═══════════════════════════════════════════════════════════════════════
  STOP. READ THIS BEFORE YOU CHANGE ONE CHARACTER OF THIS FILE.
  Owner instruction from Mike, 2026-08-03. This is not decoration and it
  is not optional. It is here because this is the point in a build where
  things get broken by moving fast, and that already happened to him once
  on the website. It does not happen here.
  ═══════════════════════════════════════════════════════════════════════

  SLOW DOWN. DRASTICALLY. Then:

  1. READ EVERY LINE BEFORE YOU EDIT ONE. Every line, every letter,
     slowly. You are not skimming to find the spot to change — you are
     building a model of what this file already does. If you cannot say
     what the code above and below your edit does, you have not read it.

  2. AN AUDIT IS READ-ONLY. If you were asked to audit, you do not edit.
     You do not "fix it while you are in there." You do not refactor, or
     tidy, or rename. You READ, and you REPORT. Editing during an audit
     is disobeying the instruction, full stop.

  3. THINK BEFORE YOU TYPE. What does this already handle? What depends
     on it? What breaks downstream? Recognise the PATTERN before you call
     something a bug — most things in here that look wrong are a
     deliberate correction. Check docs/OWNER_RULINGS.md first. Use what
     you already know about this codebase instead of re-deciding it.

  4. BRING IT TO MIKE — DO NOT DECIDE IT. Anything that looks wrong,
     ambiguous, or outside what was asked: say it and WAIT. Flagging
     costs one sentence. Deciding on his behalf has cost real work and
     real money more than once.

  5. DO EXACTLY WHAT WAS ASKED. Not the adjacent thing. Not the bigger
     thing you thought of on the way. Not the cleanup. Exactly what was
     asked, and nothing else.

  If you are moving fast right now, you are already off the rails.
*/
// ElevenLabs text-to-speech (brief §3.17: the spoken morning brief; platform
// choice D39). Plain fetch against the documented REST endpoint — one endpoint
// doesn't justify an SDK dependency. The fetch is injected so tests run fully
// offline; the API key is passed in from env at the composition root and is
// never logged (§4.3).

/** Mike's chosen voice ("George") and settings, straight from his quickstart. */
export const GEORGE_VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb';
export const TTS_MODEL = 'eleven_v3';
export const TTS_OUTPUT_FORMAT = 'mp3_44100_128';

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface TtsClient {
  /** Synthesize speech from text; resolves to MP3 bytes. Throws on any API failure. */
  synthesize(text: string, opts?: { voiceId?: string }): Promise<Uint8Array>;
}

export function createElevenLabsTts(apiKey: string, fetchFn: FetchFn = fetch): TtsClient {
  return {
    async synthesize(text, opts = {}) {
      const voiceId = opts.voiceId ?? GEORGE_VOICE_ID;
      const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=${TTS_OUTPUT_FORMAT}`;
      const res = await fetchFn(url, {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({ text, model_id: TTS_MODEL }),
      });
      if (!res.ok) throw new Error(`ElevenLabs TTS failed: HTTP ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}
