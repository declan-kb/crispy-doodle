// Firebase connection + the 'settings/team-list' doc, shared by
// index.html and settings.html. The 'pit-reports' collection isn't here;
// index.html handles it directly via the exported db/fb.
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
  const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js");
  const firestore = await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js");
  fb = firestore;
  const app = initializeApp(firebaseConfig);
  db = firestore.getFirestore(app);
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

// Default country for index.html's bulk EPA prefetch — one Statbotics
// request covers every team in it, versus one request per team. Stored
// on the team-list doc as `epaCountry` and editable in settings.html;
// this is only the fallback when the doc has no value yet.
export const DEFAULT_EPA_COUNTRY = "Australia";

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

// Subscribes to the team-list doc. onData fires per snapshot, with `{}`
// when unconfigured or the doc doesn't exist yet — both mean "empty
// list". onError fires if the listener itself fails.
export function subscribeTeamListStore(onData, onError){
  if(!isConfigured){ onData({}); return; }
  const ref = fb.doc(db, 'settings', 'team-list');
  fb.onSnapshot(ref, (snap)=>{
    onData(snap.exists() ? snap.data() : {});
  }, (err)=>{ if(onError) onError(err); });
}

// Writes a partial update, e.g. {order: [...]}. mergeFields replaces
// each patched top-level field outright; {merge: true} would deep-merge
// maps, so removing a key from doNotPick/picked would never delete it
// server-side. Caller state is untouched — the subscription above picks
// up whatever actually landed.
export async function saveTeamListStore(patch, onError){
  if(!isConfigured) return;
  try{
    const ref = fb.doc(db, 'settings', 'team-list');
    const data = Object.assign({ updatedAt: new Date().toISOString() }, patch);
    await fb.setDoc(ref, data, { mergeFields: Object.keys(data) });
  }catch(e){
    if(onError) onError(e);
  }
}
