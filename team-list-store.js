// Firebase connection + the shared event documents, used by index.html,
// schedule.html and settings.html. The 'pit-reports' collection isn't
// here; index.html and schedule.html read it directly via the exported
// db/fb.
//
// ---------- Document layout ----------
// The app holds several events at once. Configuration and data are
// split across two kinds of doc:
//
//   settings/event-index      { activeEventId, tbaKey, events: { <id>: {...} } }
//   settings/event--<id>      { teams, doNotPick, picked, order, epa, qualRank }
//
// Config lives in the index because settings.html's event picker and
// schedule.html only need config — a single doc carrying every event's
// roster and stat caches would ship all of it on every snapshot.
// Rosters live one doc per event so switching events doesn't overwrite
// the previous event's pick list, do-not-pick marks or custom order.
//
// settings/team-list is the pre-multi-event layout. It is migrated into
// event id "legacy" on first load (see ensureEventIndex) and then left
// alone, so rolling back is possible.
//
// Setup: create a Firebase project, register a web app, paste its config
// below, create a Firestore database. Rules (open to anyone with the
// link — don't put sensitive data in it):
//   rules_version = '2';
//   service cloud.firestore {
//     match /databases/{database}/documents {
//       match /pit-reports/{report} { allow read, write: if true; }
//       match /settings/{doc}       { allow read, write: if true; }
//     }
//   }
export const firebaseConfig = {
  apiKey: "AIzaSyDd-bxsDiripyT3nhuhq0YXYmlH-mEpjUs",
  authDomain: "pit-scouting-6996.firebaseapp.com",
  projectId: "pit-scouting-6996",
  storageBucket: "pit-scouting-6996.firebasestorage.app",
  messagingSenderId: "213708242808",
  appId: "1:213708242808:web:a79ad6ab4b9af46085928d"
};

// False until real keys are pasted in above; drives each page's
// "Firebase not configured yet" banner.
export const isConfigured = firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("YOUR_");

// db = Firestore handle. fb = the firebase-firestore module, so callers
// can use fb.doc(...) etc. without re-importing. Null when unconfigured.
export let db = null, fb = null;
if (isConfigured) {
  const [{ initializeApp }, firestore] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js")
  ]);
  fb = firestore;
  const app = initializeApp(firebaseConfig);

  // Not getFirestore(app): Firestore's realtime "Listen" connection
  // normally streams over fetch(), and Safari/WebKit has a long-standing
  // bug handling that streaming mode — it surfaces as "Fetch API cannot
  // load .../Listen/channel... due to access control checks", which looks
  // like a CORS misconfiguration but isn't one (nothing server-side is
  // wrong, and the same project works fine from Chrome/Firefox). Because
  // that connection never opens, this device's first snapshot never
  // arrives, and every page here waits for a first snapshot before it
  // draws anything — so the result is a page that's permanently stuck
  // blank on affected browsers, not a transient glitch a reload fixes.
  // autoDetectLongPolling switches to plain long-polling only on browsers
  // that need it, so this doesn't cost anything on browsers where
  // streaming already works fine.
  db = firestore.initializeFirestore(app, { experimentalAutoDetectLongPolling: true });

  // Tried enabling on-disk (IndexedDB) persistence here — cache-first
  // reads across page navigations, and a write queue that survives the
  // tab closing while offline. Pulled it back out: Safari/WebKit (so every
  // browser on iPhone/iPad, not just Safari itself) has long-standing bugs
  // where that handshake can hang indefinitely, and this app lives on
  // phones at competitions — exactly where that bug bites. It was causing
  // blank pages on navigation there.
  //
  // What's still true without it: a write made while offline is queued in
  // memory and sent automatically once the connection returns, as long as
  // the tab stays open (see saveScoutForm in index.html) — it just isn't
  // durable across a tab close/reload while still offline. Reads still get
  // an honest fromCache/hasPendingWrites via syncMeta() below, so the
  // Offline/Syncing badge works the same either way.

  // Firestore keeps a long-lived streaming connection open to sync in
  // real time. This is a page-per-navigation app, so every link click
  // abandons that connection mid-flight rather than closing it — and on
  // Safari specifically, an abandoned connection to the same host can wedge
  // the *next* page's connection to that same host, which is what a stuck,
  // unrecoverable-by-reload blank page on navigation looks like. `pagehide`
  // fires right as a navigation begins (reliably on iOS Safari too, unlike
  // `beforeunload`) — terminating here gives Firestore a chance to close
  // its connection cleanly before the browser starts the next one.
  window.addEventListener('pagehide', function(){
    firestore.terminate(db).catch(()=>{});
  });
}

// Turns an onSnapshot's `snapshot.metadata` into the two facts every
// page's sync badge needs. fromCache: this data may not be current — either
// never confirmed with the server, or the connection has since dropped.
// hasPendingWrites: a save made here hasn't been confirmed by the server
// yet (queued, whether offline or just still in flight).
export function syncMeta(snapshot){
  return { fromCache: snapshot.metadata.fromCache, hasPendingWrites: snapshot.metadata.hasPendingWrites };
}

// Combines sync status from more than one listener on a page (e.g. the
// event index and the roster doc) into one badge's worth of state — offline
// or pending if *any* source is.
export function mergeSyncMeta(a, b){
  return {
    fromCache: !!(a && a.fromCache) || !!(b && b.fromCache),
    hasPendingWrites: !!(a && a.hasPendingWrites) || !!(b && b.hasPendingWrites)
  };
}

// Small badge for the topbar, next to the event name. Silent when
// everything's live and confirmed — it should only speak up when what's
// on screen might not be current.
export function syncBadgeHtml(sync){
  if(!sync) return '';
  if(sync.hasPendingWrites) return `<span class="sync-badge pending" title="Saved here, not yet confirmed by the server">Syncing…</span>`;
  if(sync.fromCache) return `<span class="sync-badge offline" title="Not connected — showing the last data synced to this device">Offline</span>`;
  return '';
}

// HTML-escapes text for template strings. Wrap all user-entered text.
export function esc(s){
  return String(s===undefined||s===null?"":s)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// localStorage wrappers. It throws in private browsing / disabled
// storage, so callers get the fallback instead of an exception.
export function readLocal(key, fallback){
  try{ const v = localStorage.getItem(key); return v===null ? fallback : v; }catch(e){ return fallback; }
}
export function writeLocal(key, val){
  try{ localStorage.setItem(key, val); }catch(e){ /* ignore */ }
}

// Default country for the bulk EPA lookup — one Statbotics request
// covers every team in it, versus one request per team. Stored per
// event as `epaCountry` and editable in settings.html; this is only the
// fallback when an event has no value yet.
export const DEFAULT_EPA_COUNTRY = "Australia";

// The season EPA is read for. One place, since all three pages ask for
// the same year.
export const EPA_YEAR = 2026;

// Teams rendered in the highlight color rather than accent yellow —
// see .team-cell.highlight-team in style.css.
export const HIGHLIGHT_TEAMS = ["6996","9976"];

export function isHighlightTeam(team){
  return HIGHLIGHT_TEAMS.includes(String(team||"").trim());
}

// Adds highlight-team to `base` for a highlighted team. `base` may be
// "" for a non-team column in a shared cols-array loop.
export function teamCellClass(base, team){
  return isHighlightTeam(team) ? (base ? base + " highlight-team" : "highlight-team") : base;
}

// ====================== EVENT MODEL ======================

// One configured event. `offseason` marks an event Statbotics never
// indexes, which changes how EPA and quals rank are fetched — see
// fetchEventStats.
export function blankEvent(){
  return { code: "", label: "", epaCountry: DEFAULT_EPA_COUNTRY, offseason: false, createdAt: new Date().toISOString() };
}

export function normalizeEvent(raw){
  const e = raw || {};
  return {
    code: e.code || "",
    label: e.label || "",
    epaCountry: e.epaCountry === undefined ? DEFAULT_EPA_COUNTRY : e.epaCountry,
    offseason: !!e.offseason,
    createdAt: e.createdAt || ""
  };
}

// A label for menus and the topbar: the name if there is one, else the
// event code, else a placeholder so a half-configured event is still
// selectable.
export function eventTitle(ev){
  if(!ev) return "";
  return (ev.label || "").trim() || (ev.code || "").trim() || "Untitled event";
}

// Ids are generated, not derived from the event code, so renaming a
// code doesn't orphan the event's roster doc.
export function newEventId(){
  return 'ev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
}

export function eventDataDocId(eventId){
  return 'event--' + eventId;
}

// A value activeEventId can take instead of a real event id: show every
// team that has scouting data, from any event, rather than one event's
// roster. Selectable in settings.html's event picker alongside the real
// events, since it is the same kind of choice — what the app is showing.
// It is never a key in `events` and has no roster doc of its own.
export const ALL_TEAMS_EVENT_ID = '__all__';
export const ALL_TEAMS_LABEL = 'All scouted teams';

export function isAllTeamsEvent(id){
  return id === ALL_TEAMS_EVENT_ID;
}

// Fills in the shape callers expect from a possibly-empty index doc,
// and repairs an activeEventId pointing at a deleted event by falling
// back to the first one configured.
export function normalizeIndex(d){
  const raw = (d && d.events) || {};
  const events = {};
  Object.keys(raw).forEach(id => { events[id] = normalizeEvent(raw[id]); });
  let activeEventId = (d && d.activeEventId) || "";
  if(activeEventId && !events[activeEventId] && !isAllTeamsEvent(activeEventId)) activeEventId = "";
  if(!activeEventId){
    const ids = Object.keys(events);
    activeEventId = ids.length ? ids[0] : "";
  }
  return { activeEventId, events, tbaKey: (d && d.tbaKey) || "" };
}

// The active event's config, or a blank one when nothing is set up yet
// — and for ALL_TEAMS_EVENT_ID, which has no config — so callers can
// read .code/.offseason without null checks. A blank code means no
// roster, schedule or stats to fetch, which is exactly right there.
export function activeEventOf(index){
  if(!index || !index.activeEventId) return normalizeEvent(null);
  return index.events[index.activeEventId] || normalizeEvent(null);
}

// What to call the active selection in a topbar or menu, including the
// all-teams pseudo-event, which has no config to take a name from.
// Empty when nothing is active — including before the first snapshot
// arrives, so a page can show "Loading…" there instead of the
// "Untitled event" placeholder eventTitle() gives a blank event.
export function activeEventTitle(index){
  if(index && isAllTeamsEvent(index.activeEventId)) return ALL_TEAMS_LABEL;
  if(!index || !index.activeEventId) return "";
  return eventTitle(activeEventOf(index));
}

// The TBA Read API key. It lives on the shared index doc so a scout's
// phone that has never typed one still gets offseason schedules and
// rankings; a key saved on this device before that field existed is the
// fallback. TBA read keys are free and read-only, which is why sharing
// one through a world-readable doc is an acceptable trade here.
export function resolveTbaKey(index){
  const shared = ((index && index.tbaKey) || "").trim();
  return shared || readLocal('pitscout_tba_key', '').trim();
}

// ====================== EVENT INDEX SYNC ======================

// One-time migration from the single 'settings/team-list' doc. Every id
// and field written here is deterministic — the legacy event is always
// id "legacy" — so several pages racing to run it converge on the same
// documents instead of creating duplicates.
let ensureIndexPromise = null;
function ensureEventIndex(){
  if(ensureIndexPromise) return ensureIndexPromise;
  ensureIndexPromise = (async ()=>{
    if(!isConfigured) return;
    const indexRef = fb.doc(db, 'settings', 'event-index');
    const indexSnap = await fb.getDoc(indexRef);
    if(indexSnap.exists()) return;

    const legacySnap = await fb.getDoc(fb.doc(db, 'settings', 'team-list'));
    const legacy = legacySnap.exists() ? legacySnap.data() : null;
    const hasLegacy = !!(legacy && ((legacy.teams && legacy.teams.length) || legacy.eventCode || legacy.eventLabel));

    if(hasLegacy){
      await fb.setDoc(fb.doc(db, 'settings', eventDataDocId('legacy')), {
        teams: legacy.teams || [],
        doNotPick: legacy.doNotPick || {},
        picked: legacy.picked || {},
        order: legacy.order || [],
        epa: legacy.epa || {},
        qualRank: legacy.qualRank || {},
        updatedAt: new Date().toISOString()
      });
      await fb.setDoc(indexRef, {
        activeEventId: 'legacy',
        tbaKey: readLocal('pitscout_tba_key', ''),
        events: {
          legacy: {
            code: legacy.eventCode || "",
            label: legacy.eventLabel || "",
            epaCountry: legacy.epaCountry === undefined ? DEFAULT_EPA_COUNTRY : legacy.epaCountry,
            offseason: false,
            createdAt: legacy.updatedAt || new Date().toISOString()
          }
        },
        updatedAt: new Date().toISOString()
      });
    }else{
      await fb.setDoc(indexRef, { activeEventId: "", tbaKey: "", events: {}, updatedAt: new Date().toISOString() });
    }
  })().catch(e => {
    console.warn('Could not create the event index', e);
  });
  return ensureIndexPromise;
}

// Subscribes to the event index. onData receives a normalized index and a
// syncMeta() on every snapshot (including a cache-only one while offline),
// and once with an empty index when unconfigured. Returns an unsubscribe
// function.
export function subscribeEventIndexStore(onData, onError){
  if(!isConfigured){ onData(normalizeIndex(null), { fromCache: false, hasPendingWrites: false }); return ()=>{}; }
  let unsub = null, cancelled = false;
  ensureEventIndex().then(()=>{
    if(cancelled) return;
    unsub = fb.onSnapshot(fb.doc(db, 'settings', 'event-index'), { includeMetadataChanges: true }, (snap)=>{
      onData(normalizeIndex(snap.exists() ? snap.data() : null), syncMeta(snap));
    }, (err)=>{ if(onError) onError(err); });
  });
  return ()=>{ cancelled = true; if(unsub) unsub(); };
}

// Writes a partial update to the index, e.g. {activeEventId}. Use
// saveEventConfig for a single event's fields — it writes a dotted path
// so it can't clobber a sibling event.
export async function saveEventIndexStore(patch, onError){
  if(!isConfigured) return;
  try{
    const ref = fb.doc(db, 'settings', 'event-index');
    const data = Object.assign({ updatedAt: new Date().toISOString() }, patch);
    await fb.setDoc(ref, data, { mergeFields: Object.keys(data) });
  }catch(e){
    if(onError) onError(e);
  }
}

// One event's config, merged into the events map rather than replacing
// it. Pass fields to change, e.g. {offseason: true}.
//
// FieldPath rather than a dotted "events.<id>.code" string: generated
// event ids contain hyphens, which the dotted-string syntax can't
// express. The index doc always exists by the time anything calls this
// (ensureEventIndex creates it), so updateDoc is safe.
export async function saveEventConfig(eventId, fields, onError){
  if(!isConfigured || !eventId) return;
  try{
    const ref = fb.doc(db, 'settings', 'event-index');
    const args = [];
    Object.keys(fields).forEach(k => { args.push(new fb.FieldPath('events', eventId, k), fields[k]); });
    args.push(new fb.FieldPath('updatedAt'), new Date().toISOString());
    await fb.updateDoc(ref, ...args);
  }catch(e){
    if(onError) onError(e);
  }
}

// Adds a new event and returns its id. Written as a whole map entry, so
// it can't collide with an edit to a sibling event.
export async function createEventStore(config, onError){
  const id = newEventId();
  if(!isConfigured) return id;
  try{
    const ref = fb.doc(db, 'settings', 'event-index');
    await fb.updateDoc(ref,
      new fb.FieldPath('events', id), Object.assign(blankEvent(), config || {}),
      new fb.FieldPath('updatedAt'), new Date().toISOString());
  }catch(e){
    if(onError) onError(e);
  }
  return id;
}

// Removes an event's config entry and its roster doc. deleteField keeps
// the sibling events untouched.
export async function deleteEventStore(eventId, onError){
  if(!isConfigured || !eventId) return;
  try{
    const ref = fb.doc(db, 'settings', 'event-index');
    await fb.updateDoc(ref,
      new fb.FieldPath('events', eventId), fb.deleteField(),
      new fb.FieldPath('updatedAt'), new Date().toISOString());
    await fb.deleteDoc(fb.doc(db, 'settings', eventDataDocId(eventId)));
  }catch(e){
    if(onError) onError(e);
  }
}

// ====================== EVENT DATA SYNC ======================

// Subscribes to one event's roster doc. onData fires per snapshot (plus a
// syncMeta()), with `{}` when unconfigured, when no event is selected, or
// when the doc doesn't exist yet — all three mean "empty list". Returns an
// unsubscribe function, since callers re-subscribe when the active
// event changes.
export function subscribeEventDataStore(eventId, onData, onError){
  if(!isConfigured || !eventId){ onData({}, { fromCache: false, hasPendingWrites: false }); return ()=>{}; }
  return fb.onSnapshot(fb.doc(db, 'settings', eventDataDocId(eventId)), { includeMetadataChanges: true }, (snap)=>{
    onData(snap.exists() ? snap.data() : {}, syncMeta(snap));
  }, (err)=>{ if(onError) onError(err); });
}

// Writes a partial update to one event's roster doc, e.g. {order: [...]}.
// mergeFields replaces each patched top-level field outright; {merge:
// true} would deep-merge maps, so removing a key from doNotPick/picked
// would never delete it server-side. Caller state is untouched — the
// subscription picks up whatever actually landed.
export async function saveEventDataStore(eventId, patch, onError){
  if(!isConfigured || !eventId) return;
  try{
    const ref = fb.doc(db, 'settings', eventDataDocId(eventId));
    const data = Object.assign({ updatedAt: new Date().toISOString() }, patch);
    await fb.setDoc(ref, data, { mergeFields: Object.keys(data) });
  }catch(e){
    if(onError) onError(e);
  }
}

// ====================== EPA + QUALS RANK ======================

// Both numbers for a whole event in as few requests as possible, and
// the single place that knows which source can answer. All three pages
// call this; index.html is the only one that persists the result.
//
// In-season event:
//   team_events?event=   EPA *and* quals rank in one request, covering
//                        visiting teams from overseas too.
//
// Offseason event (or an event code Statbotics doesn't know):
//   team_years?country=  EPA only. Sourced from team_year rather than
//                        team_event on purpose: EPA is one continuous
//                        rating reported as of a team's most recent
//                        event, so a team that played champs shows its
//                        current strength — up to ~40 points above its
//                        snapshot from an old event, which is the number
//                        worth ranking on at an offseason event.
//   /event/{code}/rankings (TBA)  Quals rank, which Statbotics has no
//                        record of at all for these events. Needs a
//                        Read API key, saved once in settings.html.
//
// The TBA rankings call also runs at an in-season event whose Statbotics
// entry has no ranks yet — the first hour of quals, before ingest.
//
// Never throws: a source that fails is left out of the result and named
// in `errors`, so a partial answer still paints.
export async function fetchEventStats(ev, tbaKey){
  const event = normalizeEvent(ev);
  const code = event.code.trim();
  const country = event.epaCountry.trim();
  const key = (tbaKey || "").trim();
  const out = { epa: {}, qualRank: {}, epaSource: null, rankSource: null, errors: [] };

  // Skipped entirely for an offseason event: Statbotics has no such
  // event, so this is a guaranteed 404.
  let rows = [];
  if(code && !event.offseason){
    try{
      const res = await fetch(`https://api.statbotics.io/v3/team_events?event=${encodeURIComponent(code)}&limit=1000`);
      const data = res.ok ? await res.json() : [];
      rows = Array.isArray(data) ? data : [];
    }catch(e){ out.errors.push('statbotics-event'); }
  }

  if(rows.length){
    out.epaSource = 'statbotics-event';
    rows.forEach(row => {
      const team = String(row.team);
      // No percentile on team_event — only team_year ranks a team
      // against the whole field. Callers just omit it.
      out.epa[team] = { epa: row.epa ? row.epa.total_points : null, percentile: null };
      const rank = row.record && row.record.qual ? row.record.qual.rank : null;
      if(rank != null) out.qualRank[team] = { rank, eventCode: code };
    });
    if(Object.keys(out.qualRank).length) out.rankSource = 'statbotics';
  }else if(country){
    try{
      const res = await fetch(`https://api.statbotics.io/v3/team_years?year=${EPA_YEAR}&country=${encodeURIComponent(country)}&limit=1000`);
      if(res.ok){
        out.epaSource = 'statbotics-country';
        const data = await res.json();
        (Array.isArray(data) ? data : []).forEach(row => {
          const team = String(row.team);
          out.epa[team] = {
            epa: row.epa ? row.epa.total_points : null,
            percentile: row.epa && row.epa.ranks ? row.epa.ranks.total.percentile : null
          };
        });
      }else{
        out.errors.push('statbotics-country');
      }
    }catch(e){ out.errors.push('statbotics-country'); }
  }

  if(!Object.keys(out.qualRank).length && code && key){
    try{
      const res = await fetch(`https://www.thebluealliance.com/api/v3/event/${encodeURIComponent(code)}/rankings`, {
        headers: { 'X-TBA-Auth-Key': key }
      });
      if(res.ok){
        const data = await res.json();
        const rankings = data && Array.isArray(data.rankings) ? data.rankings : [];
        rankings.forEach(r => {
          // TBA team keys are "frc254".
          const team = String(r.team_key || "").replace(/^frc/, '');
          if(team && r.rank != null) out.qualRank[team] = { rank: r.rank, eventCode: code };
        });
        if(Object.keys(out.qualRank).length) out.rankSource = 'tba';
      }else if(res.status !== 404){
        out.errors.push('tba-rankings');
      }
    }catch(e){ out.errors.push('tba-rankings'); }
  }

  return out;
}

// ====================== EVENT ROSTER LOOKUP ======================

// The team list for an event, from whichever source can answer.
// settings.html's "Load teams" button. Throws with a message meant to
// be shown to the user.
export async function fetchEventRoster(ev, tbaKey, preferred){
  const event = normalizeEvent(ev);
  const code = event.code.trim();
  const key = (tbaKey || "").trim();
  if(!code) throw new Error("Enter an event code first.");

  // An offseason event is only ever on TBA, so don't make the user pick.
  const source = preferred || (event.offseason ? 'tba' : 'statbotics');

  if(source === 'statbotics'){
    const res = await fetch(`https://api.statbotics.io/v3/team_events?event=${encodeURIComponent(code)}`);
    if(!res.ok) throw new Error("Statbotics doesn't have that event. If it's an offseason event, tick “Offseason event” above and add a TBA key.");
    const data = await res.json();
    if(!Array.isArray(data) || !data.length) throw new Error("No teams found for that event on Statbotics — tick “Offseason event” to load it from The Blue Alliance instead.");
    return data.map(d => ({ team: String(d.team), teamName: d.team_name || "" }))
      .sort((a,b)=> Number(a.team) - Number(b.team));
  }

  if(!key) throw new Error("Add your TBA Read API key above first (get one free at thebluealliance.com/account).");
  const res = await fetch(`https://www.thebluealliance.com/api/v3/event/${encodeURIComponent(code)}/teams/simple`, {
    headers: { 'X-TBA-Auth-Key': key }
  });
  if(res.status === 401) throw new Error("Invalid TBA API key.");
  if(!res.ok) throw new Error("Event not found on TBA — check the event code.");
  const data = await res.json();
  if(!Array.isArray(data) || !data.length) throw new Error("No teams found for that event on TBA.");
  return data.map(d => ({ team: String(d.team_number), teamName: d.nickname || "" }))
    .sort((a,b)=> Number(a.team) - Number(b.team));
}
