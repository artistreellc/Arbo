/*
  ═══════════════════════════════════════════════════════════════════════
  SLOW::ARBO   ← this marker IS this note. Wherever it appears, all of
               it applies: in a file, a commit, a doc, or from Mike.
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

  Remember the marker: SLOW::ARBO
*/
// Minimal ArcGIS REST client for the one question the screen asks a layer:
// "does this point fall inside any polygon of this layer?" (point-in-polygon
// via the standard /query endpoint, returnCountOnly).
//
// STRICT by design (D32): anything short of a well-formed count response —
// HTTP error, esri error body, malformed JSON — THROWS, which the intake
// screen turns into an honest PENDING. A silent false ("not in the layer")
// on a broken endpoint would be a fabricated no-overlay result.

export type FetchFn = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/**
 * True when the WGS84 point intersects any feature of the layer.
 * `distanceMeters` widens the test to "within N meters" — the proximity tier
 * (D37): geocoders return street-centerline points, and the verified Circle
 * Drive case showed the rear-lot RPA sits 150–300 m from that point.
 */
export async function pointIntersectsLayer(
  fetchFn: FetchFn,
  layerUrl: string,
  point: { lat: number; lng: number },
  distanceMeters?: number,
): Promise<boolean> {
  const params = new URLSearchParams({
    f: 'json',
    geometry: JSON.stringify({ x: point.lng, y: point.lat, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    returnCountOnly: 'true',
    where: '1=1',
    ...(distanceMeters ? { distance: String(distanceMeters), units: 'esriSRUnit_Meter' } : {}),
  });
  const url = `${layerUrl.replace(/\/+$/, '')}/query?${params.toString()}`;

  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`ArcGIS query HTTP ${res.status} for ${layerUrl}`);

  const body = (await res.json()) as { count?: unknown; error?: { message?: string } };
  if (body && typeof body === 'object' && body.error) {
    throw new Error(`ArcGIS error for ${layerUrl}: ${body.error.message ?? 'unknown'}`);
  }
  if (typeof body?.count !== 'number') {
    throw new Error(`ArcGIS malformed count response for ${layerUrl}`);
  }
  return body.count > 0;
}
