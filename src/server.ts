// The ARBOR backend service (brief §8): a single Node server hosting the
// policy engine, the app API, and the ElevenLabs voice bridge (D39). Zero
// framework dependencies: node:http + the tested handlers.
//
// Boot order matters: guardrails + legal config are loaded and VALIDATED before
// the server accepts a single request (they are law — §0 rule 4).

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { boot } from './index.js';
import { createApi, type DataSource, type ApiLeadInput } from './server/api.js';
import { hasDb } from './db/client.js';
import {
  listLeads,
  listStopsBetween,
  latestPermitsForProperties,
  listFollowUpEstimates,
  listFollowUpJobs,
  updateEstimateOutcome,
  recordFollowUpSent,
  recordReviewRequested,
} from './db/repositories.js';
import type { StopInput } from './ops/morningBrief.js';
import type { EstimateState, JobState } from './ops/followUps.js';
import { createNwsAlertsProvider } from './ops/stormWatch.js';
import { loadAllConfig } from './config/loadConfig.js';
import { env } from './env.js';
import { createVoiceLlm } from './voice/anthropicLlm.js';
import { createElevenLabsBridge, type BridgeRequestBody } from './voice/elevenlabsBridge.js';
import type { Alerter } from './reception/receptionist.js';
import { loadAppHtml } from './server/appPage.js';

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
    async followUpInputs(): Promise<{ estimates: EstimateState[]; jobs: JobState[] }> {
      const [ests, jobs] = await Promise.all([listFollowUpEstimates(), listFollowUpJobs()]);
      return {
        estimates: ests.map((e) => ({
          id: e.id,
          name: e.contact?.name ?? undefined,
          phone: e.contact?.phones?.[0],
          // The visit anchor: geofence lands in Phase 6; until then a visited
          // estimate anchors on its scheduled slot — never on a guess.
          visitedAt: e.visited && e.scheduled_slot ? e.scheduled_slot : undefined,
          windowEndsAt: e.scheduled_slot ?? undefined,
          noShow: e.outcome === 'no_show',
          resolved: e.outcome === 'won' || e.outcome === 'lost',
          lastFollowUpAt: e.last_follow_up_at ?? undefined,
          followUpCount: e.follow_up_count,
          consentOnFile: e.contact ? e.contact.consent_source !== null : false,
          suppressed: e.contact?.opted_out ?? false,
        })),
        jobs: jobs.map((j) => ({
          id: j.id,
          name: j.contact?.name ?? undefined,
          phone: j.contact?.phones?.[0],
          completedAt: j.completed_at ?? undefined,
          paidAt: j.paid_at ?? undefined,
          reviewRequestedAt: j.review_requested_at ?? undefined,
          consentOnFile: j.contact ? j.contact.consent_source !== null : false,
          suppressed: j.contact?.opted_out ?? false,
        })),
      };
    },
    recordOutcome: (id, outcome) => updateEstimateOutcome(id, outcome),
    recordFollowUpSent: (id, at) => recordFollowUpSent(id, at),
    recordReviewRequested: (id, at) => recordReviewRequested(id, at),
  };
}

/** Read + parse a JSON body, capped at 1 MB (voice turns are tiny). */
async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 1_000_000) throw new Error('body too large');
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/**
 * Emergency path until Twilio is wired at deploy (O2): loud in the server log,
 * reason only — caller text/PII never hits logs (§4.3).
 */
const consoleAlerter: Alerter = {
  async emergency({ reason }) {
    console.error(`[voice] 🚨 EMERGENCY escalation for Mike: ${reason}`);
  },
};

/**
 * The one request handler — identical behavior on node:http (Railway, local)
 * and as a serverless function (Vercel). Boot validation runs at construction:
 * the handler cannot exist with invalid law.
 */
export function createArborRequestHandler() {
  boot(); // validates guardrails + legal or throws
  const api = createApi(createLiveSource(), {
    alerts: createNwsAlertsProvider((url, init) => fetch(url, init)),
  });

  // The voice bridge shares the validated policy configs — one source of law.
  const { guardrails, legal } = loadAllConfig();
  const bridge = createElevenLabsBridge({
    guardrails,
    legal,
    llm: createVoiceLlm(env.anthropic.apiKey),
    alerter: consoleAlerter,
    bridgeSecret: env.elevenlabs.bridgeSecret,
  });

  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    // Lead/brief data is customer PII — the /api surface fails CLOSED (§4.3):
    // with a key configured it must match; with no key configured it only
    // opens while the DB is disconnected (nothing to leak). /health and the
    // voice bridge (own secret) stay outside this gate.
    const apiAuthorized = (): boolean => {
      if (env.appAccessKey) {
        const given = req.headers['x-arbor-key'] ?? url.searchParams.get('key');
        return given === env.appAccessKey;
      }
      return !hasDb();
    };
    try {
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/app')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(loadAppHtml());
      }
      if (req.method === 'GET' && url.pathname === '/health') return send(...unpack(await api.health()));
      if (url.pathname.startsWith('/api/') && !apiAuthorized()) {
        return send(401, { error: 'unauthorized' });
      }
      if (req.method === 'GET' && url.pathname === '/api/brief') {
        return send(...unpack(await api.brief(url.searchParams.get('from') ?? '', url.searchParams.get('to') ?? '')));
      }
      if (req.method === 'GET' && url.pathname === '/api/leads') {
        return send(...unpack(await api.leads(Number(url.searchParams.get('limit') ?? 25))));
      }
      if (req.method === 'GET' && url.pathname === '/api/followups') {
        return send(...unpack(await api.followUps()));
      }
      if (req.method === 'GET' && url.pathname === '/api/storm') {
        return send(...unpack(await api.storm()));
      }
      {
        const m = url.pathname.match(/^\/api\/estimates\/([^/]+)\/outcome$/);
        if (req.method === 'POST' && m) {
          const body = (await readJson(req)) as { outcome?: string };
          return send(...unpack(await api.setOutcome(m[1]!, body.outcome ?? '')));
        }
      }
      {
        const m = url.pathname.match(/^\/api\/followups\/(estimate|review)\/([^/]+)\/sent$/);
        if (req.method === 'POST' && m) {
          return send(...unpack(await api.markFollowUpSent(m[1]!, m[2]!)));
        }
      }
      // ElevenLabs custom-LLM endpoint (the agent's Server URL points at
      // /voice/llm; the platform appends the OpenAI-style path).
      if (req.method === 'POST' && (url.pathname === '/voice/llm/chat/completions' || url.pathname === '/voice/llm/v1/chat/completions')) {
        const body = (await readJson(req)) as BridgeRequestBody;
        const out = await bridge.handle(req.headers.authorization, body);
        if (out.sse) {
          res.writeHead(out.status, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
          for (const frame of out.sse) res.write(`${frame}\n\n`);
          return res.end();
        }
        return send(out.status, out.json);
      }
      return send(404, { error: 'not_found' });
    } catch (err) {
      // Never put customer data or stack traces on the wire (§4.3).
      console.error('[server]', err instanceof Error ? err.message : 'error');
      return send(500, { error: 'server_error' });
    }
  };
}

export function startServer(port: number) {
  const summary = boot();
  const server = createServer(createArborRequestHandler());
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
