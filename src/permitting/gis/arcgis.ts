// Minimal ArcGIS REST client for the one question the screen asks a layer:
// "does this point fall inside any polygon of this layer?" (point-in-polygon
// via the standard /query endpoint, returnCountOnly).
//
// STRICT by design (D32): anything short of a well-formed count response —
// HTTP error, esri error body, malformed JSON — THROWS, which the intake
// screen turns into an honest PENDING. A silent false ("not in the layer")
// on a broken endpoint would be a fabricated no-overlay result.

export type FetchFn = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** True when the WGS84 point intersects any feature of the layer. */
export async function pointIntersectsLayer(
  fetchFn: FetchFn,
  layerUrl: string,
  point: { lat: number; lng: number },
): Promise<boolean> {
  const params = new URLSearchParams({
    f: 'json',
    geometry: JSON.stringify({ x: point.lng, y: point.lat, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    returnCountOnly: 'true',
    where: '1=1',
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
