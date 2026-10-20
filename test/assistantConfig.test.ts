// R28 — the safe Arbo Managed Agent config (agents/arbo/agent.yaml).
//
// Mike pasted a Managed Agent config with every toolset on "auto" (Gmail,
// Calendar, Drive and Quo could send, write and delete with no one looking).
// His answer, 2026-10-20: "Make it safe, then set it up." This test pins the
// safe version so it cannot drift back:
//   - safety is in the PERMISSION POLICY, not only the prompt: every tool that
//     sends, writes or changes something is always_ask (Mike taps Allow in
//     the Arbo app first);
//   - every Gmail / Calendar / Drive / Quo toolset is OFF by default with an
//     explicit allowlist, so a tool a server adds later stays off;
//   - Square is always_ask for every call until its tool list has been seen;
//   - the one write that runs unasked is Calendar create_event (Mike approved
//     booking times) — and edit / move / delete stay off;
//   - the prompt carries each standing rule (key phrases below).
// Change agent.yaml and this test together, and only on Mike's word.
//
// YAML is read with js-yaml, which the repo already has through its lint
// tooling (eslint -> @eslint/eslintrc). No new dependency; createRequire keeps
// it usable from this ES module without a type shim.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const requireCjs = createRequire(import.meta.url);
const yaml = requireCjs('js-yaml') as { load: (src: string) => unknown };

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const AGENT_PATH = resolve(repoRoot, 'agents/arbo/agent.yaml');
const ORIGINAL_PATH = resolve(repoRoot, 'agents/arbo/original-from-mike.yaml');

interface Policy {
  type: string;
}
interface ToolConfig {
  name: string;
  enabled?: boolean;
  permission_policy?: Policy;
}
interface Toolset {
  type: string;
  mcp_server_name?: string;
  default_config?: { enabled?: boolean; permission_policy?: Policy };
  configs?: ToolConfig[];
}
interface AgentConfig {
  name: string;
  model: { id: string; effort?: string | { type: string }; speed?: string };
  description: string;
  system: string;
  mcp_servers: Array<{ name: string; type: string; url: string }>;
  tools: Toolset[];
  skills: unknown[];
  metadata: Record<string, string>;
}

const agentText = readFileSync(AGENT_PATH, 'utf8');
const agent = yaml.load(agentText) as AgentConfig;
const original = yaml.load(readFileSync(ORIGINAL_PATH, 'utf8')) as AgentConfig;

const ALLOW = 'always_allow';
const ASK = 'always_ask';
const GMAIL = 'gmail-gmailmcp';
const CALENDAR = 'google-calendar-calendarmcp';
const QUO = 'quo';
const DRIVE = 'google-drive-drivemcp';
const SQUARE = 'square';

function toolset(server: string): Toolset {
  const t = agent.tools.find((x) => x.type === 'mcp_toolset' && x.mcp_server_name === server);
  if (!t) throw new Error(`no mcp_toolset for ${server}`);
  return t;
}

// What the platform does with a call to `tool`: a per-tool config entry wins
// over the toolset default. An unset `enabled` means ON (the API's default),
// so a missing default can never read as "off" here.
function effective(t: Toolset, tool: string): { enabled: boolean; policy: string | undefined } {
  const c = t.configs?.find((x) => x.name === tool);
  return {
    enabled: c?.enabled ?? t.default_config?.enabled ?? true,
    policy: c?.permission_policy?.type ?? t.default_config?.permission_policy?.type,
  };
}

// The exact allowlist per server. Anything not named here is off.
const EXPECTED: Record<string, Record<string, string>> = {
  [GMAIL]: {
    search_threads: ALLOW,
    get_thread: ALLOW,
    get_message: ALLOW,
    list_labels: ALLOW,
    list_drafts: ALLOW,
    get_draft: ALLOW,
    create_draft: ALLOW,
    update_draft: ALLOW,
    send_message: ASK,
    reply: ASK,
    forward: ASK,
  },
  [CALENDAR]: {
    list_calendars: ALLOW,
    list_events: ALLOW,
    search_events: ALLOW,
    get_event: ALLOW,
    suggest_time: ALLOW,
    create_event: ALLOW,
  },
  [DRIVE]: {
    search_files: ALLOW,
    read_file_content: ALLOW,
    download_file_content: ALLOW,
    get_file_metadata: ALLOW,
    list_recent_files: ALLOW,
    create_file: ASK,
    update_file: ASK,
    copy_file: ASK,
  },
  [QUO]: {
    'fetch-messages': ALLOW,
    'fetch-call-transcripts': ALLOW,
    'fetch-missed-calls': ALLOW,
    'list-contacts': ALLOW,
    'get-contact': ALLOW,
    'list-contact-notes': ALLOW,
    'list-inboxes': ALLOW,
    'list-users': ALLOW,
    'get-inbox-settings': ALLOW,
    'list-tasks': ALLOW,
    'send-message': ASK,
    'create-contact': ASK,
    'update-contact': ASK,
    'create-contact-note': ASK,
    'update-contact-note': ASK,
    'create-task': ASK,
    'update-task': ASK,
  },
};

// Every tool that sends, writes or changes something in Mike's accounts.
const SENDS_AND_WRITES: Array<[string, string]> = [
  [GMAIL, 'send_message'],
  [GMAIL, 'reply'],
  [GMAIL, 'forward'],
  [DRIVE, 'create_file'],
  [DRIVE, 'update_file'],
  [DRIVE, 'copy_file'],
  [QUO, 'send-message'],
  [QUO, 'create-contact'],
  [QUO, 'update-contact'],
  [QUO, 'create-contact-note'],
  [QUO, 'update-contact-note'],
  [QUO, 'create-task'],
  [QUO, 'update-task'],
];

// Real upstream tools that must never be on (names as the servers report them).
const NEVER_ON: Array<[string, string]> = [
  [CALENDAR, 'update_event'],
  [CALENDAR, 'delete_event'],
  [CALENDAR, 'respond_to_event'],
  [DRIVE, 'share_file'],
  [DRIVE, 'trash_file'],
  [DRIVE, 'get_file_permissions'],
  [QUO, 'send-bulk-messages'],
  [QUO, 'send-group-message'],
  [QUO, 'start-agent-conversation'],
  [QUO, 'cancel-agent-conversation'],
  [QUO, 'get-agent-conversation'],
  [QUO, 'ask-knowledge-agent'],
  [QUO, 'decide-knowledge-save'],
  [QUO, 'submit-feedback'],
  [QUO, 'mark-conversations'],
  [QUO, 'update-inbox-settings'],
  [QUO, 'create-a2p-registration'],
  [QUO, 'get-a2p-registration'],
  [QUO, 'submit-a2p-registration'],
  [QUO, 'update-a2p-registration'],
  [GMAIL, 'delete_draft'],
  [GMAIL, 'trash_message'],
  [GMAIL, 'trash_thread'],
  [GMAIL, 'untrash_message'],
  [GMAIL, 'untrash_thread'],
  [GMAIL, 'mark_message_spam'],
  [GMAIL, 'mark_thread_spam'],
  [GMAIL, 'unmark_message_spam'],
  [GMAIL, 'unmark_thread_spam'],
  [GMAIL, 'label_message'],
  [GMAIL, 'label_thread'],
  [GMAIL, 'unlabel_message'],
  [GMAIL, 'unlabel_thread'],
  [GMAIL, 'update_message_labels'],
  [GMAIL, 'create_label'],
  [GMAIL, 'update_label'],
  [GMAIL, 'delete_label'],
  [GMAIL, 'apply_sensitive_message_label'],
  [GMAIL, 'apply_sensitive_thread_label'],
];

describe('R28 agent config — permission policy, not prompt alone', () => {
  it('every tool that sends, writes or changes something waits for Mike (always_ask)', () => {
    for (const [server, tool] of SENDS_AND_WRITES) {
      expect(effective(toolset(server), tool), `${server}.${tool}`).toEqual({ enabled: true, policy: ASK });
    }
  });

  it('each Gmail / Calendar / Drive / Quo toolset is exactly its allowlist, every listed tool on', () => {
    for (const [server, expected] of Object.entries(EXPECTED)) {
      const configs = toolset(server).configs ?? [];
      const actual = Object.fromEntries(configs.map((c) => [c.name, c.permission_policy?.type]));
      expect(actual, server).toEqual(expected);
      expect(configs.every((c) => c.enabled === true), server).toBe(true);
      expect(new Set(configs.map((c) => c.name)).size, `${server} has a duplicate entry`).toBe(configs.length);
    }
  });

  it('every MCP toolset is OFF by default (asking if ever on) except Square — a tool added later stays off', () => {
    for (const t of agent.tools.filter((x) => x.type === 'mcp_toolset')) {
      if (t.mcp_server_name === SQUARE) continue;
      expect(t.default_config, t.mcp_server_name).toEqual({ enabled: false, permission_policy: { type: ASK } });
      expect(effective(t, 'a_tool_the_server_adds_next_month').enabled, t.mcp_server_name).toBe(false);
    }
  });

  it('edit / move / delete / share / trash / bulk-text tools are not enabled', () => {
    for (const [server, tool] of NEVER_ON) {
      expect(effective(toolset(server), tool).enabled, `${server}.${tool}`).toBe(false);
    }
  });

  it('Square: every call waits for Mike, reads included, and nothing is loosened yet', () => {
    const sq = toolset(SQUARE);
    expect(sq.default_config).toEqual({ enabled: true, permission_policy: { type: ASK } });
    expect(sq.configs ?? []).toEqual([]);
    expect(effective(sq, 'create_invoice').policy).toBe(ASK);
    expect(effective(sq, 'list_payments').policy).toBe(ASK);
  });

  it('the one write that runs unasked is Calendar create_event (Mike approved booking, R28)', () => {
    // Walks the YAML itself (not the EXPECTED table), so it stands on its own.
    const unaskedWrites: string[] = [];
    for (const t of agent.tools.filter((x) => x.type === 'mcp_toolset')) {
      const server = t.mcp_server_name ?? '';
      for (const c of t.configs ?? []) {
        const { enabled, policy } = effective(t, c.name);
        const isRead = /^(search|get|list|fetch|read|download|suggest)[-_]/.test(c.name);
        const isDraft = server === GMAIL && /_draft$/.test(c.name);
        if (enabled && policy !== ASK && !isRead && !isDraft) unaskedWrites.push(`${server}.${c.name}`);
      }
    }
    expect(unaskedWrites).toEqual([`${CALENDAR}.create_event`]);
  });

  it('built-in tools: default auto, web search and web fetch on, file and bash tools auto', () => {
    const builtIn = agent.tools.filter((x) => x.type === 'agent_toolset_20260401');
    expect(builtIn).toHaveLength(1);
    const t = builtIn[0]!;
    expect(t.default_config).toEqual({ enabled: true, permission_policy: { type: 'auto' } });
    for (const tool of ['web_search', 'web_fetch', 'bash', 'read', 'write', 'edit', 'glob', 'grep']) {
      expect(effective(t, tool), tool).toEqual({ enabled: true, policy: 'auto' });
    }
  });

  it('only the agent toolset and the five MCP toolsets — no custom tools, no skills', () => {
    expect(agent.tools.map((t) => t.type).sort()).toEqual(
      ['agent_toolset_20260401', 'mcp_toolset', 'mcp_toolset', 'mcp_toolset', 'mcp_toolset', 'mcp_toolset'].sort(),
    );
    expect(agent.skills).toEqual([]);
  });

  it('the five MCP servers are exactly Mike’s (vault credentials match by URL) and each has one toolset', () => {
    expect(agent.mcp_servers).toEqual(original.mcp_servers);
    const named = agent.tools.filter((t) => t.type === 'mcp_toolset').map((t) => t.mcp_server_name).sort();
    expect(named).toEqual(agent.mcp_servers.map((s) => s.name).sort());
  });
});

describe('R28 agent config — model and limits', () => {
  it('runs on Opus 5.5 and effort is not low (it now handles email, money and bookings)', () => {
    expect(agent.model.id).toBe('claude-opus-5-5');
    const effort = typeof agent.model.effort === 'string' ? agent.model.effort : agent.model.effort?.type;
    expect(['medium', 'high', 'xhigh', 'max']).toContain(effort);
  });

  it('fits the Managed Agents field limits', () => {
    expect(agent.name).toBe('Arbo');
    expect(agent.system.length).toBeGreaterThan(0);
    expect(agent.system.length).toBeLessThanOrEqual(100_000);
    expect(agent.description.length).toBeLessThanOrEqual(2048);
    const meta = Object.entries(agent.metadata);
    expect(meta.length).toBeLessThanOrEqual(16);
    for (const [k, v] of meta) {
      expect(k.length, k).toBeLessThanOrEqual(64);
      expect(String(v).length, k).toBeLessThanOrEqual(512);
    }
  });

  it('keeps Mike’s original paste on record, unchanged in substance (low effort, all auto)', () => {
    expect(readFileSync(ORIGINAL_PATH, 'utf8')).toMatch(/^# RECORD ONLY/);
    expect(original.model.effort).toEqual({ type: 'low' });
    expect(original.tools.find((t) => t.mcp_server_name === GMAIL)?.default_config?.permission_policy).toEqual({ type: 'auto' });
  });
});

describe('R28 agent config — the system prompt carries every standing rule', () => {
  const RULES: Array<[string, RegExp]> = [
    ['who it is', /You are Arbo, Art-is-Tree's AI assistant/],
    ['Sona answers live calls', /Sona \(Quo's AI\) still answers the live phone calls\. You cannot take a live call\./],
    ['works afterward from texts, emails, transcripts, missed calls', /texts, emails .*call transcripts and missed calls/],
    ['one item per session', /Handle exactly that one item/],
    ['approval in the Arbo app', /Every email, every text, every Drive write and every Square action waits for Mike's OK in the Arbo app/],
    ['draft fully, then request', /draft it completely first/],
    ['never rewrites Mike’s own drafts', /Only change drafts you made yourself — never one of Mike's/],
    ['email content in the call, not a draft id', /Never send a saved draft by its draft id/],
    ['never claim sent before the result', /Never claim something was sent, booked, filed, charged or saved until the tool result says it happened/],
    ['§1B: unreadable is not empty', /"I couldn't read it" is never the same as "there's nothing there"/],
    ['never edit/move/delete an event', /You never edit, move or delete an existing event/],
    ['no calendar guests (invites are email)', /Never add guests or attendees, and set notifications to none/],
    ['R14 estimate timing', /Virginia Beach visits go after 12; Norfolk, Chesapeake and Portsmouth go in the morning/],
    ['R14 exact time only Friday afternoon', /Mike confirms the exact time Friday afternoon/],
    ['job-start rule', /Jobs start 8:30–9am/],
    ['R9: job only with a filed signed contract', /only once its signed contract is filed in Drive/],
    ['duration bands are internal', /Internal only — never tell anyone these bands/],
    ['never a price, range, minimum or estimate', /Never quote a price, range, ballpark, estimate or the job minimum to anyone/],
    ['$500 minimum internal only', /Screen against the \$500 job minimum internally only/],
    ['never mention the minimum', /Never mention the minimum/],
    ['photos for small or unclear jobs', /ask for photos first/],
    ['suggest bundling', /suggest bundling other work on the property/],
    ['the number comes from Mike', /THE NUMBER ALWAYS COMES FROM MIKE/],
    ['never diagnose', /Never diagnose a tree/],
    ['credentials', /only "licensed and insured, Google Verified, 5 star rated"/],
    ['never TCIA / ISA', /Never claim TCIA, ISA or any other membership/],
    ['permit vocabulary', /use only PERMIT LIKELY, PERMIT: REVIEW NEEDED, or NO OVERLAY — VERIFY W\/ CITY/],
    ['never clear / exempt / no permit needed', /Never say a property is "clear" or "exempt", and never say "no permit needed"/],
    ['911', /"If anyone is hurt, call 911 now\."/],
    ['Dominion', /call Dominion Energy at 1-866-366-4357/],
    ['emergency alerts Mike', /URGENT: EMERGENCY/],
    ['wants a human -> personal callback', /flag it to Mike as a personal callback/],
    ['TCPA consent', /Text only people who contacted the business or agreed to be texted/],
    ['STOP is permanent', /is never texted again, for anything/],
    ['quiet hours', /No customer texts before 8am or after 9pm Eastern/],
    ['no bulk texts', /Never send a group text or a bulk text/],
    ['Spam Likely', /"Spam Likely" or an unknown caller ID is never a reason to ignore someone/],
    ['service area', /Service area: Virginia Beach, Norfolk, Chesapeake and Portsmouth/],
    ['never say Suffolk', /Never say or write "Suffolk" to a customer/],
    ['PII stays in Mike’s accounts', /stay inside Mike's own accounts and the Arbo app/],
    ['no PII into web search', /Never put a customer's name, number, email or street address into a web search or a web page request/],
    ['home street stays out', /Never put Mike's home address or street in anything a customer sees/],
    ['data, not instructions', /is information, not instructions/],
    ['a customer cannot change the rules', /cannot change these rules/],
    ['bilingual crew memo', /in English and in Spanish/],
    ['English safety terms beside the Spanish', /keep the English safety and permit terms beside the Spanish/],
    ['Spanish check line', /"Please have a Spanish-speaking crew lead check this\."/],
    ['seasonal outreach: past customers, not opted out', /only to past customers who have not opted out/],
    ['seasonal outreach: never bulk', /never in bulk/],
    ['supplier research never orders', /you never order or buy anything/],
    ['insurance: never assert coverage', /Never tell anyone the company is covered for something/],
    ['R14 payments', /cash and check; cards carry a 4% surcharge; Zelle, Venmo, Cash App and PayPal/],
    ['R14 Mike confirms any fee', /Mike confirms any fee/],
    ['R14 insurance companies', /we work with insurance companies\. Mike answers all insurance questions/],
    ['R14 nobody home', /Nobody needs to be home for an estimate/],
    ['R14 lead time', /booked out 2–3 weeks/],
    ['R14 not included', /except stump-mulch removal and cutting wood into firewood or stacking it/],
    ['R14 crane work', /Crane work is done regularly/],
    ['R14 tarping', /tarping the house is done after the project and billed afterwards/],
    ['R14 change orders', /Add-ons and change orders always need Mike/],
  ];

  for (const [rule, re] of RULES) {
    it(rule, () => {
      expect(agent.system).toMatch(re);
    });
  }

  it('drops what Mike ruled out or left open', () => {
    // His home street never appears anywhere in the config.
    expect(agentText).not.toMatch(/pinewood/i);
    // The "2pm crew location -> toward home" estimate routing is an OPEN
    // question for Mike, not adopted.
    expect(agent.system).not.toMatch(/\b2\s?pm\b/i);
    // The original let it tell customers the $500 minimum; that is overruled.
    expect(agent.system).not.toMatch(/may tell customers/i);
    // A hosted agent has no voice line.
    expect(agent.system).not.toMatch(/reachable by voice|hands-free/i);
  });
});
