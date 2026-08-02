// The ARBO backend service (brief §8): a single Node server hosting the
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
  latestHistoryForProperties,
  listPastCustomers,
  recordLocationPing,
  listPingsSince,
  getOpsSetting,
  setOpsSetting,
  markEstimateVisited,
  appendConversationTurn,
  listConversations,
  markConversationReviewed,
  listGrowthTargets,
  setTreeForecast,
  listProperties,
  getPropertyTwin,
  updateLeadStatus,
  loadLoopSnapshot,
  latestJobCreatedByProperty,
  leakageWindow,
  createLeakageEvent,
  listAgentRuns,
  listCalendarEvents,
  listCrewJobs,
  recordBriefingAck,
  todaysBriefing,
  listUnits,
  listUnitParts,
  unitOpenTaskCount,
  unitStatus,
  billableJobs,
  openInvoiceRows,
  createInvoice,
  setInvoiceStatus,
  createNearMiss,
  listActiveCrew,
  listCertifications,
  recentNearMisses,
  createLessonDraftFromNearMiss,
  publishedTrainingItems,
  trainingItemsByIds,
  pendingLessonDrafts,
  crewWithProfiles,
  gateCompletionsSince,
  publishLesson,
  trainingProfile,
  saveTrainingProfile,
  recordGateCompletion,
  recordBreakdown,
  closeMaintenanceTask,
} from './db/repositories.js';
import { createCensusGeocoder } from './permitting/gis/geocode.js';
import { createElevenLabsTts } from './voice/elevenlabsTts.js';
import type { StopInput } from './ops/morningBrief.js';
import type { EstimateState, JobState } from './ops/followUps.js';
import { createNwsAlertsProvider } from './ops/stormWatch.js';
import { loadAllConfig } from './config/loadConfig.js';
import { env } from './env.js';
import { createVoiceLlm } from './voice/anthropicLlm.js';
import { createElevenLabsBridge, type BridgeRequestBody } from './voice/elevenlabsBridge.js';
import type { Alerter } from './reception/receptionist.js';
import { loadAppHtml, loadCrewHtml } from './server/appPage.js';
import { emitSafe } from './binder/eventBus.js';
import { runAgentSweep, startAgentScheduler } from './agents/sweep.js';

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
      // §27 memory — auxiliary like permits: a failure degrades to "no history
      // line", never a dead inbox.
      let history: Awaited<ReturnType<typeof latestHistoryForProperties>>;
      try {
        history = await latestHistoryForProperties(propertyIds);
      } catch (err) {
        console.error('[server] history fetch failed:', err instanceof Error ? err.message : 'error');
        history = new Map();
      }
      return rows.map((r) => {
        const permit = r.property ? permits.get(r.property.id) ?? null : null;
        const h = r.property ? history.get(r.property.id) ?? null : null;
        return {
          id: r.id,
          source: r.source,
          details: r.details,
          qualification: r.qualification,
          isEmergency: r.is_emergency,
          status: r.status,
          createdAt: r.created_at,
          name: r.contact?.name ?? null,
          phone: r.contact?.phones?.[0] ?? null,
          propertyId: r.property?.id ?? null,
          city: r.property?.city ?? null,
          zip: r.property?.zip ?? null,
          isFirstTimer: r.contact?.is_first_timer ?? null,
          permit: permit
            ? { screenStatus: permit.screen_status, inRpa: permit.in_rpa, status: permit.status }
            : null,
          history: h ? { kind: h.kind, when: h.when, scope: h.scope, status: h.status } : null,
        };
      });
    },
    async pastCustomers() {
      return (await listPastCustomers()).map((c) => ({
        contactId: c.contact_id,
        name: c.name ?? undefined,
        city: c.city ?? undefined,
        lastJobAt: c.last_job_at ?? undefined,
        consentOnFile: c.consent_source !== null,
        suppressed: c.opted_out,
      }));
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
    // §21–24 location intelligence. The tracking switch defaults OFF — §24's
    // "clear ON/OFF" means Mike turns it on, not a default.
    recordPing: (p) => recordLocationPing(p),
    async pingsSince(sinceIso) {
      return (await listPingsSince(sinceIso)).map((r) => ({
        lat: r.lat,
        lng: r.lng,
        ...(r.accuracy_m != null ? { accuracyM: r.accuracy_m } : {}),
        atIso: r.at,
      }));
    },
    getTracking: async () => (await getOpsSetting<{ on: boolean }>('location_tracking'))?.on === true,
    setTracking: (on) => setOpsSetting('location_tracking', { on }),
    async geoStops(fromIso, toIso) {
      // Lazy per-stop geocoding via the free Census geocoder (D37). A stop
      // that won't geocode confidently gets null coords — the API reports it
      // as no_data instead of fencing the wrong point.
      const geocoder = createCensusGeocoder((u: string) => fetch(u));
      const rows = await listStopsBetween(fromIso, toIso);
      return Promise.all(
        rows.map(async (r) => {
          let point: { lat: number; lng: number } | null = null;
          if (r.address && r.city) {
            try {
              point = await geocoder.geocode(r.address, r.city);
            } catch {
              point = null;
            }
          }
          return { id: r.id, kind: r.kind, timeIso: r.timeIso ?? null, name: r.name ?? null, lat: point?.lat ?? null, lng: point?.lng ?? null };
        }),
      );
    },
    markVisited: (id, at) => markEstimateVisited(id, at),
    // §29 review loop.
    conversations: (limit, unreviewedOnly) => listConversations(limit, unreviewedOnly),
    markReviewed: (id) => markConversationReviewed(id),
    // §6 predictive layer over the twin.
    async growthTargets() {
      return (await listGrowthTargets()).map((r) => ({
        propertyId: r.propertyId,
        address: r.address,
        city: r.city,
        contactId: r.contactId,
        ...(r.name != null ? { name: r.name } : {}),
        consentOnFile: r.consentSource !== null,
        suppressed: r.optedOut ?? false,
        trees: r.trees.map((t) => ({ id: t.id, species: t.species, size: t.size, lastServiceIso: t.last_service_date })),
      }));
    },
    saveTreeForecast: (id, dueFrom) => setTreeForecast(id, dueFrom),
    // The Book (#36).
    properties: () => listProperties(),
    propertyTwin: (id) => getPropertyTwin(id),
    setLeadStatus: (id, status) => updateLeadStatus(id, status),
    // §1E Loop-Closer snapshot: the silence rules run over the last 45 days.
    async loopSnapshot() {
      const rows = await loadLoopSnapshot();
      const wonPropertyIds = rows.estimates
        .filter((e) => e.outcome === 'won' && e.property_id)
        .map((e) => e.property_id as string);
      const latestJob = await latestJobCreatedByProperty(wonPropertyIds);
      return {
        nowIso: new Date().toISOString(),
        estimates: rows.estimates.map((e) => {
          // "Booked" only counts if a (non-cancelled) job was created at or
          // after the win — last year's job can't close this year's loop.
          const jobAt = e.property_id ? latestJob.get(e.property_id) : undefined;
          const outcomeAt = e.outcome === 'pending' ? null : e.updated_at;
          const bookedAfterWin = Boolean(jobAt && (!outcomeAt || jobAt >= outcomeAt));
          return {
            id: e.id,
            propertyId: e.property_id,
            scheduledIso: e.scheduled_slot,
            visitedAtIso: e.visited_at,
            outcome: e.outcome as 'pending' | 'won' | 'lost' | 'no_show',
            outcomeAtIso: outcomeAt,
            hasJobForProperty: bookedAfterWin,
          };
        }),
        jobs: rows.jobs.map((j) => ({
          id: j.id,
          scheduledIso: j.scheduled_for,
          status: j.status,
          completedAtIso: j.completed_at ?? null,
          hasInvoice: j.has_invoice,
        })),
        leads: rows.leads.map((l) => ({
          id: l.id,
          createdAtIso: l.created_at,
          status: l.status,
          needsCallback: ['missed', 'abandoned', 'voicemail'].includes(String(l.qualification?.['kind'] ?? '')),
        })),
      };
    },
    // §6J2.4 leakage line.
    leakageWindow: () => leakageWindow(),
    logLeakage: (input) => createLeakageEvent(input),
    // §8A.6g audit surface + §8A.6b bus.
    agentRuns: (limit) => listAgentRuns(limit),
    emit: (type, payload) => emitSafe(type, payload, 'server'),
    calendarEvents: (from, to) => listCalendarEvents(from, to),
    crewJobs: (from, to) => listCrewJobs(from, to),
    recordBriefingAck: (input) => recordBriefingAck(input),
    todaysBriefing: () => todaysBriefing(),
    units: () => listUnits(),
    unitParts: (id) => listUnitParts(id),
    unitOpenTaskCount: (id) => unitOpenTaskCount(id),
    unitStatus: (id) => unitStatus(id),
    // §4.8 money loop.
    billableJobs: () => billableJobs(),
    openInvoices: () => openInvoiceRows(),
    createInvoice: (input) => createInvoice(input),
    setInvoiceStatus: (id, status) => setInvoiceStatus(id, status),
    // §6V safety spine.
    fileNearMiss: (input) => createNearMiss(input),
    activeCrew: () => listActiveCrew(),
    // Cast is narrowed, not blanket: the DB CHECK constrains `type`, and any
    // row that somehow carries an unknown type is DROPPED rather than typed
    // into the engine as something it is not.
    certifications: async () => (await listCertifications()).filter(
      (c): c is typeof c & { type: 'first_aid' | 'cpr' | 'aerial_rescue' | 'tree_rescue' | 'cdl' | 'other' } =>
        ['first_aid', 'cpr', 'aerial_rescue', 'tree_rescue', 'cdl', 'other'].includes(c.type),
    ),
    recentNearMisses: (since) => recentNearMisses(since),
    // §6M training loop.
    createLessonDraft: (input) => createLessonDraftFromNearMiss(input),
    trainingPool: () => publishedTrainingItems(),
    trainingItems: (ids) => trainingItemsByIds(ids),
    pendingDrafts: () => pendingLessonDrafts(),
    crewProfiles: () => crewWithProfiles(),
    gateCompletionsSince: (iso) => gateCompletionsSince(iso),
    publishLesson: (id, by) => publishLesson(id, by),
    trainingProfile: (id) => trainingProfile(id),
    saveTrainingProfile: (id, p) => saveTrainingProfile(id, p),
    recordGate: (input) => recordGateCompletion(input),
    recordBreakdown: (input) => recordBreakdown(input),
    closeMaintenanceTask: (input) => closeMaintenanceTask(input),
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
  const alertsProvider = createNwsAlertsProvider((url, init) => fetch(url, init));
  const api = createApi(createLiveSource(), {
    alerts: alertsProvider,
    ...(env.elevenlabs.apiKey ? { tts: createElevenLabsTts(env.elevenlabs.apiKey) } : {}),
  });

  // The voice bridge shares the validated policy configs — one source of law.
  const { guardrails, legal } = loadAllConfig();
  const bridge = createElevenLabsBridge({
    guardrails,
    legal,
    llm: createVoiceLlm(env.anthropic.apiKey),
    alerter: consoleAlerter,
    bridgeSecret: env.elevenlabs.bridgeSecret,
    // §29: every voice turn lands in the review backlog (RLS-locked DB, never
    // server logs). Only wired when the DB is — the bridge swallows failures.
    ...(hasDb() ? { logTurn: (key: string, turn: Parameters<typeof appendConversationTurn>[2]) => appendConversationTurn(key, 'voice', turn) } : {}),
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
      // §8C.1 the CREW door. Separate surface, separate shell — a crew phone
      // never loads the admin cockpit.
      if (req.method === 'GET' && (url.pathname === '/crew' || url.pathname === '/crew/')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(loadCrewHtml());
      }
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
      if (req.method === 'GET' && url.pathname === '/api/brief/audio') {
        const out = await api.briefAudio(url.searchParams.get('from') ?? '', url.searchParams.get('to') ?? '');
        if (out.status === 200 && out.audio) {
          res.writeHead(200, { 'content-type': 'audio/mpeg', 'cache-control': 'no-store' });
          return res.end(Buffer.from(out.audio));
        }
        return send(out.status, out.body);
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
      // §21–24 location intelligence + §29 review loop (all behind the key gate).
      if (req.method === 'POST' && url.pathname === '/api/location/ping') {
        return send(...unpack(await api.locationPing((await readJson(req)) as Record<string, unknown>)));
      }
      if (req.method === 'POST' && url.pathname === '/api/location/tracking') {
        const body = (await readJson(req)) as { on?: unknown };
        return send(...unpack(await api.locationTracking(body.on)));
      }
      if (req.method === 'GET' && url.pathname === '/api/location/status') {
        return send(...unpack(await api.locationStatus()));
      }
      if (req.method === 'GET' && url.pathname === '/api/location/day') {
        return send(...unpack(await api.locationDay(url.searchParams.get('from') ?? '', url.searchParams.get('to') ?? '')));
      }
      if (req.method === 'GET' && url.pathname === '/api/forecast') {
        return send(...unpack(await api.forecast()));
      }
      if (req.method === 'GET' && url.pathname === '/api/properties') {
        return send(...unpack(await api.properties()));
      }
      {
        const m = url.pathname.match(/^\/api\/properties\/([^/]+)$/);
        if (req.method === 'GET' && m) {
          return send(...unpack(await api.propertyTwin(m[1]!)));
        }
      }
      {
        const m = url.pathname.match(/^\/api\/leads\/([^/]+)\/status$/);
        if (req.method === 'POST' && m) {
          const body = (await readJson(req)) as { status?: string };
          return send(...unpack(await api.setLeadStatus(m[1]!, body.status ?? '')));
        }
      }
      if (req.method === 'GET' && url.pathname === '/api/review/backlog') {
        const unreviewedOnly = url.searchParams.get('all') !== '1';
        return send(...unpack(await api.reviewBacklog(Number(url.searchParams.get('limit') ?? 20), unreviewedOnly)));
      }
      {
        const m = url.pathname.match(/^\/api\/review\/([^/]+)\/reviewed$/);
        if (req.method === 'POST' && m) {
          return send(...unpack(await api.markReviewed(m[1]!)));
        }
      }
      // §1E backup brain: every open loop the day left behind.
      if (req.method === 'GET' && url.pathname === '/api/queue') {
        return send(...unpack(await api.queue()));
      }
      // §6J2 yard check — INTERNAL ONLY, behind the admin key like all /api.
      if (req.method === 'POST' && url.pathname === '/api/estimating/check') {
        return send(...unpack(await api.estimatingCheck((await readJson(req)) as Record<string, unknown>)));
      }
      // §6J2.4 leakage line: log a repair/damage event from the field.
      if (req.method === 'POST' && url.pathname === '/api/leakage') {
        return send(...unpack(await api.logLeakage((await readJson(req)) as Record<string, unknown>)));
      }
      // THE CALENDAR — Mike's Google Calendar, mirrored and read-only.
      if (req.method === 'GET' && url.pathname === '/api/calendar') {
        return send(...unpack(await api.calendar(url.searchParams.get('from') ?? '', url.searchParams.get('to') ?? '')));
      }
      // §6F crew surface — payload is admin-data-free by construction.
      if (req.method === 'GET' && url.pathname === '/api/crew/workorders') {
        return send(...unpack(await api.crewWorkOrders(url.searchParams.get('date') ?? '', url.searchParams.get('briefingId'))));
      }
      if (req.method === 'GET' && url.pathname === '/api/crew/briefing') {
        return send(...unpack(await api.crewBriefing()));
      }
      if (req.method === 'POST' && url.pathname === '/api/crew/briefing/ack') {
        return send(...unpack(await api.ackBriefing((await readJson(req)) as Record<string, unknown>)));
      }
      // §6E fleet surface.
      if (req.method === 'GET' && url.pathname === '/api/fleet/units') {
        return send(...unpack(await api.fleetUnits()));
      }
      if (req.method === 'POST' && url.pathname === '/api/fleet/breakdown') {
        return send(...unpack(await api.reportBreakdown((await readJson(req)) as Record<string, unknown>)));
      }
      {
        const m = url.pathname.match(/^\/api\/fleet\/maintenance\/([^/]+)\/close$/);
        if (req.method === 'POST' && m) {
          return send(...unpack(await api.closeMaintenance(m[1]!, (await readJson(req)) as Record<string, unknown>)));
        }
      }
      // §4.8 money loop.
      if (req.method === 'GET' && url.pathname === '/api/money') {
        return send(...unpack(await api.money()));
      }
      if (req.method === 'POST' && url.pathname === '/api/invoices') {
        return send(...unpack(await api.createInvoice((await readJson(req)) as Record<string, unknown>)));
      }
      {
        const m = url.pathname.match(/^\/api\/invoices\/([^/]+)\/status$/);
        if (req.method === 'POST' && m) {
          return send(...unpack(await api.setInvoiceStatus(m[1]!, (await readJson(req)) as Record<string, unknown>)));
        }
      }
      // §6V safety spine.
      if (req.method === 'GET' && url.pathname === '/api/safety') {
        return send(...unpack(await api.safety()));
      }
      if (req.method === 'POST' && url.pathname === '/api/crew/near-miss') {
        return send(...unpack(await api.reportNearMiss((await readJson(req)) as Record<string, unknown>)));
      }
      // §6M training loop.
      if (req.method === 'GET' && url.pathname === '/api/crew/quiz') {
        return send(...unpack(await api.crewQuiz(
          url.searchParams.get('crewMemberId') ?? '',
          url.searchParams.get('context') ?? 'micro_lesson',
        )));
      }
      if (req.method === 'POST' && url.pathname === '/api/crew/quiz/complete') {
        return send(...unpack(await api.completeQuiz((await readJson(req)) as Record<string, unknown>)));
      }
      // §4.7 vetting queue.
      if (req.method === 'GET' && url.pathname === '/api/training/board') {
        return send(...unpack(await api.trainingBoard()));
      }
      if (req.method === 'GET' && url.pathname === '/api/training/drafts') {
        return send(...unpack(await api.trainingDrafts()));
      }
      {
        const m = url.pathname.match(/^\/api\/training\/drafts\/([^/]+)\/publish$/);
        if (req.method === 'POST' && m) {
          return send(...unpack(await api.publishLesson(m[1]!, (await readJson(req)) as Record<string, unknown>)));
        }
      }
      // §8A.6g: what the agents did, straight from the audit log.
      if (req.method === 'GET' && url.pathname === '/api/agents/runs') {
        return send(...unpack(await api.agentRuns(Number(url.searchParams.get('limit') ?? 20))));
      }
      // Wave-1 agent sweep (#4 permitting, #13 owner briefing): one run each,
      // audit-logged. Deterministic cores; LLM layers say not_configured until
      // the key lands (§1B — never bluff).
      if (req.method === 'POST' && url.pathname === '/api/agents/sweep') {
        if (!hasDb()) return send(503, { error: 'db_not_configured' });
        return send(200, await runAgentSweep(api, alertsProvider));
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
  // §8A.6f: the agents run on their own clock, not only when Mike taps.
  startAgentScheduler(
    createApi(createLiveSource(), { alerts: createNwsAlertsProvider((u, i) => fetch(u, i)) }),
    createNwsAlertsProvider((u, i) => fetch(u, i)),
  );
  server.listen(port, () => {
    console.log(`✅ ARBO backend on :${port} — guardrails v${summary.guardrailsVersion}, legal v${summary.legalVersion}, db ${summary.integrations.supabase ? 'connected' : 'not configured'}`);
  });
  return server;
}

function unpack(r: { status: number; body: unknown }): [number, unknown] {
  return [r.status, r.body];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer(Number(process.env.PORT ?? 8787));
}
