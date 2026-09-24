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
// The ARBO backend service (brief §8): a single Node server hosting the
// policy engine, the app API, and the ElevenLabs voice bridge (D39). Zero
// framework dependencies: node:http + the tested handlers.
//
// Boot order matters: guardrails + legal config are loaded and VALIDATED before
// the server accepts a single request (they are law — §0 rule 4).

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { boot } from './index.js';
import { createApi, type DataSource, type ApiLeadInput } from './server/api.js';
import { hasDb, dataLinksLive, dataLinksSim, dbConfigured, getDb } from './db/client.js';
import { DATA_LINKS, LINK_NAMES, linkOpen, linkEnvVar, openLinks, LinkCutError } from './db/links.js';
import { WebhookIntake, createResendEmailFetcher } from './ops/webhooks.js';
import { QuoIntake } from './ops/quoIntake.js';
import { vendorLinked, vendorCutBody, cutVendorLinks } from './integrations/vendorLinks.js';
import { createSonaExtractor } from './ops/quoExtract.js';
import { createQuoApi, ensureQuoWebhooks } from './integrations/quo.js';
import { createQuoSender } from './integrations/quoSend.js';
import { OutreachEngine } from './ops/outreach.js';
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
  listPermitTracks,
  packetSource,
  jobIdsWithFiledContract,
  permitStateById,
  updatePermitStatus,
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
  fullRoster,
  createEquipmentUnit,
  retireEquipmentUnit,
  addEquipmentPart,
  createCampaign,
  createCrewMember,
  deactivateCrewMember,
  recordCertification,
  recentNearMisses,
  createLessonDraftFromNearMiss,
  publishedTrainingItems,
  trainingItemsByIds,
  pendingLessonDrafts,
  crewWithProfiles,
  referenceEntries,
  crewSkillLevel,
  draftReferenceEntries,
  createReferenceEntry,
  publishReferenceEntry,
  areaJobFacts,
  campaignFacts,
  recordSiteCondition,
  siteConditionForJob,
  createChangeOrder,
  openChangeOrders,
  approveChangeOrder,
  billableChangeOrdersForJob,
  markChangeOrdersInvoiced,
  gateCompletionsSince,
  publishLesson,
  trainingProfile,
  saveTrainingProfile,
  recordGateCompletion,
  recordBreakdown,
  closeMaintenanceTask,
} from './db/repositories.js';
import { createCensusGeocoder } from './permitting/gis/geocode.js';
import { createDefaultGisProvider } from './permitting/gis/liveGisProvider.js';
import { buildEstimatePrep, type PrepJobType } from './ops/estimatePrep.js';
import { createElevenLabsTts } from './voice/elevenlabsTts.js';
import type { StopInput } from './ops/morningBrief.js';
import type { EstimateState, JobState } from './ops/followUps.js';
import { createNwsAlertsProvider } from './ops/stormWatch.js';
import { loadAllConfig } from './config/loadConfig.js';
import { env } from './env.js';
import { createVoiceLlm } from './voice/anthropicLlm.js';
import { createElevenLabsBridge, type BridgeRequestBody } from './voice/elevenlabsBridge.js';
import { createGoogleGmailReader, createGoogleGmailThreadReader } from './integrations/gmail.js';
import { createGoogleCalendarApi } from './integrations/calendar.js';
import { CallMemory, CallRecordStore } from './reception/callMemory.js';
import { createRefreshTokenProvider } from './integrations/googleOAuth.js';
import { LEAD_CHANNELS, channelIsOff, setChannelOff } from './reception/leadMail.js';
import { getTodayWorkZip, setTodayWorkZip, getLiveWorkZip, setLivePingZip, setLocationEnabled, isLocationEnabled, liveLocationState } from './reception/routingHint.js';
import { planRouteLive } from './ops/routePlanner.js';
import { fetchDriveMinutesMatrix } from './integrations/googleRoutes.js';
import { withinWorkingHours } from './ops/locationIntel.js';
import type { Alerter } from './reception/receptionist.js';
import { loadAppHtml, loadCrewHtml, loadTalkHtml, loadTalkWidgetJs } from './server/appPage.js';
import { emitSafe } from './binder/eventBus.js';
import { runAgentSweep, startAgentScheduler } from './agents/sweep.js';
import {
  startInboxWatch,
  unavailablePass,
  type InboxWatchHandle,
} from './ops/inboxWatch.js';
import { IntentWatch } from './ops/intentWatch.js';
import { IntentRegistry } from './ops/intentRegistry.js';
import { InboxSurfaceStore } from './ops/inboxSurface.js';
import { createOpusIntentModel } from './ops/inboxIntent.js';
import { createSimSource } from './dev/simSource.js';

/**
 * The source the server actually runs on. In SIM mode this is in-memory fake
 * data and no database client is ever constructed; otherwise it is the live
 * repositories, which are themselves gated by the data-link switch.
 *
 * One function decides it, so there is exactly one place where the app can
 * pick up data — and no path that mixes the two.
 */
export function createServerSource(): DataSource {
  return dataLinksSim() ? createSimSource() : createLiveSource();
}

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
    permitTracks: () => listPermitTracks(),
    // §6B.3 clearance. Two functions, and the WRITE is deliberately the
    // thinnest possible wrapper: every rule about whether a move is
    // allowed lives in clearance.ts, where it can be tested without a
    // database, and none of it lives down here where it cannot.
    packetSource: (id) => packetSource(id),
    jobsWithFiledContract: (ids) => jobIdsWithFiledContract(ids),
    permitState: (id) => permitStateById(id),
    movePermitStatus: (m) => updatePermitStatus(m.permitId, m.to, m.patch),
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
    referenceEntries: () => referenceEntries(),
    crewSkillLevel: (id) => crewSkillLevel(id),
    createEquipmentUnit: (input) => createEquipmentUnit(input),
    retireEquipmentUnit: (id) => retireEquipmentUnit(id),
    addEquipmentPart: (input) => addEquipmentPart(input),
    createCampaign: (input) => createCampaign(input),
    fullRoster: () => fullRoster(),
    createCrewMember: (input) => createCrewMember(input),
    deactivateCrewMember: (id) => deactivateCrewMember(id),
    recordCertification: (input) => recordCertification(input),
    draftReferenceEntries: () => draftReferenceEntries(),
    createReferenceEntry: (input) => createReferenceEntry(input),
    publishReferenceEntry: (id, vettedBy) => publishReferenceEntry(id, vettedBy),
    areaJobFacts: (since) => areaJobFacts(since),
    campaignFacts: () => campaignFacts(),
    // §6 site conditions + change orders.
    recordSiteCondition: (input) => recordSiteCondition(input),
    siteCondition: (jobId) => siteConditionForJob(jobId),
    createChangeOrder: (input) => createChangeOrder(input),
    openChangeOrders: () => openChangeOrders(),
    approveChangeOrder: (id) => approveChangeOrder(id),
    billableChangesForJob: (jobId) => billableChangeOrdersForJob(jobId),
    markChangesInvoiced: (ids) => markChangeOrdersInvoiced(ids),
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
/**
 * A caller error is not a server error. A malformed body used to fall through
 * to the catch-all and come back as 500 `server_error`, which says "Arbo
 * broke" when the truth is "that was not JSON" — and a 500 on a POST teaches
 * a client to retry a request that can never succeed. These two throw a typed
 * error the request handler turns into a 400.
 */
class BadRequestError extends Error {
  constructor(readonly code: 'bad_json' | 'body_too_large') { super(code); }
}

/**
 * The webhook routes need the RAW body — a signature is computed over the
 * exact bytes sent, and JSON.parse→stringify would silently break it.
 */
async function readRawBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 1_000_000) throw new BadRequestError('body_too_large');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 1_000_000) throw new BadRequestError('body_too_large');
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  // An empty body is an empty object — every handler already validates its
  // own fields, and 400ing here would break the no-payload POSTs.
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new BadRequestError('bad_json');
  }
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
 * The one request handler, used by node:http on Railway and locally.
 *
 * Boot validation runs at CONSTRUCTION, not on the first request: the handler
 * cannot exist with invalid law.
 *
 * This used to be shared with a Vercel serverless entrypoint (D41), which is
 * why it was written host-agnostic. Vercel is gone as of 2026-08-04 — Mike:
 * "vercel is old" — and the reason it could never have carried ARBO anyway is
 * worth leaving here: `startServer()` is what starts the hourly agent sweep
 * and the five-minute inbox watch, and a serverless function has no process
 * that lives between requests to run them in. A host for this app has to stay
 * up.
 */
export function createArborRequestHandler() {
  boot(); // validates guardrails + legal or throws
  const alertsProvider = createNwsAlertsProvider((url, init) => fetch(url, init));
  const api = createApi(createServerSource(), {
    dataLinksLive: dataLinksLive(),
    dataLinksSim: dataLinksSim(),
    alerts: alertsProvider,
    ...(env.elevenlabs.apiKey ? { tts: createElevenLabsTts(env.elevenlabs.apiKey) } : {}),
  });

  // The voice bridge shares the validated policy configs — one source of law.
  const { guardrails, legal } = loadAllConfig();
  // ═══ R18 (Mike, 2026-09-24): learning + records + live calendar holds ═══
  // The learning layer is conversation memory ONLY — nothing here can write
  // code or change the app. The calendar writer is the ONE-method hold
  // creator; it exists only when the Google token trio is configured, and
  // its absence is said out loud at boot rather than discovered in silence.
  const callMemory = new CallMemory();
  const callRecords = new CallRecordStore();
  const gc = env.google;
  const calendarHold = gc.gmailOauthClientId && gc.gmailOauthClientSecret && gc.gmailOauthRefreshToken
    ? (() => {
        const calApi = createGoogleCalendarApi(
          createRefreshTokenProvider({
            clientId: gc.gmailOauthClientId!,
            clientSecret: gc.gmailOauthClientSecret!,
            refreshToken: gc.gmailOauthRefreshToken!,
          }),
        );
        return async (hold: {
          summary: string;
          description: string;
          location?: string;
          colorId?: string;
          startIso: string;
          endIso: string;
        }) => {
          await calApi.createEvent({ calendarId: 'primary', ...hold });
        };
      })()
    : null;
  if (!calendarHold) {
    console.error('[calendar] holds DISABLED — no Google token (R18 waits on the consent step). This is not "no calls".');
  }

  // R19: the webhook intake — everything that can PUSH to Arbo. Sources
  // without a secret are NOT WIRED and the status endpoint names them (§1B).
  const webhooks = new WebhookIntake({
    resendSecret: env.resend.webhookSecret ?? null,
    elevenSecret: env.elevenlabs.postCallSecret ?? null,
    railwayKey: env.railwayWebhookKey ?? null,
    twilioSmsKey: env.twilioSmsWebhookKey ?? null,
    fetchEmail: env.resend.apiKey ? createResendEmailFetcher(env.resend.apiKey) : null,
  });

  // Sona's calls via Quo (Mike, 2026-09-24: "auto do it"). Same R18 stores
  // as Arbo's own calls; keys and numbers arrive when startServer registers.
  // R22: the one outbound path — the "still interested in a quote?" text via
  // Quo. Built only when Quo is configured; the line itself (which number
  // Arbo texts from) is learned at boot from Quo, never guessed.
  const quoApi = env.quoApiKey ? createQuoApi(env.quoApiKey) : null;
  const sonaExtractor = env.anthropic.apiKey ? createSonaExtractor(env.anthropic.apiKey) : null;
  let outreach: OutreachEngine | null = null;
  const quoIntake = new QuoIntake({
    guardrails,
    extractor: sonaExtractor,
    callMemory,
    callRecords,
    calendarHold,
    onText: (t) => {
      webhooks.addQuoText(t);
      outreach?.noteInbound(t);
    },
    onDelivery: (id, status) => outreach?.noteDelivery(id, status),
  });
  currentQuoIntake = quoIntake;
  if (quoApi && env.quoApiKey) {
    outreach = new OutreachEngine({
      quo: quoApi,
      sender: createQuoSender(env.quoApiKey),
      guardrails,
      legal,
      extractor: sonaExtractor,
      bookedCallers: () => {
        const booked = new Set<string>();
        for (const c of quoIntake.list()) {
          if (c.hold !== 'attempted' || !c.from) continue;
          const n = c.from.replace(/[^\d+]/g, '');
          if (n) booked.add(n);
        }
        return booked;
      },
      sonaFilesHolds: Boolean(calendarHold),
      enabled: () => env.outreachAuto,
    });
  }
  currentOutreach = outreach;

  const bridge = createElevenLabsBridge({
    guardrails,
    legal,
    llm: createVoiceLlm(env.anthropic.apiKey),
    alerter: consoleAlerter,
    bridgeSecret: env.elevenlabs.bridgeSecret,
    callMemory,
    callRecords,
    calendarHold,
    // R15: route anchors — work ZIP from Settings (in-memory), home ZIP from
    // env. The bridge turns these into a conclusion; the model never sees them.
    routeAnchors: () => ({ workZip: getLiveWorkZip(Date.now()) ?? getTodayWorkZip(), homeZip: env.ownerHomeZip ?? null }),
    // §29: every voice turn lands in the review backlog (RLS-locked DB, never
    // server logs). Only wired when the DB is — the bridge swallows failures.
    // R19: turn logging now rides the 'calls' link specifically — wired only
    // when that link is open, so a cut link is a named boot state, not a
    // swallowed per-turn failure.
    ...(hasDb() && linkOpen('calls') ? { logTurn: (key: string, turn: Parameters<typeof appendConversationTurn>[2]) => appendConversationTurn(key, 'voice', turn) } : {}),
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
      // Talk to Arbo — the voice widget page (Mike, 2026-09-21). Served like
      // the other shells; the agent itself is public-id, so no key gate.
      if (req.method === 'GET' && (url.pathname === '/talk' || url.pathname === '/talk/') && !vendorLinked('elevenlabs')) {
        // R21: the ElevenLabs link is cut — say so plainly instead of loading
        // a widget whose brain would refuse every word.
        res.writeHead(503, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Arbo — Talk is off</title></head><body style="font-family:system-ui,sans-serif;max-width:520px;margin:48px auto;padding:0 16px;line-height:1.6"><h1>Talk to Arbo is off</h1><p>Arbo\'s own voice line is disconnected while Sona (Quo) handles calls. Nothing was deleted — it comes back with one setting.</p><p><a href="/app">Back to the app</a></p></body></html>');
      }
      if (req.method === 'GET' && (url.pathname === '/talk' || url.pathname === '/talk/')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(loadTalkHtml());
      }
      // The widget code itself, from OUR server — vendored npm bundle, no CDN.
      if (req.method === 'GET' && url.pathname === '/talk/widget.js' && !vendorLinked('elevenlabs')) {
        return send(503, vendorCutBody('elevenlabs'));
      }
      if (req.method === 'GET' && url.pathname === '/talk/widget.js') {
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=3600' });
        return res.end(loadTalkWidgetJs());
      }
      if (req.method === 'GET' && (url.pathname === '/crew' || url.pathname === '/crew/')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(loadCrewHtml());
      }
      // The public front door: says what Arbo IS with no login in the way
      // (Google's OAuth review flags a home page behind a key wall). The app
      // itself moved fully behind /app — one extra tap from a stale
      // bookmark, nothing else changes.
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=3600' });
        return res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Arbo — Art-is-Tree LLC</title><style>body{font-family:system-ui,sans-serif;background:#0B0D10;color:#EDEFF3;max-width:640px;margin:0 auto;padding:48px 20px;line-height:1.6}h1{font-size:2rem;letter-spacing:.06em}h1 small{color:#A78BFA;font-size:1rem;font-weight:500;margin-left:8px}p{color:#B8BFCA}a.btn{display:inline-block;margin-top:20px;background:linear-gradient(180deg,#8B5CF6,#6D28D9);color:#fff;text-decoration:none;font-weight:700;padding:14px 28px;border-radius:12px}nav{margin-top:48px;font-size:.9rem}nav a{color:#A78BFA;text-decoration:none;margin-right:20px}</style></head><body><h1>ARBO<small>Art-is-Tree</small></h1><p>Arbo is the reception and operations assistant of <b>Art-is-Tree LLC</b>, a licensed and insured tree service in Virginia Beach, Norfolk, Chesapeake, and Portsmouth, Virginia.</p><p>Arbo keeps the record of every company call and message, takes estimate requests, and helps the owner schedule visits. It connects to the company's own email and calendar to surface customer inquiries and hold estimate appointments — for this one business, run by its owner.</p><p>Calls to Art-is-Tree that go unanswered may be handled by an AI assistant and are recorded for quality purposes.</p><a class="btn" href="/app">Open the app</a><nav><a href="/privacy">Privacy Policy</a><a href="/terms">Terms of Service</a><a href="tel:+17573195131">Call Art-is-Tree</a></nav></body></html>`);
      }
      if (req.method === 'GET' && url.pathname === '/app') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(loadAppHtml());
      }
      // §9 / iOS: both doors install to the iPhone home screen and open
      // full-screen. Two manifests because they are two different apps — Mike
      // installs the cockpit, the crew installs the crew door, and neither
      // should open the other. Served BEFORE the /api key gate: an icon behind
      // a key does not render.
      if (req.method === 'GET' && (url.pathname === '/manifest.webmanifest' || url.pathname === '/crew.webmanifest')) {
        const crew = url.pathname.startsWith('/crew');
        res.writeHead(200, { 'content-type': 'application/manifest+json', 'cache-control': 'no-store' });
        return res.end(JSON.stringify({
          name: crew ? 'Arbo Crew' : 'Arbo — Art-is-Tree',
          short_name: crew ? 'Arbo Crew' : 'Arbo',
          start_url: crew ? '/crew' : '/',
          scope: crew ? '/crew' : '/',
          display: 'standalone',
          orientation: 'portrait',
          background_color: '#0B0D10',
          theme_color: '#0B0D10',
          icons: [192, 512].map((s) => ({
            src: `/icons/arbo-${s}.png`, sizes: `${s}x${s}`, type: 'image/png', purpose: 'any maskable',
          })),
        }));
      }
      {
        const m = url.pathname.match(/^\/icons\/(arbo-(?:180|192|512)\.png)$/);
        if (req.method === 'GET' && m) {
          // Only the three known filenames — the regex IS the allow-list, so
          // no path can walk out of the icons directory.
          const file = new URL(`./app/icons/${m[1]}`, import.meta.url);
          res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' });
          return res.end(readFileSync(file));
        }
      }
      // Public legal pages — exist so the Google OAuth consent screen has
      // real URLs to point at (publishing requires them for Gmail scopes).
      // Honest, minimal, no customer data, no auth.
      if (req.method === 'GET' && (url.pathname === '/privacy' || url.pathname === '/terms')) {
        const isPrivacy = url.pathname === '/privacy';
        const title = isPrivacy ? 'Privacy Policy' : 'Terms of Service';
        const bodyHtml = isPrivacy
          ? `<p>Arbo is the internal reception and operations system of Art-is-Tree LLC, a tree service in Virginia Beach, Norfolk, Chesapeake, and Portsmouth, VA. It is operated by and for Art-is-Tree LLC only.</p>
<p><b>What we collect.</b> When you call our business line, our assistant collects what you tell it — your name, callback number, property address, and details about the tree work you want — solely to schedule estimates and provide tree service. Calls are recorded for quality purposes and you are told so on the call.</p>
<p><b>Google user data.</b> Arbo accesses Google account data only for Art-is-Tree's own business account: read-only access to that account's email (to surface customer inquiries to the owner) and the ability to create events on that account's calendar (to schedule estimate visits). Arbo's use of information received from Google APIs adheres to the <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including the Limited Use requirements. Google user data is never sold, never used for advertising, and never transferred to third parties except the service providers that operate the system (hosting and AI processing) or as required by law.</p>
<p><b>Sharing.</b> Customer information is used only to provide tree service. We do not sell personal information.</p>
<p><b>Contact.</b> artistreeofvirginia@gmail.com</p>`
          : `<p>Arbo is an internal business tool operated by Art-is-Tree LLC for its own reception and scheduling. It is not offered as a service to the public.</p>
<p>By calling Art-is-Tree LLC you consent to the call handling described in our <a href="/privacy">Privacy Policy</a>, including call recording for quality purposes. Scheduling requests taken by the assistant are unconfirmed until confirmed by the owner.</p>
<p>The system is provided as-is for Art-is-Tree LLC's internal use. Contact: artistreeofvirginia@gmail.com</p>`;
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=3600' });
        return res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Arbo — ${title}</title><style>body{font-family:system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 16px;line-height:1.6;color:#1a1a1a}h1{font-size:1.5rem}a{color:#6d28d9}</style></head><body><h1>Arbo — ${title}</h1><p><i>Art-is-Tree LLC · Effective 2026-09-24</i></p>${bodyHtml}</body></html>`);
      }
      if (req.method === 'GET' && url.pathname === '/health') return send(...unpack(await api.health()));
      // R19 webhook receivers — PUBLIC paths, each gated by its own
      // signature/secret, exactly like the voice bridge. An unwired source
      // refuses by name; nothing is ever accepted unverified.
      if (req.method === 'POST' && url.pathname === '/webhooks/resend') {
        const raw = await readRawBody(req);
        const h = req.headers;
        const out = await webhooks.handleResend(
          {
            id: typeof h['svix-id'] === 'string' ? h['svix-id'] : undefined,
            timestamp: typeof h['svix-timestamp'] === 'string' ? h['svix-timestamp'] : undefined,
            signature: typeof h['svix-signature'] === 'string' ? h['svix-signature'] : undefined,
          },
          raw,
        );
        return send(out.status, out.body);
      }
      if (req.method === 'POST' && url.pathname === '/webhooks/elevenlabs' && !vendorLinked('elevenlabs')) {
        return send(503, vendorCutBody('elevenlabs'));
      }
      if (req.method === 'POST' && url.pathname === '/webhooks/elevenlabs') {
        const raw = await readRawBody(req);
        const sig = req.headers['elevenlabs-signature'];
        const out = webhooks.handleElevenLabs(typeof sig === 'string' ? sig : undefined, raw);
        return send(out.status, out.body);
      }
      if (req.method === 'POST' && url.pathname === '/webhooks/railway') {
        const raw = await readRawBody(req);
        const out = webhooks.handleRailway(url.searchParams.get('key'), raw);
        return send(out.status, out.body);
      }
      // Quo (Sona) events — public path, gated by Quo's signature.
      if (req.method === 'POST' && url.pathname === '/webhooks/quo') {
        const raw = await readRawBody(req);
        const h = (k: string) => (typeof req.headers[k] === 'string' ? (req.headers[k] as string) : undefined);
        const out = quoIntake.handle(
          {
            'openphone-signature': h('openphone-signature'),
            'webhook-id': h('webhook-id'),
            'webhook-timestamp': h('webhook-timestamp'),
            'webhook-signature': h('webhook-signature'),
          },
          raw,
        );
        return send(out.status, out.body);
      }
      // Incoming texts to the Arbo number. Accepted texts get an EMPTY TwiML
      // response — Arbo never replies to a text, by construction.
      if (req.method === 'POST' && url.pathname === '/webhooks/twilio/sms' && !vendorLinked('twilio')) {
        return send(503, vendorCutBody('twilio'));
      }
      if (req.method === 'POST' && url.pathname === '/webhooks/twilio/sms') {
        const raw = await readRawBody(req);
        const out = webhooks.handleTwilioSms(url.searchParams.get('key'), raw);
        if (out.status !== 200) return send(out.status, out.body);
        res.writeHead(200, { 'content-type': 'text/xml', 'cache-control': 'no-store' });
        return res.end('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
      }
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
      if (req.method === 'GET' && url.pathname === '/api/brief/audio' && !vendorLinked('elevenlabs')) {
        return send(503, vendorCutBody('elevenlabs'));
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
      // Mike's business cell, relayed by his iPhone (2026-09-24: "the best of
      // arbo but still functions as my phone"). Behind the app key like the
      // location ping — the Shortcut sends x-arbor-key.
      if (req.method === 'POST' && url.pathname === '/api/relay/text') {
        const out = webhooks.relayText((await readJson(req)) as Record<string, unknown>);
        return send(out.ok ? 200 : 400, out);
      }
      if (req.method === 'POST' && url.pathname === '/api/relay/call-notes') {
        const out = webhooks.relayCallNote((await readJson(req)) as Record<string, unknown>);
        return send(out.ok ? 200 : 400, out);
      }
      if (req.method === 'GET' && url.pathname === '/api/relay/call-notes') {
        return send(200, { notes: webhooks.notes() });
      }
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
      // §6B — the permitting board. Read-only; the lifecycle only moves by a
      // human, and there is no handler here that could move it.
      // Estimate prep pack (Mike, 2026-09-24): permit screen + drive heuristic
      // + Miss Utility + the caller's access notes, one sheet per estimate.
      // Reads GIS and in-memory state only — writes nothing, prices nothing.
      if (req.method === 'POST' && url.pathname === '/api/estimate/prep') {
        const b = (await readJson(req)) as Record<string, unknown>;
        const address = typeof b.address === 'string' ? b.address.trim() : '';
        const city = typeof b.city === 'string' ? b.city.trim() : '';
        if (!address || !city) return send(400, { error: 'address_and_city_required' });
        const sheet = await buildEstimatePrep(
          {
            address,
            city,
            ...(typeof b.zip === 'string' && b.zip.trim() ? { zip: b.zip.trim() } : {}),
            ...(typeof b.jobType === 'string' &&
            ['removal', 'pruning', 'stump', 'land_clearing', 'other'].includes(b.jobType)
              ? { jobType: b.jobType as PrepJobType }
              : {}),
            ...(typeof b.treeCount === 'number' ? { treeCount: b.treeCount } : {}),
            ...(typeof b.nearPowerLines === 'boolean' ? { nearPowerLines: b.nearPowerLines } : {}),
            ...(typeof b.accessNotes === 'string' ? { accessNotes: b.accessNotes } : {}),
          },
          createDefaultGisProvider(),
        );
        return send(200, sheet);
      }
      if (req.method === 'GET' && url.pathname === '/api/permits') {
        return send(...unpack(await api.permitBoard()));
      }
      // §6B.3 — the human clearance step. The only route in the app that can
      // move a permit's lifecycle, and so the only one that can unblock a
      // crew on protected work. Every rule about whether a move is allowed
      // lives in clearance.ts; this line only carries the request there.
      // §6B.1 step 6 — the submission packet for one permit. GET only: there
      // is no filing endpoint here and there is not going to be one.
      {
        const m = url.pathname.match(/^\/api\/permits\/([^/]+)\/packet$/);
        if (req.method === 'GET' && m) {
          return send(...unpack(await api.permitPacket(decodeURIComponent(m[1]!))));
        }
      }
      if (req.method === 'POST' && url.pathname === '/api/permits/status') {
        return send(...unpack(await api.movePermit((await readJson(req)) as Record<string, unknown>)));
      }
      // The five-minute inbox watch's last pass (Mike, 2026-08-03). READ-ONLY
      // in both directions: this reports what the watch already saw and can
      // neither trigger a pass nor touch the mailbox.
      //
      // A watch that never started answers UNAVAILABLE, not an empty pass. On
      // a screen those two look the same and mean opposite things.
      if (req.method === 'GET' && url.pathname === '/api/inbox') {
        const last = inboxWatch?.last();
        return send(200, last ?? unavailablePass(new Date().toISOString(), 'inbox watch has not completed a pass'));
      }
      // Catch-up sweep (Mike, 2026-09-24): one pass reaching back days, same
      // reader, same dedupe, same intent engine. Read-only like every pass.
      if (req.method === 'POST' && url.pathname === '/api/inbox/backfill') {
        const b = (await readJson(req)) as Record<string, unknown>;
        const sinceIso = typeof b.sinceIso === 'string' ? b.sinceIso : '';
        const sinceMs = Date.parse(sinceIso);
        if (!sinceIso || Number.isNaN(sinceMs)) return send(400, { error: 'sinceIso_required' });
        // Ten days is plenty of "catch up" and keeps one tap from asking
        // Gmail for a year of mail. Named refusal, nothing scanned.
        if (Date.now() - sinceMs > 10 * 24 * 60 * 60 * 1000) {
          return send(400, { error: 'too_far_back', message: 'Backfill reaches at most 10 days. Nothing was scanned.' });
        }
        if (!inboxWatch) return send(503, { error: 'inbox_watch_not_started' });
        return send(200, await inboxWatch.backfill(sinceIso));
      }
      // ═══ The intent engine (R17) ═══ Everything under /api/inbox/intents
      // serves the app behind the keywall. Surfaced cards carry customer
      // contact BY RULING — R17 moved the app-UI boundary; logs and chat
      // still carry counts and ids only (§4.3).
      if (req.method === 'GET' && url.pathname === '/api/inbox/intents') {
        if (!intentWatch) return send(200, { pipeline: 'not_started' });
        const now = new Date();
        const last = inboxWatch?.last();
        const gmailReadable = last != null && last.status !== 'unavailable';
        const s = intentWatch.snapshotStatus();
        return send(200, {
          pipeline: !gmailReadable ? 'no_gmail' : !s.modelConfigured ? 'pattern_only' : 'live',
          gmailReason: !gmailReadable ? (last?.reason ?? 'inbox watch has not completed a pass') : null,
          ...intentWatch.store.snapshot(now),
          zeroFlag: intentWatch.store.zeroSurfacedFlag(now, gmailReadable),
          proposals: intentWatch.registry.pendingProposals(),
          intents: intentWatch.registry.intents(),
          pendingCommit: intentWatch.registry.exportPending().approvedPendingCommit.length,
          model: s,
        });
      }
      if (req.method === 'POST' && url.pathname === '/api/inbox/relabel') {
        if (!intentWatch) return send(503, { error: 'intent_engine_not_started' });
        const b = (await readJson(req)) as Record<string, unknown>;
        const threadId = typeof b.threadId === 'string' ? b.threadId : '';
        const intent = typeof b.intent === 'string' ? b.intent : '';
        if (!threadId || !intent) return send(400, { error: 'threadId_and_intent_required' });
        const ok = await intentWatch.relabel(threadId, intent);
        return ok
          ? send(200, { ok: true })
          : send(400, { error: 'unknown_intent', message: 'Not a known intent id. Nothing was changed.' });
      }
      if (req.method === 'POST' && url.pathname === '/api/inbox/intents/approve') {
        if (!intentWatch) return send(503, { error: 'intent_engine_not_started' });
        const b = (await readJson(req)) as Record<string, unknown>;
        const id = typeof b.id === 'string' ? b.id : '';
        const label = typeof b.label === 'string' ? b.label : undefined;
        const def = id ? intentWatch.registry.approve(id, label) : null;
        return def
          ? send(200, { ok: true, intent: def })
          : send(400, { error: 'unknown_proposal', message: 'No such proposal. Nothing was changed.' });
      }
      if (req.method === 'POST' && url.pathname === '/api/inbox/intents/reject') {
        if (!intentWatch) return send(503, { error: 'intent_engine_not_started' });
        const b = (await readJson(req)) as Record<string, unknown>;
        const id = typeof b.id === 'string' ? b.id : '';
        return id && intentWatch.registry.reject(id)
          ? send(200, { ok: true })
          : send(400, { error: 'unknown_proposal', message: 'No such proposal. Nothing was changed.' });
      }
      // What an in-app approval/correction would lose on redeploy, shaped for
      // committing into policy/inboxIntents.json — the honest half of
      // "learned" state while the links are cut.
      if (req.method === 'GET' && url.pathname === '/api/inbox/intents/export') {
        if (!intentWatch) return send(503, { error: 'intent_engine_not_started' });
        return send(200, intentWatch.registry.exportPending());
      }
      // The estimate→job step a contract-approval card prompts. NEVER
      // automatic, and honestly refused while the links are cut — there is
      // no job table to write into, and pretending otherwise is the lie §1B
      // exists to stop.
      if (req.method === 'POST' && url.pathname === '/api/inbox/convert') {
        if (!dataLinksLive()) {
          return send(409, {
            error: 'links_cut',
            message:
              'Data links are cut — there is no job table to convert into yet. Nothing was changed. Open the thread in Gmail and handle it there for now.',
          });
        }
        return send(409, {
          error: 'not_built',
          message:
            'Estimate→job conversion from a surfaced approval is not built yet — it lands with the links-live work. Nothing was changed.',
        });
      }
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
      // §6D/§6N.3 performance.
      if (req.method === 'GET' && url.pathname === '/api/performance') {
        return send(...unpack(await api.performance(Number(url.searchParams.get('days') ?? 365))));
      }
      // §6 site conditions + change orders.
      {
        const m = url.pathname.match(/^\/api\/jobs\/([^/]+)\/arrival$/);
        if (req.method === 'POST' && m) {
          return send(...unpack(await api.recordArrival(m[1]!, (await readJson(req)) as Record<string, unknown>)));
        }
      }
      {
        const m = url.pathname.match(/^\/api\/jobs\/([^/]+)\/change-order$/);
        if (req.method === 'POST' && m) {
          return send(...unpack(await api.addChangeOrder(m[1]!, (await readJson(req)) as Record<string, unknown>)));
        }
      }
      {
        const m = url.pathname.match(/^\/api\/change-orders\/([^/]+)\/approve$/);
        if (req.method === 'POST' && m) {
          return send(...unpack(await api.approveChangeOrder(m[1]!)));
        }
      }
      if (req.method === 'GET' && url.pathname === '/api/crew/reference') {
        return send(...unpack(await api.crewReference(
          url.searchParams.get('q') ?? '',
          url.searchParams.get('crewMemberId') ?? '',
        )));
      }
      if (req.method === 'POST' && url.pathname === '/api/crew/arrival') {
        return send(...unpack(await api.crewArrival((await readJson(req)) as Record<string, unknown>)));
      }
      if (req.method === 'POST' && url.pathname === '/api/crew/change-order') {
        return send(...unpack(await api.crewChangeOrder((await readJson(req)) as Record<string, unknown>)));
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
      // §6E fleet registry + §6D campaigns — the last read-only tables.
      if (req.method === 'POST' && url.pathname === '/api/fleet/units') {
        return send(...unpack(await api.createEquipmentUnit((await readJson(req)) as Record<string, unknown>)));
      }
      {
        const m = url.pathname.match(/^\/api\/fleet\/units\/([^/]+)\/retire$/);
        if (req.method === 'POST' && m) {
          return send(...unpack(await api.retireEquipmentUnit(m[1]!)));
        }
      }
      {
        const m = url.pathname.match(/^\/api\/fleet\/units\/([^/]+)\/part$/);
        if (req.method === 'POST' && m) {
          return send(...unpack(await api.addEquipmentPart(m[1]!, (await readJson(req)) as Record<string, unknown>)));
        }
      }
      if (req.method === 'POST' && url.pathname === '/api/campaigns') {
        return send(...unpack(await api.createCampaign((await readJson(req)) as Record<string, unknown>)));
      }
      // §4 roster — the people, their cards. Admin only.
      if (req.method === 'GET' && url.pathname === '/api/roster') {
        return send(...unpack(await api.roster()));
      }
      if (req.method === 'POST' && url.pathname === '/api/roster') {
        return send(...unpack(await api.createCrewMember((await readJson(req)) as Record<string, unknown>)));
      }
      {
        const m = url.pathname.match(/^\/api\/roster\/([^/]+)\/deactivate$/);
        if (req.method === 'POST' && m) {
          return send(...unpack(await api.deactivateCrewMember(m[1]!)));
        }
      }
      {
        const m = url.pathname.match(/^\/api\/roster\/([^/]+)\/certification$/);
        if (req.method === 'POST' && m) {
          return send(...unpack(await api.recordCertification(m[1]!, (await readJson(req)) as Record<string, unknown>)));
        }
      }
      // §6U library authoring — drafts in, named human out.
      if (req.method === 'GET' && url.pathname === '/api/reference/drafts') {
        return send(...unpack(await api.referenceDrafts()));
      }
      if (req.method === 'POST' && url.pathname === '/api/reference') {
        return send(...unpack(await api.createReferenceEntry((await readJson(req)) as Record<string, unknown>)));
      }
      {
        const m = url.pathname.match(/^\/api\/reference\/([^/]+)\/publish$/);
        if (req.method === 'POST' && m) {
          return send(...unpack(await api.publishReferenceEntry(m[1]!, (await readJson(req)) as Record<string, unknown>)));
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
      // Lead channel switches (cycle 34): Mike toggles each channel from the
      // Settings screen. Runtime state over the classifier's own OFF array —
      // applies to the next sweep instantly, resets to code defaults on
      // redeploy (said on the screen, not hidden). Behind the /api gate.
      if (req.method === 'GET' && url.pathname === '/api/settings/channels') {
        return send(200, {
          channels: LEAD_CHANNELS.map((c) => ({ id: c.id, label: c.label, on: !channelIsOff(c.id) })),
          note: 'Switches apply immediately and reset to the coded defaults on a redeploy.',
        });
      }
      if (req.method === 'POST' && url.pathname === '/api/settings/channels') {
        const body = (await readJson(req)) as { id?: unknown; on?: unknown };
        const ch = LEAD_CHANNELS.find((c) => c.id === body.id);
        if (!ch || typeof body.on !== 'boolean') return send(400, { error: 'unknown_channel_or_bad_toggle' });
        setChannelOff(ch.id, !body.on);
        console.error(`[settings] lead channel ${ch.id} switched ${body.on ? 'ON' : 'OFF'}`); // audit line — channel id only, no PII
        return send(200, { id: ch.id, on: !channelIsOff(ch.id) });
      }
      // R15: today's work ZIP — Mike sets it each morning; in-memory, honest.
      if (req.method === 'GET' && url.pathname === '/api/settings/route') {
        return send(200, {
          workZip: getTodayWorkZip(),
          location: liveLocationState(Date.now()),
          note: 'In-memory — resets on redeploy. Set it each morning until live tracking lands.',
        });
      }
      // R15/R16: the office phone posts its ZIP during the 8am–8pm Mon–Sat
      // window; the Settings toggle can shut the whole thing off. Refusals
      // are NAMED — after-hours location is never quietly kept.
      if (req.method === 'POST' && url.pathname === '/api/location/zip') {
        if (!isLocationEnabled()) return send(403, { error: 'location_off' });
        if (!withinWorkingHours(new Date())) return send(403, { error: 'after_hours' });
        const body = (await readJson(req)) as { zip?: unknown };
        if (typeof body.zip !== 'string' || !/^23\d{3}$/.test(body.zip)) return send(400, { error: 'bad_zip' });
        setLivePingZip(body.zip, Date.now());
        console.error('[location] live zip ping accepted'); // presence only — no ZIP in logs
        return send(200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/api/settings/location') {
        const body = (await readJson(req)) as { on?: unknown };
        if (typeof body.on !== 'boolean') return send(400, { error: 'bad_toggle' });
        setLocationEnabled(body.on);
        console.error(`[settings] location ${body.on ? 'ON' : 'OFF'}`);
        return send(200, { enabled: isLocationEnabled() });
      }
      // R16: the route planner. Live traffic via Google when a Maps key is
      // configured; ZIP estimates otherwise — the plan itself names its mode.
      if (req.method === 'POST' && url.pathname === '/api/route/plan') {
        const body = (await readJson(req)) as { stops?: unknown; day?: unknown; slotMinutes?: unknown };
        const day = body.day === 'saturday' || body.day === 'weekday' ? body.day : null;
        const rawStops = Array.isArray(body.stops) ? (body.stops as Array<Record<string, unknown>>) : null;
        if (!day || !rawStops) return send(400, { error: 'bad_plan_input' });
        const stops = [] as Array<{ label: string; city?: string; zip: string }>;
        for (const s of rawStops) {
          if (typeof s.label !== 'string' || s.label.trim() === '' || typeof s.zip !== 'string' || !/^23\d{3}$/.test(s.zip)) {
            return send(400, { error: 'bad_stop' });
          }
          stops.push({ label: s.label.trim(), zip: s.zip, ...(typeof s.city === 'string' && s.city.trim() !== '' ? { city: s.city.trim() } : {}) });
        }
        const plan = await planRouteLive(
          {
            stops,
            day,
            ...(typeof body.slotMinutes === 'number' && body.slotMinutes >= 5 && body.slotMinutes <= 120 ? { slotMinutes: body.slotMinutes } : {}),
            startZip: getLiveWorkZip(Date.now()) ?? getTodayWorkZip(),
            homeZip: env.ownerHomeZip ?? null,
          },
          {
            apiKey: env.google.mapsApiKey ?? null,
            fetchMatrix: (addrs, key, dep) => fetchDriveMinutesMatrix(addrs, key, (u, i) => fetch(u, i), dep),
            nowIso: () => new Date(Date.now() + 5 * 60 * 1000).toISOString(),
          },
        );
        return send(200, plan);
      }
      if (req.method === 'POST' && url.pathname === '/api/settings/route') {
        const body = (await readJson(req)) as { workZip?: unknown };
        const wz = body.workZip === null || body.workZip === '' ? null : body.workZip;
        if (wz !== null && (typeof wz !== 'string' || !/^23\d{3}$/.test(wz))) return send(400, { error: 'bad_zip' });
        setTodayWorkZip(wz);
        console.error(`[settings] today work zip ${wz ? 'set' : 'cleared'}`); // presence only, no ZIP in logs
        return send(200, { workZip: getTodayWorkZip() });
      }
      // Reception instrument for the cockpit (§9): counts and timestamps only
      // — no caller text, no numbers, nothing §4.3 forbids. In-memory since
      // boot; llmKeyPresent is the "callers hear the fallback line" tell.
      if (req.method === 'GET' && url.pathname === '/api/reception/status') {
        return send(200, { ...bridge.status(), llmKeyPresent: Boolean(env.anthropic.apiKey), linkCut: !vendorLinked('elevenlabs') });
      }
      // R18: the call records — Mike's copy of what she captured, keywall-only.
      if (req.method === 'GET' && url.pathname === '/api/calls/records') {
        return send(200, {
          records: callRecords.list(),
          knownCallers: callMemory.size,
          calendarHolds: calendarHold ? 'configured' : 'DISABLED — no Google token (this is not zero holds)',
          note: 'In-memory since deploy — the calendar hold is the durable copy until the data links go live.',
        });
      }
      // R19: webhook state + captured payloads, keywall-only (customer
      // contact info is fine in the app UI per R17, never in logs).
      if (req.method === 'GET' && url.pathname === '/api/webhooks') {
        return send(200, { ...webhooks.status(), recent: webhooks.recentEvents(30), cut: cutVendorLinks() });
      }
      if (req.method === 'GET' && url.pathname === '/api/webhooks/forms') {
        return send(200, {
          wired: Boolean(env.resend.webhookSecret),
          bodyFetch: Boolean(env.resend.apiKey),
          forms: webhooks.websiteForms(),
          note: 'Direct wire from Resend. The email copy to Mike is untouched — this is the SAME submission, delivered twice on purpose.',
        });
      }
      if (req.method === 'GET' && url.pathname === '/api/quo') {
        return send(200, { status: quoIntake.status(), calls: quoIntake.list() });
      }
      // R22: text outreach — status, who qualifies, what went out (keywall).
      if (url.pathname.startsWith('/api/outreach')) {
        if (!outreach) return send(503, { error: 'quo_not_configured', message: 'No QUO_API_KEY on the server — nothing can be texted. This is not zero candidates.' });
        // This door SENDS texts and lists customer numbers held in memory —
        // the "no key while the DB is cut" opening never applies here.
        if (!env.appAccessKey) return send(401, { error: 'no_app_key', message: 'APP_ACCESS_KEY is not set — texting is locked until it is.' });
        if (req.method === 'GET' && url.pathname === '/api/outreach') {
          return send(200, { status: outreach.status(), candidates: outreach.candidates(), sends: outreach.sends().slice(0, 50) });
        }
        if (req.method === 'POST' && url.pathname === '/api/outreach/preview') {
          const candidates = await outreach.buildCandidates();
          return send(200, { candidates, status: outreach.status() });
        }
        if (req.method === 'POST' && url.pathname === '/api/outreach/catchup') {
          // Mike's tap — never gated by the automatic-sends switch.
          const out = await outreach.runCatchup('mike');
          return send(out.ran ? 200 : 409, out);
        }
        if (req.method === 'POST' && url.pathname === '/api/outreach/exclude') {
          const body = (await readJson(req)) as { conversationId?: unknown };
          if (typeof body.conversationId !== 'string' || !body.conversationId) return send(400, { error: 'conversationId_required' });
          outreach.exclude(body.conversationId);
          return send(200, { ok: true });
        }
      }
      if (req.method === 'GET' && url.pathname === '/api/webhooks/texts') {
        return send(200, {
          wired: Boolean(env.twilioSmsWebhookKey),
          texts: webhooks.texts(),
          note: 'Texts and photos sent to the Arbo number. Receive only — Arbo never replies. NOT WIRED is not zero texts.',
        });
      }
      if (req.method === 'GET' && url.pathname === '/api/webhooks/calls') {
        return send(200, {
          wired: Boolean(env.elevenlabs.postCallSecret),
          transcripts: webhooks.callTranscripts(),
          note: 'Post-call transcripts pushed by ElevenLabs. NOT WIRED means the webhook secret is absent — that is not zero calls.',
        });
      }
      // R19: the data links, one by one. States are named (§1B): master cut,
      // link cut, or open — an open link is probed read-only with counts.
      if (req.method === 'GET' && url.pathname === '/api/links') {
        const master = dataLinksSim() ? 'sim' : dataLinksLive() ? 'live' : 'cut';
        const links = await Promise.all(LINK_NAMES.map(async (link) => {
          const open = linkOpen(link);
          const counts: Record<string, number | 'unreadable'> = {};
          if (open && hasDb()) {
            for (const t of DATA_LINKS[link]) {
              try {
                const r = await getDb().from(t).select('*', { count: 'exact', head: true });
                counts[t] = r.error ? 'unreadable' : (r.count ?? 0);
              } catch {
                counts[t] = 'unreadable';
              }
            }
          }
          return {
            link,
            envVar: linkEnvVar(link),
            state: open ? 'open' : 'cut',
            tables: DATA_LINKS[link],
            ...(open ? { rowCounts: counts } : {}),
          };
        }));
        return send(200, {
          master,
          links,
          note: 'A CUT link is a closed door, not empty data. Each link opens one by one after its verification passes (docs/DATA_LINKS.md) — R19.',
        });
      }
      // ElevenLabs custom-LLM endpoint (the agent's Server URL points at
      // /voice/llm; the platform appends the OpenAI-style path).
      if (req.method === 'POST' && (url.pathname === '/voice/llm/chat/completions' || url.pathname === '/voice/llm/v1/chat/completions') && !vendorLinked('elevenlabs')) {
        return send(503, vendorCutBody('elevenlabs'));
      }
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
      // A bad request is the CALLER's fault and says so — 400, with which of
      // the two problems it was. Everything else is genuinely ours.
      if (err instanceof BadRequestError) return send(400, { error: err.code });
      // R19: a cut data link refuses BY NAME — "the door is closed" must
      // never render as a vague server error (§1B). No PII in the message.
      if (err instanceof LinkCutError) {
        return send(503, { error: 'link_cut', link: err.link, table: err.table, message: err.message });
      }
      // Never put customer data or stack traces on the wire (§4.3).
      console.error('[server]', err instanceof Error ? err.message : 'error');
      return send(500, { error: 'server_error' });
    }
  };
}

/**
 * The running inbox watch, if one was started. Module-level and nullable on
 * purpose — the handler needs to read the last pass, and threading a handle
 * through createApi to reach one route is the kind of cleverness this
 * codebase keeps being told to stop doing.
 */
let inboxWatch: InboxWatchHandle | null = null;
/** The intent engine riding the watch's observer hook. Same pattern, same reason. */
let intentWatch: IntentWatch | null = null;
/** The Quo intake the running handler uses — startServer hands it its webhook keys. */
let currentQuoIntake: QuoIntake | null = null;
/** Learning from Quo's record: a week back at boot, a day back every 10 minutes. */
const QUO_LEARN_BACKFILL_MS = 7 * 24 * 60 * 60 * 1000;
const QUO_LEARN_WINDOW_MS = 24 * 60 * 60 * 1000;
const QUO_LEARN_EVERY_MS = 10 * 60 * 1000;
/** Business line 757-319-5131 and Arbo's line 757-821-6983 (docs/PHONE_SETUP.md) — never texted by outreach. */
const OWN_PHONE_NUMBERS = ['+17573195131', '+17578216983'];
/** The outreach engine the running handler uses — startServer hands it the Quo line. */
let currentOutreach: OutreachEngine | null = null;

/**
 * Register Arbo's webhooks with Quo and hand the intake its signing keys.
 * Every outcome is a NAMED state on /api/quo and a boot log line — a Quo
 * that is not wired must never look like a quiet phone (§1B).
 */
async function wireQuo(intake: QuoIntake, outreach: OutreachEngine | null): Promise<{ api: ReturnType<typeof createQuoApi>; phoneNumberId: string } | null> {
  if (!env.quoApiKey) return null;
  const domain = process.env.RAILWAY_PUBLIC_DOMAIN;
  if (!domain) {
    intake.setRegistration('failed', 'No public URL (RAILWAY_PUBLIC_DOMAIN) to give Quo — Sona calls cannot reach Arbo.');
    console.error('[quo] NOT wired — no public URL');
    return null;
  }
  intake.setRegistration('pending', 'Registering with Quo…');
  const api = createQuoApi(env.quoApiKey);
  try {
    const [hooks, lines] = await Promise.all([
      ensureQuoWebhooks(api, `https://${domain}/webhooks/quo`),
      api.phoneNumbers().catch(() => []),
    ]);
    const numbers = lines.map((l) => l.number);
    // R22: Arbo texts from the FIRST Quo line — one number, no ambiguity.
    const first = lines[0];
    // Our own numbers are never texted: every Quo line, the business line
    // (Mike's cell) and Arbo's own line — docs/PHONE_SETUP.md.
    if (outreach && first) outreach.setLine({ phoneNumberId: first.id, number: first.number, ownNumbers: [...numbers, ...OWN_PHONE_NUMBERS] });
    else if (outreach) console.error('[outreach] NOT wired — Quo returned no phone number; nothing can be texted');
    const partial = hooks.failed.length
      ? ` NOT wired: ${hooks.failed.map((f) => `${f.family} (${f.why})`).join(', ')}.`
      : '';
    intake.setRegistration(
      hooks.failed.length ? 'failed' : 'ok',
      `Wired to Quo — ${hooks.created.length} webhook(s) created, ${hooks.reused.length} reused.${partial}`,
      hooks.keys,
      numbers,
    );
    console.log(`[quo] wired — created ${hooks.created.length}, reused ${hooks.reused.length}, failed ${hooks.failed.length}, ${numbers.length} number(s)`);
    return first ? { api, phoneNumberId: first.id } : null;
  } catch (err) {
    const why = err instanceof Error ? err.message : 'error';
    intake.setRegistration('failed', `Quo registration failed (${why}) — Sona calls are NOT reaching Arbo. This is not zero calls.`);
    console.error('[quo] registration FAILED:', why);
    return null;
  }
}

export function startServer(port: number) {
  const summary = boot();
  const server = createServer(createArborRequestHandler());
  // Mike, 2026-08-03: "it needs to run a sweep every 5 mins". The platform
  // scheduler floors at an hour and its routines carry no Gmail connector,
  // so the loop lives here instead.
  //
  // THE READER GOES LIVE WHEN ALL THREE GMAIL_OAUTH_* VARS EXIST — the
  // refresh token is Mike's one-time gmail.readonly consent (backlog #36).
  // With any of the three absent the reader stays null, and that is the
  // honest state, not a stub: the watch reports UNAVAILABLE every hour,
  // which an operator can act on; a watch never started is silence.
  const g = env.google;
  // One token provider for both Gmail doors — the recent-mail reader and the
  // intent engine's thread reader share the same gmail.readonly consent.
  const gmailToken = g.gmailOauthClientId && g.gmailOauthClientSecret && g.gmailOauthRefreshToken
    ? createRefreshTokenProvider({
        clientId: g.gmailOauthClientId,
        clientSecret: g.gmailOauthClientSecret,
        refreshToken: g.gmailOauthRefreshToken,
      })
    : null;
  const gmailReader = gmailToken ? createGoogleGmailReader(gmailToken) : null;
  // The intent engine (R17, Mike's go 2026-09-23): Opus judged, human-in-the-
  // loop learned, surfaced only to the keywall-gated app. Each absent piece
  // is a NAMED degradation, never a quiet one: no API key = pattern-only
  // verdicts (status says so), no Gmail = the watch is already screaming.
  intentWatch = new IntentWatch(
    env.anthropic.apiKey ? createOpusIntentModel(env.anthropic.apiKey) : null,
    gmailToken ? createGoogleGmailThreadReader(gmailToken) : null,
    new IntentRegistry(),
    new InboxSurfaceStore(),
  );
  inboxWatch = startInboxWatch(gmailReader, { onMessage: intentWatch.observer });
  // Sona via Quo: register Arbo's webhooks in the background — the server
  // listens meanwhile, and every outcome is named on /api/quo.
  if (currentQuoIntake) {
    const outreach = currentOutreach;
    const intake = currentQuoIntake;
    void wireQuo(intake, outreach).then((line) => {
      // "Need arbo to start learning from QUO" (Mike, 2026-09-24): read
      // Sona's calls from Quo's own record — the last week at boot (learned
      // without new holds), then every 10 minutes (catches any call the
      // webhook missed). reconcile() names its own failures; it never throws.
      if (line) {
        void intake.reconcile(line.api, line.phoneNumberId, QUO_LEARN_BACKFILL_MS);
        setInterval(() => { void intake.reconcile(line.api, line.phoneNumberId, QUO_LEARN_WINDOW_MS); }, QUO_LEARN_EVERY_MS).unref();
      } else if (env.quoApiKey) console.error('[quo] NOT learning from Quo\'s record — no Quo line to read');
      if (!outreach) return;
      const tv = outreach.verifyTemplate();
      console.log(tv.ok
        ? `[outreach] template OK — follow-ups ${env.outreachAuto ? 'AUTO (hourly, 48h after an inquiry)' : 'OFF until ARBO_OUTREACH=live'}; catch-up ${env.outreachCatchupAtBoot ? 'RUNNING at boot' : 'waits for Mike\'s tap or ARBO_OUTREACH_CATCHUP=live'}`
        : `[outreach] template REFUSED — nothing will be texted: ${tv.problems.join('; ')}`);
      if (env.outreachCatchupAtBoot) {
        // A Quo failure at boot is a named log line, never a crashed server.
        outreach.runCatchup('auto').catch((err) => {
          console.error('[outreach] boot catch-up FAILED — nothing sent:', err instanceof Error ? err.message : 'error');
        });
      }
      // Every 15 minutes: release texts held for quiet hours, and on the hour
      // queue the 48-hour follow-ups. Same shape as the agent scheduler.
      setInterval(() => { void outreach.tick(); }, 15 * 60_000).unref();
    });
  } else console.error('[quo] intake missing at boot — not wired');
  const cutNow = cutVendorLinks();
  console.log(cutNow.length
    ? `[links] CUT while Sona handles calls (R21): ${cutNow.join(', ')} — set ARBO_LINK_<NAME>=live to reconnect`
    : '[links] ElevenLabs and Twilio links live');
  if (!env.quoApiKey) console.error('[quo] DISABLED — no QUO_API_KEY. Sona calls are not reaching Arbo (this is not zero calls).');
  // §8A.6f: the agents run on their own clock, not only when Mike taps.
  startAgentScheduler(
    createApi(createServerSource(), { alerts: createNwsAlertsProvider((u, i) => fetch(u, i)) }),
    createNwsAlertsProvider((u, i) => fetch(u, i)),
  );
  server.listen(port, () => {
    // Three states, never two: configured-and-live, configured-but-CUT, and
    // not configured at all. Collapsing the middle one into either of the
    // others is the §1B lie in the one line an operator actually reads.
    const dbState = dataLinksSim()
      ? 'SIMULATION — every record is fake, no database connection is opened'
      : !dbConfigured()
        ? 'not configured'
        : dataLinksLive()
          ? `connected — links open: ${openLinks().join(', ') || `NONE of ${LINK_NAMES.length} (master live, every ARBO_LINK_* still cut)`}`
          : 'CONFIGURED BUT LINKS CUT (ARBO_DATA_LINKS is not "live") — no real data is being read or written';
    console.log(`✅ ARBO backend on :${port} — guardrails v${summary.guardrailsVersion}, legal v${summary.legalVersion}, db ${dbState}`);
  });
  return server;
}

function unpack(r: { status: number; body: unknown }): [number, unknown] {
  return [r.status, r.body];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer(Number(process.env.PORT ?? 8787));
}
