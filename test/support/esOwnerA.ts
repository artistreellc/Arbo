// R27 Phase A (es-owner-a) — the safety-class lines this unit put in the dictionaries for the first time
// (Today, Leads, Calls & texts, Calendar, the shell and the map). Each is a ledger DRAFT in
// src/i18n/reviewed.json: a first translation pass only, no blind second translation and no blind
// back-translation, so each is held back at serve time and the English shows, marked, until both are
// recorded (D112's rule). The ledger test pins the committed drafts against this list; HELD, used on Today's
// Before you roll, is D112's own draft and is not repeated here.
export const OWNER_A_DRAFTS: readonly string[] = [
  'EMERGENCY',
  'POWER LINES',
  'DOWN',
  'STOP honored',
];

// ── What this unit covers in index.html: its top-level declarations, by name, and its few top-level
// statements, by how they start. Two other builders wrap the rest of the same page in parallel. ──
export const OWNER_A_SCOPE: readonly string[] = [
  // the shell's shared lines: the toasts, the read and save failures, the feeds card, chips, dates, stops
  'KEY_REFUSED', 'READ_ONLY_LINE', 'readOnlyToast', 'api', 'state', 'readingLine', 'feedKind', 'FEED_WORD', 'FEED_TAG', 'FEED_SAYS', 'RETRY',
  'feedSays', 'feedLine', 'feedState', 'saveFailText', 'saveFailMark', 'showSaveFail', 'FEEDS_SAID', 'feedsCard', 'chip', 'plural',
  'fmtWhen', 'fmtTime', 'mapsLink', 'stopAddress', 'routeLeftOut', 'navigateBtn', 'badge', 'PERMIT_STATE', 'permitChip', 'permitBadge',
  // Today's panels (several shared with Calls & texts)
  'stormBanner', 'locationStrip', 'inboxIntentPanel', 'PHOTO_FAILED', 'MEDIA_WORD', 'mediaLine', 'photoStrip', 'photoThumb', 'photoWhenNear',
  'photoLoad', 'openPhoto', 'photoViewFailed', 'photoLetGo', 'STUDY_STAGE', 'studyPanel', 'quoOffLine', 'fillQuoSlots', 'slipRuleLabel',
  'openSonaCall', 'sonaHandled', 'sonaCalledBack', 'sonaSlipBox', 'sonaNeedsYou', 'sonaFlagGap', 'sonaPanel', 'outreachPanel',
  'websiteFormsPanel', 'receptionStrip', 'leadsTabBadge', 'sonaTabBadge', 'openLead', 'emergencyLeads', 'emergencyLeadCard', 'stormLawFlag',
  'ROLL_ROWS', 'beforeYouRoll', 'DESK_VIEW', 'openPanel', 'goTile', 'renderToday', 'LOOP_LABEL', 'loopCard',
  // Leads and Calls & texts
  'LEADS_FILTERS', 'renderLeadsHead', 'leadsHeadOn', 'leadsFilter', 'CONTACT_LINE', 'clampLine', 'renderLeads', 'renderCalls',
  // Calendar: Today's stops, the maps sheet, the route planner, the calendar, the map's frame
  'clock12', 'mapsDirUrl', 'mapsLinks', 'openMapsStop', 'openMapsDay', 'todayStopRow', 'todayStopsHead', 'PLAN_LINE_CLASS', 'renderTodayStops',
  'routePlannerPanel', 'gcalEmbedUrl', 'renderCalendar', 'MAP_HOME', 'MAP_LAYER_OF', 'mapPost', 'mapAim', 'openMap', 'renderMap', 'refreshMap',
  'mapTick', 'mapMessage', 'mapDay',
  // the key screen
  'showKeywall', 'keywallChrome', 'hideKeywall', 'unlockWithKey',
  // the hero, the systems strip, the header, the dock, Back, the sheets, Talk, the boot
  'svgEl', 'icon', 'RINGS', 'dayRing', 'dayFraction', 'buildHero', 'SYS_LABELS', 'buildSystems', 'sysSet', 'heroLoops', 'netState', 'shellWords',
  'VIEW_TITLES', 'VIEW_ALIAS', 'DOCK_OF', 'APPSUB_DATE', 'setAppSub', 'fitTitle', 'switchTab',
  'TALK_AUDIO_SESSION', 'TALK', 'TALK_END_LINE', 'talkVoice', 'talkSupport', 'talkEndPhrase', 'talkSpeech', 'talkSentences', 'talkUtterance', 'talkStatus',
  'talkButton', 'talkLater', 'talkStart', 'talkAsk', 'talkFailLine', 'talkShowReply', 'talkSay', 'talkNext', 'talkListen', 'talkAfterListen',
  'talkCantListen', 'talkHeard', 'talkTrim', 'talkEnd',
  'NAV_PARENT', 'SHEETS', 'navPush', 'navShowBack', 'NAV_DRAW', 'startView', 'navShow', 'navBack', 'sheetOpened', 'closeSheet',
  'refreshAll', 'holdsTyping', 'autoRefresh',
];
export const OWNER_A_STATEMENTS: readonly string[] = [
  "$('talk-open')", "$('talk-form')", "window.addEventListener('popstate'", "$('photo-img')", 'if (STANDALONE)', "$('refresh')",
  "$('dateline')", "window.addEventListener('scroll'", "if ('serviceWorker'", 'shellWords(',
];
/** The units this builder owns: one per place on the page (ES_PLACES), the shell's shared lines, and the map page's own door. */
export const OWNER_A_UNITS = ['app-key', 'app-shell', 'app-sheets', 'app-today', 'app-leads', 'app-calendar', 'app-map'] as const;
