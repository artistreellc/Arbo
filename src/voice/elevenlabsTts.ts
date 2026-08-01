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
