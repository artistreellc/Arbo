// The ARBOR backend service (brief §8): a single Node server hosting the
// policy engine, the app API, and — as later phases land — the Vapi/Twilio
// webhooks. Zero framework dependencies: node:http + the tested handlers.
//
// Boot order matters: guardrails + legal config are loaded and VALIDATED before
// the server accepts a single request (they are law — §0 rule 4).

import { createServer } from 'node:http';
import { boot } from './index.js';
import { createApi, type DataSource, type ApiLeadInput } from './server/api.js';
import { hasDb } from './db/client.js';
import { listLeads, listStopsBetween, latestPermitsForProperties } from './db/repositories.js';
import type { StopInput } from './ops/morningBrief.js';

/** Live DataSource over the Phase 1 repositories (service-role, RLS-locked). */
export function createLiveSource(): DataSource {
  return {
    ready: () => hasDb(),
    async stopsBetween(fromIso, toIso): Promise<StopInput[]> {
      const rows = await listStopsBetween(fromIso, toIso);
      return rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        timeIso: r.timeIso ?? undefined,
        name: r.name ?? undefined,
        phone: r.phone ?? undefined,
        address: r.address ?? '',
        city: r.city ?? '',
        zip: r.zip ?? undefined,
        isFirstTimer: r.isFirstTimer ?? undefined,
        scope: r.scope ?? undefined,
      }));
    },
    async newLeads(limit): Promise<ApiLeadInput[]> {
      const rows = await listLeads(limit);
      // The §6B screen flag rides each lead: latest permit per property, batched.
      // A permit-join failure must not kill the inbox (the lead list is the
      // lifeblood) — degrade to "no flag on file", which the API surfaces as
      // screenPending, the honest "still needs a screen" state. Never a clear.
      const propertyIds = [...new Set(rows.map((r) => r.property?.id).filter((id): id is string => Boolean(id)))];
      let permits: Awaited<ReturnType<typeof latestPermitsForProperties>>;
      try {
        permits = await latestPermitsForProperties(propertyIds);
      } catch (err) {
        console.error('[server] permit flag fetch failed:', err instanceof Error ? err.message : 'error');
        permits = new Map();
      }
      return rows.map((r) => {
        const permit = r.property ? permits.get(r.property.id) ?? null : null;
        return {
          id: r.id,
          source: r.source,
          details: r.details,
          qualification: r.qualification,
          isEmergency: r.is_emergency,
          status: r.status,
          createdAt: r.created_at,
          name: r.contact?.name ?? null,
          propertyId: r.property?.id ?? null,
          city: r.property?.city ?? null,
          zip: r.property?.zip ?? null,
          isFirstTimer: r.contact?.is_first_timer ?? null,
          permit: permit
            ? { screenStatus: permit.screen_status, inRpa: permit.in_rpa, status: permit.status }
            : null,
        };
      });
    },
  };
}

export function startServer(port: number) {
  const summary = boot(); // validates guardrails + legal or throws
  const api = createApi(createLiveSource());

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    try {
      if (req.method === 'GET' && url.pathname === '/health') return send(...unpack(await api.health()));
      if (req.method === 'GET' && url.pathname === '/api/brief') {
        return send(...unpack(await api.brief(url.searchParams.get('from') ?? '', url.searchParams.get('to') ?? '')));
      }
      if (req.method === 'GET' && url.pathname === '/api/leads') {
        return send(...unpack(await api.leads(Number(url.searchParams.get('limit') ?? 25))));
      }
      return send(404, { error: 'not_found' });
    } catch (err) {
      // Never put customer data or stack traces on the wire (§4.3).
      console.error('[server]', err instanceof Error ? err.message : 'error');
      return send(500, { error: 'server_error' });
    }
  });

  server.listen(port, () => {
    console.log(`✅ ARBOR backend on :${port} — guardrails v${summary.guardrailsVersion}, legal v${summary.legalVersion}, db ${summary.integrations.supabase ? 'connected' : 'not configured'}`);
  });
  return server;
}

function unpack(r: { status: number; body: unknown }): [number, unknown] {
  return [r.status, r.body];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer(Number(process.env.PORT ?? 8787));
}
