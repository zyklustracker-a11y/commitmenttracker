"use strict";
/* ---------------------------------------------------------------------------
   Datenschicht: hält das In-Memory-Modell `data` (identisch zum bisherigen
   localStorage-Format) und spiegelt es auf Firestore.

   Struktur in Firestore:
     users/{uid}                    → { settings, migratedFromLocal }
     users/{uid}/habits/{habitId}   → ein Dokument pro Commitment,
                                      completions als Map "YYYY-MM-DD" → "done"|"joker"

   `createdAt` ist der Anlagetag und bleibt unveraendert. `startDate` ist der
   offizielle Beginn — er darf beim Anlegen und spaeter frei gewaehlt werden.
   Alles, was zaehlt (Heatmap, Quote, Verlauf, Joker), richtet sich nach
   startDate; aeltere Dokumente ohne das Feld erben den Anlagetag.

   Streaks, Rekorde und Quoten werden nie gespeichert, sondern immer aus
   completions berechnet (siehe app.js).
--------------------------------------------------------------------------- */
import { db } from "./firebase.js";
import {
  doc, collection, onSnapshot, setDoc, deleteDoc, writeBatch
} from "./vendor/firebase-firestore.js";
import { today, addDays } from "./dates.js";

export const KEY = "ct_data_v2";
export const V1_KEY = "habits";
export const COLORS = ["--terra","--green","--ochre","--plum","--slate"];

export function defaultSettings(){
  return { reminderTime:"21:00", notify:false, jokersPerMonth:1, openFirst:true, lastNotified:null };
}

/* Ein einziges, stabil referenziertes Objekt — app.js importiert es und liest
   immer den aktuellen Stand. */
export const data = { version:2, settings: defaultSettings(), habits: [] };

let uid = null;
let unsubs = [];
let migratedFlag = false;
let onWriteError = () => {};

export function setWriteErrorHandler(fn){ onWriteError = fn; }

/* ---------- Pfade ---------- */
const userDoc  = u => doc(db, "users", u);
const habitsCol = u => collection(db, "users", u, "habits");
const habitDoc = (u,id) => doc(db, "users", u, "habits", String(id));

/* ---------- Serialisierung ---------- */
export function serializeHabit(h){
  return {
    id: Number(h.id),
    name: String(h.name || ""),
    type: h.type === "avoid" ? "avoid" : "do",
    targetDays: h.targetDays == null ? null : Number(h.targetDays),
    createdAt: h.createdAt || today(),
    startDate: h.startDate || h.createdAt || today(),
    archived: !!h.archived,
    archivedAt: h.archivedAt || null,
    sortOrder: Number(h.sortOrder || 0),
    color: COLORS.includes(h.color) ? h.color : COLORS[0],
    jokersPerMonth: h.jokersPerMonth == null ? 1 : Number(h.jokersPerMonth),
    completions: { ...(h.completions || {}) },
    legacyLongest: Number(h.legacyLongest || 0)
  };
}
function deserializeHabit(snapDoc){
  const raw = snapDoc.data() || {};
  const h = serializeHabit(raw);
  /* Die Dokument-ID ist die Wahrheit — sie wird beim Löschen/Schreiben benutzt. */
  const fromId = Number(snapDoc.id);
  if(Number.isFinite(fromId)) h.id = fromId;
  return h;
}

export function newHabit(name, target, type, jokers, start){
  return { id: Date.now()+Math.floor(Math.random()*1000), name, type: type || "do",
    targetDays: target, createdAt: today(), startDate: start || today(),
    archived:false, archivedAt:null,
    sortOrder: data.habits.length,
    color: COLORS[data.habits.length % COLORS.length],
    jokersPerMonth: (jokers == null ? 1 : jokers),
    completions:{}, legacyLongest:0 };
}

function normalize(){
  const fallback = data.settings && data.settings.jokersPerMonth != null ? data.settings.jokersPerMonth : 1;
  data.habits.forEach(h => { if(h.jokersPerMonth == null) h.jokersPerMonth = fallback; });
}

/* ---------- Schreiben ----------
   Bewusst ohne await: mit persistenter Offline-Kopie landet ein Schreibvorgang
   sofort lokal, das Promise löst erst auf, wenn der Server bestätigt hat.
   Offline bleibt es einfach pending — das ist der gewünschte Zustand. */
function track(p){ if(p && p.catch) p.catch(err => onWriteError(err)); return p; }

export function saveSettings(){
  if(!uid) return;
  return track(setDoc(userDoc(uid), { settings: { ...data.settings } }, { merge:true }));
}
export function saveHabit(h){
  if(!uid || !h) return;
  return track(setDoc(habitDoc(uid, h.id), serializeHabit(h)));
}
export function removeHabit(id){
  if(!uid) return;
  return track(deleteDoc(habitDoc(uid, id)));
}

/* ---------- Live-Sync ---------- */
export function stopSync(){
  unsubs.forEach(u => { try{ u(); }catch(e){} });
  unsubs = [];
  uid = null;
  migratedFlag = false;
  data.settings = defaultSettings();
  data.habits = [];
}

export function startSync(_uid, onChange, onMigrated){
  stopSync();
  uid = _uid;
  let serverUser = false, serverHabits = false, migrationChecked = false;

  const maybeMigrate = () => {
    if(migrationChecked || !serverUser || !serverHabits) return;
    migrationChecked = true;
    migrateLocalIfNeeded(onMigrated).catch(err => console.warn("Migration:", err));
  };

  unsubs.push(onSnapshot(userDoc(uid), { includeMetadataChanges:true }, snap => {
    if(!snap.metadata.fromCache) serverUser = true;
    const d = snap.data();
    if(d && d.settings) data.settings = { ...defaultSettings(), ...d.settings };
    migratedFlag = !!(d && d.migratedFromLocal);
    /* Erstanlage des Nutzerdokuments — nur wenn der Server bestätigt hat,
       dass es wirklich fehlt. */
    if(!snap.exists() && !snap.metadata.fromCache){
      track(setDoc(userDoc(uid), { settings: { ...data.settings } }, { merge:true }));
    }
    onChange();
    maybeMigrate();
  }, err => { console.warn("Sync (Einstellungen):", err); onWriteError(err); }));

  unsubs.push(onSnapshot(habitsCol(uid), { includeMetadataChanges:true }, snap => {
    if(!snap.metadata.fromCache) serverHabits = true;
    data.habits = snap.docs.map(deserializeHabit).sort((a,b) => a.sortOrder - b.sortOrder);
    normalize();
    onChange();
    maybeMigrate();
  }, err => { console.warn("Sync (Commitments):", err); onWriteError(err); }));
}

/* ---------- Einmalige Migration der Bestandsdaten ---------- */
function blankHabit(name, target, type, jokers, index){
  return { id: Date.now() + index, name, type: type || "do",
    targetDays: target, createdAt: today(), startDate: today(),
    archived:false, archivedAt:null,
    sortOrder: index, color: COLORS[index % COLORS.length],
    jokersPerMonth: (jokers == null ? 1 : jokers),
    completions:{}, legacyLongest:0 };
}

/* Liest ct_data_v2 — und falls das fehlt, das Alt-Format unter `habits` (v1)
   mit derselben Logik wie das frühere migrateV1(). */
export function readLegacy(){
  try{
    const raw = localStorage.getItem(KEY);
    if(raw){
      const d = JSON.parse(raw);
      if(d && Array.isArray(d.habits)){
        const settings = { ...defaultSettings(), ...(d.settings || {}) };
        const fallback = settings.jokersPerMonth == null ? 1 : settings.jokersPerMonth;
        const habits = d.habits.map((h,i) => {
          const s = serializeHabit({ ...h, sortOrder: h.sortOrder == null ? i : h.sortOrder });
          if(h.jokersPerMonth == null) s.jokersPerMonth = fallback;
          return s;
        });
        return { source: KEY, settings, habits };
      }
    }
  }catch(e){}
  try{
    const old = JSON.parse(localStorage.getItem(V1_KEY) || "[]");
    if(Array.isArray(old) && old.length){
      const habits = old.map((o,i) => {
        const h = blankHabit(o.name || "Commitment", o.targetDays >= 99999 ? null : o.targetDays, "do", 1, i);
        h.legacyLongest = o.longestStreak || 0;
        if(o.lastCompleted && o.currentStreak > 0){
          for(let k=0;k<o.currentStreak;k++) h.completions[addDays(o.lastCompleted,-k)] = "done";
          /* Der zurueckgerechnete Streak liegt vor dem Anlagetag — der Beginn
             ist der aelteste Eintrag, sonst blieben diese Tage unsichtbar. */
          const tage = Object.keys(h.completions).sort();
          if(tage[0] < h.startDate) h.startDate = tage[0];
        }
        return serializeHabit(h);
      });
      return { source: V1_KEY, settings: defaultSettings(), habits };
    }
  }catch(e){}
  return null;
}

/* Sicherheitsnetz: die Altdaten werden nicht gelöscht, sondern umbenannt. */
function stashLegacy(sourceKey){
  try{
    const raw = localStorage.getItem(sourceKey);
    if(raw == null) return;
    let target = sourceKey + "_migrated";
    if(localStorage.getItem(target) != null) target += "_" + today();
    localStorage.setItem(target, raw);
    localStorage.removeItem(sourceKey);
  }catch(e){}
}

async function migrateLocalIfNeeded(onMigrated){
  if(!uid || migratedFlag) return;
  /* Firestore hat bereits Daten für diesen Nutzer → nichts migrieren, nur
     merken, damit nicht bei jedem Start erneut geprüft wird. */
  if(data.habits.length){
    track(setDoc(userDoc(uid), { migratedFromLocal:true }, { merge:true }));
    return;
  }
  const legacy = readLegacy();
  if(!legacy || !legacy.habits.length) return;

  const batch = writeBatch(db);
  legacy.habits.forEach(h => batch.set(habitDoc(uid, h.id), h));
  batch.set(userDoc(uid), { settings: legacy.settings, migratedFromLocal:true }, { merge:true });
  await batch.commit();

  migratedFlag = true;
  stashLegacy(legacy.source);
  if(onMigrated) onMigrated(legacy.habits.length);
}
