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
import { listLeads, listStopsBetween } from './db/repositories.js';
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
      return rows.map((r) => ({
        id: r.id,
        source: r.source,
        details: r.details,
        qualification: r.qualification,
        isEmergency: r.is_emergency,
        status: r.status,
        createdAt: r.created_at,
        name: r.contact?.name ?? null,
        city: r.property?.city ?? null,
        zip: r.property?.zip ?? null,
        isFirstTimer: r.contact?.is_first_timer ?? null,
      }));
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
