"use strict";
/* ---------------------------------------------------------------------------
   Commitment Tracker — UI und Logik.

   Datenhaltung liegt in store.js (Firestore mit Offline-Kopie), Datumsrechnung
   in dates.js. Streaks, Rekorde, Quoten und Verlauf werden hier immer aus
   `completions` berechnet und nie gespeichert.
--------------------------------------------------------------------------- */
import {
  today, yesterday, tomorrow, addDays, daysBetween, fmtLong, fmtShort, fmtEv, greeting
} from "./dates.js";
import {
  data, startSync, stopSync, saveSettings, saveHabit, removeHabit,
  newHabit, setWriteErrorHandler
} from "./store.js";
import {
  watchAuth, loginWithGoogle, logout, isConfigured, auth,
  redirectSettled, redirectPending, clearRedirectPending, redirectError
} from "./firebase.js";

/* ---------- Icons (inline SVG) ---------- */
const IC = {
  check:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>',
  chart:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  gear:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.9 2.9l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.9-2.9l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.9-2.9l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.5h.1a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.9 2.9l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.4 1z"/></svg>',
  back:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>',
};

/* ---------- Beginn eines Commitments ----------
   Der offizielle Start ist `startDate`. Er kann in der Zukunft liegen: wer
   abends ein Commitment eingeht, das er heute schon gebrochen hat, laesst es
   morgen beginnen — dann ist heute kein offener und kein verpasster Tag.
   Dokumente aus der Zeit vor diesem Feld erben den Anlagetag. */
function startOf(h){ return h.startDate || h.createdAt; }
function notStarted(h){ return startOf(h) > today(); }

/* Rückwirkender Start: die Tage von `from` bis `to` gelten als erledigt.
   Heute bleibt bewusst offen — der Tag ist noch nicht vorbei und wird wie
   gewohnt abgehakt. Vorhandene Einträge (auch Joker) bleiben unangetastet. */
function emptyDays(h,from,to){ let n=0;
  for(let d=from; d<=to; d=addDays(d,1)) if(!h.completions[d]) n++;
  return n; }
function fillDone(h,from,to){ let n=0;
  for(let d=from; d<=to; d=addDays(d,1)) if(!h.completions[d]){ h.completions[d]="done"; n++; }
  return n; }

/* ---------- Berechnungen (aus Historie) ---------- */
function currentStreak(h){
  let start = h.completions[today()] ? today() : (h.completions[yesterday()] ? yesterday() : null);
  if(!start) return 0;
  let s=0,d=start;
  while(h.completions[d]){ s++; d=addDays(d,-1); }
  return s;
}
function longestStreak(h){
  const days=Object.keys(h.completions).sort();
  let best=h.legacyLongest||0,run=0,prev=null;
  for(const d of days){ run = (prev && daysBetween(prev,d)===1) ? run+1 : 1; if(run>best) best=run; prev=d; }
  return best;
}
function quote(h){
  const st=startOf(h);
  const span=daysBetween(st,today())+1;
  const done=Object.keys(h.completions).filter(d=>d<=today()&&d>=st).length;
  return span>0 ? Math.round(done/span*100) : 0;
}
function streakBroken(h){
  const hasAny=Object.keys(h.completions).length>0;
  return hasAny && !h.completions[today()] && !h.completions[yesterday()];
}
function lastDone(h){ const k=Object.keys(h.completions).sort(); return k.length?k[k.length-1]:null; }
function jokersUsedThisMonth(h){
  const pre=today().slice(0,7);
  return Object.entries(h.completions).filter(([d,v])=>v==="joker"&&d.startsWith(pre)).length;
}
function jokerAvailable(h){
  return !h.completions[yesterday()] && startOf(h)<yesterday()
    && jokersUsedThisMonth(h) < (h.jokersPerMonth==null?1:h.jokersPerMonth);
}
function goalReached(h){ return h.targetDays && currentStreak(h)>=h.targetDays; }
function habitEvents(h){
  const st=startOf(h);
  const ev=[{d:st,t:"start",label:notStarted(h)?"Startet":"Gestartet"}];
  const days=Object.keys(h.completions).sort().filter(x=>x<=today()&&x>=st);
  const runs=[]; let s=null,p=null;
  for(const d of days){
    if(!(p&&daysBetween(p,d)===1)){ if(s) runs.push({start:s,end:p}); s=d; }
    p=d;
  }
  if(s) runs.push({start:s,end:p});
  runs.forEach((r,i)=>{
    if(i>0){
      ev.push({d:addDays(runs[i-1].end,1),t:"broken",label:"Streak gebrochen"});
      ev.push({d:r.start,t:"restart",label:"Neu gestartet"});
    }
    const len=daysBetween(r.start,r.end)+1;
    if(h.targetDays && len>=h.targetDays)
      ev.push({d:addDays(r.start,h.targetDays-1),t:"goal",label:"Ziel erreicht — "+h.targetDays+" Tage"});
  });
  if(runs.length){
    const last=runs[runs.length-1];
    if(last.end<yesterday()) ev.push({d:addDays(last.end,1),t:"broken",label:"Streak gebrochen"});
  }
  ev.sort((a,b)=>a.d<b.d?-1:1);
  return ev;
}
function active(){ return data.habits.filter(h=>!h.archived).sort((a,b)=>{
  /* Noch nicht gestartete stehen unten — heute ist an ihnen nichts zu tun. */
  const ap=notStarted(a)?1:0, bp=notStarted(b)?1:0;
  if(ap!==bp) return ap-bp;
  if(data.settings.openFirst){
    const ad=h_doneToday(a)?1:0, bd=h_doneToday(b)?1:0;
    if(ad!==bd) return ad-bd;
  }
  return a.sortOrder-b.sortOrder; }); }
function h_doneToday(h){ return !!h.completions[today()]; }
/* Alles, was heute wirklich zaehlt — ohne die, die erst spaeter beginnen. */
function running(){ return active().filter(h=>!notStarted(h)); }
function col(h){ return getComputedStyle(document.documentElement).getPropertyValue(h.color).trim() || "#C05F3C"; }
function byId(id){ return data.habits.find(x=>x.id===id); }

/* ---------- Aktionen ---------- */
function toggleToday(id){
  const h=byId(id); if(!h) return;
  if(notStarted(h)){ toast("Dieses Commitment beginnt erst am "+fmtShort(startOf(h))+"."); return; }
  if(h.completions[today()]) delete h.completions[today()];
  else h.completions[today()]="done";
  saveHabit(h); render();
  const r=running();
  if(r.length && r.every(h_doneToday)) toast("Alles erledigt für heute.");
}
function toggleYesterday(id){
  const h=byId(id); if(!h) return;
  if(yesterday()<startOf(h)) return;
  if(h.completions[yesterday()]) delete h.completions[yesterday()];
  else h.completions[yesterday()]="done";
  saveHabit(h); render();
}
function toggleDay(id,d){
  const h=byId(id); if(!h) return;
  if(d>today()||d<startOf(h)) return;
  if(h.completions[d]) delete h.completions[d];
  else h.completions[d]="done";
  saveHabit(h); render();
}
function useJoker(id){
  const h=byId(id); if(!h||!jokerAvailable(h)) return;
  if(!confirm("Joker einsetzen und den "+fmtShort(yesterday())+" überbrücken?\n\nDu kannst auch verzichten — dann bleibt der Tag verpasst und der Streak beginnt neu.")) return;
  h.completions[yesterday()]="joker"; saveHabit(h); render();
  toast("Joker eingesetzt — Streak gerettet.");
}
function archiveHabit(id){
  const h=byId(id); if(!h) return;
  h.archived=true; h.archivedAt=today(); saveHabit(h); go("home");
  toast("Ins Archiv verschoben.");
}
function restoreHabit(id){
  const h=byId(id); if(!h) return;
  h.archived=false; h.archivedAt=null; saveHabit(h); render();
}
function deleteHabit(id){
  if(!confirm("Dieses Commitment endgültig löschen? Die gesamte Historie geht verloren.")) return;
  data.habits=data.habits.filter(x=>x.id!==id); removeHabit(id); go("home");
}
function continueUnlimited(id){
  const h=byId(id); if(!h) return;
  h.targetDays=null; saveHabit(h); render(); toast("Läuft jetzt unbegrenzt weiter.");
}

/* ---------- Benachrichtigung ---------- */
let reminderTimer=null;
async function setNotify(on){
  if(on){
    if(!("Notification" in window)){ toast("Dieses Gerät unterstützt keine Web-Benachrichtigungen."); return render(); }
    const p=await Notification.requestPermission();
    if(p!=="granted"){ toast("Berechtigung nicht erteilt."); data.settings.notify=false; saveSettings(); return render(); }
  }
  data.settings.notify=on; saveSettings(); scheduleReminder(); render();

  /* Echte Push-Nachrichten sind ein Zusatz. Klappt die Anmeldung des Geräts
     nicht (iOS ohne installierte PWA, fehlender VAPID-Key), bleibt die
     Erinnerung im Gerät trotzdem aktiv — deshalb nur protokollieren. */
  try{
    const m = await import("./messaging.js");
    if(on){
      const r = await m.enablePush();
      if(!r.ok) console.info("Push nicht aktiv:", r.grund, r.fehler || "");
    }else{
      await m.disablePush();
    }
  }catch(e){ console.warn("Messaging-Modul:", e); }
}
function openHabitsCount(){ return running().filter(h=>!h_doneToday(h)).length; }
async function fireReminder(){
  if(!data.settings.notify) return;
  if(data.settings.lastNotified===today()) return;
  const open=openHabitsCount(); if(open===0) return;
  /* Gleicher Wortlaut wie beim Push aus scripts/send-reminders.mjs — für dich
     ist beides dieselbe Abendmeldung. */
  const body="Hast du heute deine Commitments eingehalten?";
  try{
    const reg=await navigator.serviceWorker?.getRegistration();
    if(reg) await reg.showNotification("Abend-Check-in",{body, icon:"icon-192.png", badge:"icon-192.png"});
    else new Notification("Abend-Check-in",{body, icon:"icon-192.png"});
    data.settings.lastNotified=today(); saveSettings();
  }catch(e){}
}
function scheduleReminder(){
  if(reminderTimer) clearTimeout(reminderTimer);
  if(!data.settings.notify) return;
  const [hh,mm]=data.settings.reminderTime.split(":").map(Number);
  const now=new Date(); const t=new Date(); t.setHours(hh,mm,0,0);
  if(t<=now){ fireReminder(); t.setDate(t.getDate()+1); }
  reminderTimer=setTimeout(()=>{ fireReminder(); scheduleReminder(); }, t-now);
}

/* ---------- UI-Bausteine ---------- */
const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function toast(msg){ const t=document.getElementById("toast"); t.textContent=msg; t.classList.add("show");
  clearTimeout(t._x); t._x=setTimeout(()=>t.classList.remove("show"),2600); }

let view={name:"home",id:null};
function go(name,id){ view={name,id:id??null}; render(); window.scrollTo(0,0); }

function habitRow(h){
  const s=currentStreak(h), done=h_doneToday(h), broken=streakBroken(h), goal=goalReached(h);
  const c=col(h);
  if(notStarted(h)){
    /* Vor dem Start gibt es nichts abzuhaken — der Tag ist weder offen noch
       verpasst. Deshalb kein aktives Kaestchen und keine Streak-Zahl. */
    return `<div class="row">
      <button class="chk" disabled aria-label="Beginnt erst am ${fmtShort(startOf(h))}"></button>
      <div class="rowmain" data-open="${h.id}">
        <p class="rowname">${esc(h.name)}<span class="badge">ab ${fmtShort(startOf(h))}</span>${h.type==="avoid"?'<span class="badge">Verzicht</span>':""}</p>
        <div class="track"><div class="fill" style="width:0%;background:${c}"></div></div>
        <p class="rowstats">Beginnt ${fmtLong(startOf(h))} — heute zählt noch nicht.</p>
      </div>
      <p class="bignum" style="color:var(--faint)" data-open="${h.id}">–</p>
    </div>`;
  }
  const prog = h.targetDays ? Math.min(100,Math.round(s/h.targetDays*100)) : (s>0?100:0);
  let stats;
  if(goal) stats=`<span style="color:${c}">Ziel erreicht — ${h.targetDays} Tage geschafft</span>`;
  else if(broken){
    const ld=lastDone(h);
    stats=`<span class="warn">Streak gebrochen${ld?" am "+fmtShort(ld):""}</span>`
      + (jokerAvailable(h)?` · <span class="warn" style="text-decoration:underline" data-joker="${h.id}">Joker einsetzen</span>`:"")
      + ` · Joker: ${Math.max(0,(h.jokersPerMonth==null?1:h.jokersPerMonth)-jokersUsedThisMonth(h))} übrig`;
  } else {
    stats=`Tag ${s}${h.targetDays?" von "+h.targetDays:" (unbegrenzt)"} · Rekord ${longestStreak(h)}`;
  }
  return `<div class="row">
    <button class="chk ${done?"done":""}" style="${done?"background:"+c:""}" data-toggle="${h.id}" aria-label="${done?"Heute abgehakt":"Heute abhaken"}">${done?IC.check:""}</button>
    <div class="rowmain" data-open="${h.id}">
      <p class="rowname">${esc(h.name)}${goal?'<span class="badge gold">Ziel erreicht</span>':""}${h.type==="avoid"?'<span class="badge">Verzicht</span>':""}</p>
      <div class="track"><div class="fill" style="width:${broken&&!done?Math.min(prog,10):prog}%;background:${broken?"var(--danger)":c}"></div></div>
      <p class="rowstats">${stats}</p>
    </div>
    <p class="bignum" style="color:${(done||s>0)?c:"var(--faint)"}" data-open="${h.id}">${s}</p>
  </div>`;
}

/* ---------- Views ---------- */
function vHome(){
  const list=active();
  const run=list.filter(h=>!notStarted(h));
  const doneN=run.filter(h_doneToday).length;
  const words=["Null","Eins","Zwei","Drei","Vier","Fünf","Sechs","Sieben","Acht","Neun","Zehn"];
  const sub = list.length===0 ? "Noch keine Commitments"
    : run.length===0 ? "Heute nichts zu tun — alles startet später"
    : `${words[doneN]??doneN} von ${words[run.length]?.toLowerCase()??run.length} geschafft`;
  return `
  <div class="headrow">
    <div>
      <p class="eyebrow">${fmtLong(today())}</p>
      <h1>${greeting()}</h1>
      <p class="sub">${sub}</p>
    </div>
    <div class="icons">
      <button class="iconbtn" data-go="analyse" aria-label="Analyse öffnen">${IC.chart}</button>
      <button class="iconbtn" data-go="settings" aria-label="Einstellungen öffnen">${IC.gear}</button>
    </div>
  </div>
  ${list.length===0
    ? `<div class="empty" style="border-top:1px solid var(--line)">Noch keine Commitments.<br>Geh unten dein erstes ein.</div>`
    : list.map(habitRow).join("")}
  ${run.length&&doneN===run.length?`<div class="allDone">Alles erledigt für heute. Bis morgen.</div>`:""}
  <div class="topline"></div>
  <button class="cta" data-go="new">Neues Commitment eingehen</button>`;
}

function sparkline(h,color){
  const N=30, pts=[];
  let cum=0;
  for(let i=N-1;i>=0;i--){ const d=addDays(today(),-i); if(h.completions[d]) cum++;
    pts.push(((N-1-i)/(N-1)*280).toFixed(1)+","+(24-cum/N*20).toFixed(1)); }
  return `<svg width="100%" height="26" viewBox="0 0 280 26" preserveAspectRatio="none" aria-hidden="true">
    <polyline points="${pts.join(" ")}" fill="none" stroke="${color}" stroke-width="2"/></svg>`;
}
function vAnalyse(){
  const list=active();
  /* Der Tagesring und die Quote zeigen nur, was heute schon laeuft. */
  const run=list.filter(h=>!notStarted(h));
  const doneN=run.filter(h_doneToday).length;
  const total=data.habits.reduce((a,h)=>a+Object.keys(h.completions).length,0);
  const best=data.habits.length?Math.max(...data.habits.map(longestStreak)):0;
  const q=run.length?Math.round(run.reduce((a,h)=>a+quote(h),0)/run.length):0;
  const frac=run.length?doneN/run.length:0;
  const dash=(frac*226).toFixed(0)+" 226";
  return `
  <div class="headrow" style="align-items:center;margin-bottom:18px">
    <div style="display:flex;align-items:center;gap:12px">
      <button class="backbtn" data-go="home" aria-label="Zurück">${IC.back}</button>
      <div><h1 style="font-size:18px">Analyse</h1><p class="sub" style="font-size:12px">${fmtLong(today())}</p></div>
    </div>
  </div>
  <div class="card" style="display:flex;align-items:center;gap:18px">
    <svg width="86" height="86" viewBox="0 0 86 86" role="img" aria-label="Tagesring">
      <circle cx="43" cy="43" r="36" fill="none" stroke="#EADFD2" stroke-width="9"/>
      <circle cx="43" cy="43" r="36" fill="none" stroke="var(--terra)" stroke-width="9" stroke-linecap="round"
        stroke-dasharray="${dash}" transform="rotate(-90 43 43)"/>
      <text x="43" y="41" text-anchor="middle" font-size="19" font-weight="500" fill="var(--ink)">${doneN}/${run.length}</text>
      <text x="43" y="56" text-anchor="middle" font-size="10" fill="var(--muted)">heute</text>
    </svg>
    <div style="flex:1">
      <p style="font-size:14px;font-weight:500;margin:0 0 4px">Heutiger Fortschritt</p>
      <p class="sub" style="font-size:12px">${run.length===0?"Heute läuft noch nichts.":doneN===run.length?"Alles erledigt.":(run.length-doneN)+" noch offen"+(data.settings.notify?" — Erinnerung um "+data.settings.reminderTime:"")}</p>
    </div>
  </div>
  <div class="tiles">
    <div class="tile"><p class="tlabel">Quote</p><p class="tval">${q} %</p></div>
    <div class="tile"><p class="tlabel">Rekord</p><p class="tval" style="color:var(--terra)">${best}</p></div>
    <div class="tile"><p class="tlabel">Gesamt</p><p class="tval">${total}</p></div>
  </div>
  ${list.map(h=>{const c=col(h);const evs=habitEvents(h);return `
    <div class="card">
      <div class="cardhead" data-open="${h.id}"><p>${esc(h.name)}</p>
        <span style="color:${notStarted(h)?"var(--muted)":c}">${notStarted(h)?"ab "+fmtShort(startOf(h)):currentStreak(h)+" · "+quote(h)+" %"}</span></div>
      <div data-open="${h.id}">${sparkline(h,c)}</div>
      <details class="tl">
        <summary>Verlauf (${evs.length})</summary>
        ${evs.map(e=>{
          const dot=e.t==="broken"?"var(--danger)":e.t==="goal"?"var(--ochre)":c;
          return `<p><i style="background:${dot}"></i><span class="tld">${fmtEv(e.d)}</span>${e.label}</p>`;
        }).join("")}
      </details>
    </div>`;}).join("")}
  ${list.length===0?'<div class="empty">Noch keine Daten.</div>':""}`;
}

function heatmap(h){
  /* Vor dem Start gibt es weder erledigte noch verpasste Tage — ein leeres
     Raster samt Legende wäre nur Platzhalter. */
  if(notStarted(h))
    return `<p class="note" style="text-align:center;margin:18px 0 4px">Ab dem Starttag füllt sich hier dein Verlauf — 16 Wochen auf einen Blick.</p>`;
  const weeks=16, c=col(h);
  const startMon=addDays(today(),-(((new Date().getDay()+6)%7)) - (weeks-1)*7);
  let cells="";
  for(let w=0;w<weeks;w++) for(let r=0;r<7;r++){
    const d=addDays(startMon,w*7+r);
    if(d>today()||d<startOf(h)){ cells+='<span class="off"></span>'; continue; }
    const v=h.completions[d];
    if(v==="joker") cells+=`<span class="joker" data-d="${d}" title="${d} · Joker"></span>`;
    else if(v) cells+=`<span style="background:${c}" data-d="${d}" title="${d}"></span>`;
    else cells+=`<span data-d="${d}" title="${d}"></span>`;
  }
  return `<div class="heat">${cells}</div>
  <div class="heatlegend"><span><i style="background:${c}"></i>erledigt</span>
  <span><i style="background:var(--ochre);opacity:.55"></i>Joker</span>
  <span><i style="background:var(--track)"></i>verpasst</span></div>
  <p class="note" style="text-align:center;margin:0 0 4px">Tippe einen Tag an, um ihn nachzutragen oder zu entfernen — der Streak berechnet sich automatisch neu.</p>`;
}
function vDetail(){
  const h=byId(view.id);
  if(!h) return vHome();
  const s=currentStreak(h), c=col(h), goal=goalReached(h), broken=streakBroken(h);
  const st=startOf(h), pending=notStarted(h);
  return `
  <div class="headrow" style="align-items:center;margin-bottom:6px">
    <div style="display:flex;align-items:center;gap:12px">
      <button class="backbtn" data-go="home" aria-label="Zurück">${IC.back}</button>
      <div><h1 style="font-size:18px">${esc(h.name)}</h1>
      <p class="sub" style="font-size:12px">${h.type==="avoid"?"Verzicht":"Gewohnheit"} · ${pending?"ab":"seit"} ${fmtShort(st)}${h.archived?" · archiviert":""}</p></div>
    </div>
  </div>
  <p class="hero" style="color:${pending?"var(--faint)":c}">${pending?"–":s}</p>
  <p class="herosub">${pending
    ? `Beginnt ${fmtLong(st)} — Tag 1 ist dann dran`
    : `${h.targetDays?`Tag ${s} von ${h.targetDays}`:"Tage in Folge (unbegrenzt)"}${broken?' · <span style="color:var(--danger)">Streak gebrochen</span>':""}`}</p>
  ${goal?`<div class="allDone" style="margin:0 0 16px">Ziel erreicht — ${h.targetDays} Tage durchgezogen. Stark.</div>
    <div class="actions2"><button class="cta" style="margin-top:0" data-continue="${h.id}">Unbegrenzt weiter</button>
    <button class="cta filled" style="margin-top:0" data-archive="${h.id}">Ins Archiv</button></div>
    <div style="height:16px"></div>`:""}
  ${heatmap(h)}
  <div class="tiles" style="margin-top:14px">
    <div class="tile"><p class="tlabel">Quote</p><p class="tval">${quote(h)} %</p></div>
    <div class="tile"><p class="tlabel">Rekord</p><p class="tval" style="color:${c}">${longestStreak(h)}</p></div>
    <div class="tile"><p class="tlabel">Gesamt</p><p class="tval">${Object.keys(h.completions).length}</p></div>
  </div>
  ${!h.archived?`
    <button class="cta soft" data-edit="${h.id}">Bearbeiten (Name, Start, Ziel, Art)</button>
    ${yesterday()>=st?`<button class="cta soft" data-yday="${h.id}">${h.completions[yesterday()]?"Eintrag für gestern entfernen":"Gestern nachtragen"}</button>`:""}
    ${jokerAvailable(h)?`<button class="cta soft" data-joker="${h.id}">Joker für gestern einsetzen (${(h.jokersPerMonth==null?1:h.jokersPerMonth)-jokersUsedThisMonth(h)} übrig)</button>`:""}
    ${!goal?`<button class="cta soft" data-archive="${h.id}">Ins Archiv verschieben</button>`:""}`
  :`<button class="cta" data-restore-d="${h.id}">Wieder aktivieren</button>`}
  <button class="cta dangerline" data-del="${h.id}">Commitment löschen</button>`;
}

/* ---------- Startdatum-Auswahl (Neu + Bearbeiten) ----------
   Segment-Umschalter wie bei „Etwas tun / Etwas lassen"; das Date-Feld
   erscheint nur unter „Datum wählen". `p` ist das Id-Präfix des Formulars. */
const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(s||"");
/* Grenzen für das Date-Feld: zehn Jahre in beide Richtungen. Ohne Grenze
   ließe ein Vertipper („0202") Tausende von Tagen nachtragen. */
const minStart = () => addDays(today(),-3650);
const maxStart = () => addDays(today(),3650);
function inStartRange(d){ return isDay(d) && d>=minStart() && d<=maxStart(); }
function startNote(d){
  if(d===today()) return "Läuft ab heute — heute ist Tag 1.";
  if(d>today()) return "Läuft ab "+fmtLong(d)+" — bis dahin zählt kein Tag, auch heute nicht.";
  return "Läuft rückwirkend ab "+fmtLong(d)+" — die Tage davor zählen nicht.";
}
function startPicker(p, val){
  const mode = val===today() ? 0 : val===tomorrow() ? 1 : 2;
  const btn = (i,txt) => `<button type="button" data-start="${i}" class="${mode===i?"on":""}">${txt}</button>`;
  return `
  <label class="f">Start</label>
  <div class="seg" id="${p}Seg">${btn(0,"Heute")}${btn(1,"Morgen")}${btn(2,"Datum wählen")}</div>
  <input type="date" class="dateline ${mode===2?"":"hidden"}" id="${p}Date" value="${val}"
    min="${minStart()}" max="${maxStart()}" aria-label="Startdatum">
  <p class="note" id="${p}Note">${startNote(val)}</p>
  <div class="inline hidden" id="${p}FillRow">
    <input type="checkbox" id="${p}Fill" checked><label for="${p}Fill" id="${p}FillLabel"></label>
  </div>`;
}
/* Bindet die Auswahl und gibt zwei Abfragen zurück: `pick()` liefert das
   gewählte Datum ("" wenn im Datumsmodus keines gesetzt ist), `wantFill()`
   sagt, ob die vergangenen Tage als erledigt eingetragen werden sollen.

   `fill(datum)` ist optional und liefert {n, text} für das Kästchen — n=0
   blendet es aus. Damit entscheidet jedes Formular selbst, welche Tage es
   anbietet: beim Anlegen alle, beim Bearbeiten nur die neu dazugekommenen. */
function bindStartPicker(app, p, val, fill){
  const seg=app.querySelector("#"+p+"Seg"), inp=app.querySelector("#"+p+"Date"),
        note=app.querySelector("#"+p+"Note"), row=app.querySelector("#"+p+"FillRow"),
        box=app.querySelector("#"+p+"Fill"), lab=app.querySelector("#"+p+"FillLabel");
  const pick=()=> inp.classList.contains("hidden") ? val : inp.value;
  const show=()=>{
    const d=pick();
    note.textContent = isDay(d) ? startNote(d) : "Wähle ein Datum.";
    const f = (fill && inStartRange(d)) ? fill(d) : null;
    row.classList.toggle("hidden", !f || !f.n);
    if(f && f.n) lab.textContent=f.text;
  };
  seg.querySelectorAll("button").forEach(b=>b.onclick=()=>{
    const m=+b.dataset.start;
    seg.querySelectorAll("button").forEach(x=>x.classList.toggle("on",x===b));
    inp.classList.toggle("hidden", m!==2);
    if(m<2){ val = m===0 ? today() : tomorrow(); inp.value=val; }
    show();
  });
  inp.onchange=show;
  show();
  return { pick, wantFill: () => !row.classList.contains("hidden") && box.checked };
}

function vNew(){
  return `
  <div class="headrow" style="align-items:center;margin-bottom:10px">
    <div style="display:flex;align-items:center;gap:12px">
      <button class="backbtn" data-go="home" aria-label="Zurück">${IC.back}</button>
      <h1 style="font-size:18px">Neues Commitment</h1>
    </div>
  </div>
  <label class="f" for="nName">Ich verpflichte mich zu …</label>
  <input type="text" id="nName" placeholder="z. B. Kein Social Media" maxlength="60" autocomplete="off">
  <label class="f">Art</label>
  <div class="seg">
    <button type="button" id="tDo" class="on">Etwas tun</button>
    <button type="button" id="tAvoid">Etwas lassen</button>
  </div>
  ${startPicker("n", today())}
  <label class="f" for="nDays">Ziel in Tagen</label>
  <input type="number" id="nDays" min="1" max="3650" step="1" value="30" inputmode="numeric">
  <div class="inline"><input type="checkbox" id="nUnl"><label for="nUnl">Unbegrenzt — ohne festes Ziel</label></div>
  <label class="f" for="nJokers">Joker pro Monat für dieses Commitment</label>
  <select id="nJokers"><option value="0">0 — keine Gnade</option><option value="1" selected>1</option><option value="2">2</option><option value="3">3</option></select>
  <p class="note">Tipp: Im Schnitt dauert es laut Forschung rund 66 Tage, bis eine neue Gewohnheit automatisch wird — je nach Gewohnheit zwischen 18 und 254 Tagen.</p>
  <button class="cta filled" id="nSubmit">Commitment eingehen</button>
  <p class="note" id="nErr" style="color:var(--danger)"></p>`;
}

function vEdit(){
  const h=byId(view.id);
  if(!h) return vHome();
  return `
  <div class="headrow" style="align-items:center;margin-bottom:10px">
    <div style="display:flex;align-items:center;gap:12px">
      <button class="backbtn" data-open="${h.id}" aria-label="Zurück">${IC.back}</button>
      <h1 style="font-size:18px">Bearbeiten</h1>
    </div>
  </div>
  <label class="f" for="eName">Name</label>
  <input type="text" id="eName" value="${esc(h.name)}" maxlength="60" autocomplete="off">
  <label class="f">Art</label>
  <div class="seg">
    <button type="button" id="eDo" class="${h.type!=="avoid"?"on":""}">Etwas tun</button>
    <button type="button" id="eAvoid" class="${h.type==="avoid"?"on":""}">Etwas lassen</button>
  </div>
  ${startPicker("e", startOf(h))}
  <label class="f" for="eDays">Ziel in Tagen</label>
  <input type="number" id="eDays" min="1" max="3650" step="1" value="${h.targetDays||30}" inputmode="numeric" ${h.targetDays?"":"disabled"}>
  <div class="inline"><input type="checkbox" id="eUnl" ${h.targetDays?"":"checked"}><label for="eUnl">Unbegrenzt — ohne festes Ziel</label></div>
  <label class="f" for="eJokers">Joker pro Monat für dieses Commitment</label>
  <select id="eJokers">${[0,1,2,3].map(n=>`<option value="${n}" ${(h.jokersPerMonth==null?1:h.jokersPerMonth)===n?"selected":""}>${n===0?"0 — keine Gnade":n}</option>`).join("")}</select>
  <p class="note">Die Historie bleibt erhalten. Nur wenn du den Start nach hinten schiebst, fallen Einträge davor weg — danach wird gefragt.</p>
  <button class="cta filled" id="eSubmit">Änderungen speichern</button>
  <p class="note" id="eErr" style="color:var(--danger)"></p>`;
}

function vSettings(){
  const s=data.settings;
  const archived=data.habits.filter(h=>h.archived);
  const u=auth.currentUser;
  return `
  <div class="headrow" style="align-items:center;margin-bottom:6px">
    <div style="display:flex;align-items:center;gap:12px">
      <button class="backbtn" data-go="home" aria-label="Zurück">${IC.back}</button>
      <h1 style="font-size:18px">Einstellungen</h1>
    </div>
  </div>
  <div class="setrow">
    <div><p class="l">Abendliche Erinnerung</p><p class="d">Meldet sich, wenn noch etwas offen ist.</p></div>
    <label class="switch"><input type="checkbox" id="sNotify" ${s.notify?"checked":""}><span class="knob"></span></label>
  </div>
  <div class="setrow">
    <div><p class="l">Erinnerungszeit</p></div>
    <input type="time" id="sTime" value="${s.reminderTime}">
  </div>
  <div class="setrow">
    <div><p class="l">Offene zuerst sortieren</p></div>
    <label class="switch"><input type="checkbox" id="sOpenFirst" ${s.openFirst?"checked":""}><span class="knob"></span></label>
  </div>
  <p class="note" style="margin-top:14px">Joker legst du pro Commitment fest — beim Anlegen oder über Bearbeiten in der Detailansicht.</p>
  ${archived.length?`
  <label class="f">Archiv</label>
  ${archived.map(h=>`<div class="setrow" style="padding:12px 0">
    <div><p class="l">${esc(h.name)}</p><p class="d">Rekord ${longestStreak(h)} · archiviert am ${fmtShort(h.archivedAt||today())}</p></div>
    <button class="cta soft" style="margin:0;padding:9px 14px;width:auto" data-restore="${h.id}">Aktivieren</button>
  </div>`).join("")}`:""}
  <label class="f">Konto</label>
  <div class="setrow" style="padding:12px 0">
    <div><p class="l">Angemeldet</p><p class="d">${esc((u&&(u.email||u.displayName))||"—")}</p></div>
    <button class="cta soft" style="margin:0;padding:9px 14px;width:auto" id="sLogout">Abmelden</button>
  </div>
  <p class="note">Deine Commitments liegen in deinem Google-Konto und werden zwischen allen Geräten synchronisiert. Ohne Netz trägst du ganz normal weiter ein — der Abgleich passiert automatisch, sobald du wieder online bist.</p>
  <p class="note" style="margin-top:22px">Hinweis zu Benachrichtigungen: Auf dem iPhone funktionieren sie nur, wenn die App über „Teilen → Zum Home-Bildschirm" installiert wurde (iOS 16.4 oder neuer). Zuverlässig erinnert die App, solange sie installiert ist und gelegentlich geöffnet wird; echte Server-Push-Nachrichten folgen später mit Firebase.</p>`;
}

/* ---------- Render + Events ---------- */
function render(){
  const app=document.getElementById("app");
  app.innerHTML = view.name==="analyse"?vAnalyse()
    : view.name==="detail"?vDetail()
    : view.name==="new"?vNew()
    : view.name==="edit"?vEdit()
    : view.name==="settings"?vSettings()
    : vHome();
  bind(app);
}
function bind(app){
  app.querySelectorAll("[data-go]").forEach(b=>b.onclick=()=>go(b.dataset.go));
  app.querySelectorAll("[data-toggle]").forEach(b=>b.onclick=e=>{e.stopPropagation();toggleToday(+b.dataset.toggle);});
  app.querySelectorAll("[data-open]").forEach(b=>b.onclick=()=>go("detail",+b.dataset.open));
  app.querySelectorAll("[data-joker]").forEach(b=>b.onclick=e=>{e.stopPropagation();useJoker(+b.dataset.joker);});
  app.querySelectorAll("[data-yday]").forEach(b=>b.onclick=()=>toggleYesterday(+b.dataset.yday));
  app.querySelectorAll("[data-archive]").forEach(b=>b.onclick=()=>archiveHabit(+b.dataset.archive));
  app.querySelectorAll("[data-continue]").forEach(b=>b.onclick=()=>continueUnlimited(+b.dataset.continue));
  app.querySelectorAll("[data-del]").forEach(b=>b.onclick=()=>deleteHabit(+b.dataset.del));
  app.querySelectorAll("[data-restore],[data-restore-d]").forEach(b=>b.onclick=()=>restoreHabit(+(b.dataset.restore||b.dataset.restoreD)));
  app.querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>go("edit",+b.dataset.edit));
  app.querySelectorAll(".heat span[data-d]").forEach(el=>el.onclick=()=>toggleDay(view.id, el.dataset.d));

  if(view.name==="edit"){
    const eDo=app.querySelector("#eDo"), eAv=app.querySelector("#eAvoid");
    let type=(byId(view.id)||{}).type||"do";
    eDo.onclick=()=>{type="do";eDo.classList.add("on");eAv.classList.remove("on");};
    eAv.onclick=()=>{type="avoid";eAv.classList.add("on");eDo.classList.remove("on");};
    const unl=app.querySelector("#eUnl"), days=app.querySelector("#eDays");
    unl.onchange=()=>{days.disabled=unl.checked;};
    /* Beim Bearbeiten werden nur die Tage angeboten, die durch einen früheren
       Start neu dazukommen — was innerhalb der bisherigen Laufzeit leer blieb,
       ist eine bewusste Lücke und bleibt es. */
    const alt=startOf(byId(view.id)||{startDate:today()});
    const bisZu=(addDays(alt,-1)<yesterday()) ? addDays(alt,-1) : yesterday();
    const st=bindStartPicker(app,"e",alt,d=>{
      const h=byId(view.id); if(!h||d>=alt) return {n:0};
      const n=emptyDays(h,d,bisZu);
      return { n, text: n===1 ? "Den "+fmtShort(d)+" als erledigt eintragen"
                              : "Die "+n+" Tage ab "+fmtShort(d)+" als erledigt eintragen" };
    });
    app.querySelector("#eSubmit").onclick=()=>{
      /* Frisch nachschlagen: ein Sync aus der Cloud kann das Objekt zwischen
         Rendern und Speichern ersetzt haben. */
      const h=byId(view.id);
      const err=app.querySelector("#eErr");
      if(!h){ err.textContent="Dieses Commitment gibt es nicht mehr."; return; }
      const name=app.querySelector("#eName").value.trim();
      if(!name){ err.textContent="Der Name darf nicht leer sein."; return; }
      const start=st.pick();
      if(!isDay(start)){ err.textContent="Wähle ein Startdatum."; return; }
      if(!inStartRange(start)){ err.textContent="Wähle ein Datum innerhalb der nächsten oder letzten zehn Jahre."; return; }
      let target=null;
      if(!unl.checked){
        target=parseInt(days.value,10);
        if(!target||target<1){ err.textContent="Gib eine Zieldauer von mindestens einem Tag ein."; return; }
      }
      /* Ein späterer Start macht frühere Einträge gegenstandslos. Sie
         verschwinden nicht heimlich — sonst stünde in der Heatmap etwas
         anderes als in der Quote. */
      const vorher=Object.keys(h.completions).filter(d=>d<start);
      if(vorher.length){
        const satz = vorher.length===1
          ? "Ein Eintrag liegt vor dem "+fmtShort(start)+" und wird gelöscht."
          : vorher.length+" Einträge liegen vor dem "+fmtShort(start)+" und werden gelöscht.";
        if(!confirm(satz+"\n\nTrotzdem speichern?")) return;
      }
      vorher.forEach(d=>delete h.completions[d]);
      const n=st.wantFill() ? fillDone(h,start,bisZu) : 0;
      h.name=name; h.type=type; h.targetDays=target; h.startDate=start;
      h.jokersPerMonth=+app.querySelector("#eJokers").value;
      saveHabit(h); go("detail",h.id);
      toast(n ? n+" Tage nachgetragen — du bist bei Tag "+currentStreak(h)+"."
        : start>today() ? "Gespeichert — beginnt am "+fmtShort(start)+"." : "Änderungen gespeichert.");
    };
  }

  if(view.name==="new"){
    const tDo=app.querySelector("#tDo"), tAv=app.querySelector("#tAvoid");
    let type="do";
    tDo.onclick=()=>{type="do";tDo.classList.add("on");tAv.classList.remove("on");};
    tAv.onclick=()=>{type="avoid";tAv.classList.add("on");tDo.classList.remove("on");};
    const unl=app.querySelector("#nUnl"), days=app.querySelector("#nDays");
    unl.onchange=()=>{days.disabled=unl.checked;};
    /* Beim Anlegen ist die Historie leer: angeboten werden alle Tage vom
       Startdatum bis gestern. */
    const st=bindStartPicker(app,"n",today(),d=>{
      /* In der Zukunft gibt es nichts nachzutragen — daysBetween wäre negativ. */
      const n=Math.max(0,daysBetween(d,today()));
      return { n, text: n===1 ? "Den "+fmtShort(d)+" als erledigt eintragen"
                              : "Die "+n+" Tage ab "+fmtShort(d)+" als erledigt eintragen" };
    });
    app.querySelector("#nSubmit").onclick=()=>{
      const name=app.querySelector("#nName").value.trim();
      const err=app.querySelector("#nErr");
      if(!name){ err.textContent="Gib deinem Commitment einen Namen."; return; }
      const start=st.pick();
      if(!isDay(start)){ err.textContent="Wähle ein Startdatum."; return; }
      if(!inStartRange(start)){ err.textContent="Wähle ein Datum innerhalb der nächsten oder letzten zehn Jahre."; return; }
      let target=null;
      if(!unl.checked){
        target=parseInt(days.value,10);
        if(!target||target<1){ err.textContent="Gib eine Zieldauer von mindestens einem Tag ein."; return; }
      }
      const h=newHabit(name,target,type,+app.querySelector("#nJokers").value,start);
      const n=st.wantFill() ? fillDone(h,start,yesterday()) : 0;
      data.habits.push(h); saveHabit(h); go("home");
      toast(n ? "Commitment eingegangen — "+n+" Tage nachgetragen, du bist bei Tag "+currentStreak(h)+"."
        : start>today() ? "Commitment eingegangen — es beginnt am "+fmtShort(start)+"."
        : "Commitment eingegangen. Los geht's.");
    };
    app.querySelector("#nName").focus();
  }
  if(view.name==="settings"){
    app.querySelector("#sNotify").onchange=e=>setNotify(e.target.checked);
    app.querySelector("#sTime").onchange=e=>{ data.settings.reminderTime=e.target.value||"21:00"; saveSettings(); scheduleReminder(); };
    app.querySelector("#sOpenFirst").onchange=e=>{ data.settings.openFirst=e.target.checked; saveSettings(); };
    app.querySelector("#sLogout").onclick=async()=>{
      if(!confirm("Abmelden? Deine Daten bleiben in deinem Google-Konto gespeichert.")) return;
      try{ await logout(); }catch(e){ toast("Abmelden hat nicht geklappt."); }
    };
  }
}

/* ---------- Login-Screen ---------- */
const el = id => document.getElementById(id);
function showScreen(which){
  el("boot").classList.toggle("hidden", which!=="boot");
  el("gate").classList.toggle("hidden", which!=="gate");
  el("app").classList.toggle("hidden", which!=="app");
}
function gateError(msg){ el("gateErr").textContent = msg || ""; }

function loginHint(code){
  if(code==="auth/network-request-failed")
    return "Keine Verbindung. Für die erste Anmeldung brauchst du einmal Netz.";
  if(code==="auth/unauthorized-domain")
    return "Diese Adresse ist in Firebase nicht als autorisierte Domain eingetragen.";
  return "Anmeldung fehlgeschlagen"+(code?" ("+code+")":"")+". Versuch es noch einmal.";
}

function initGate(){
  const btn=el("gateBtn");
  if(!isConfigured()){
    btn.disabled=true;
    btn.style.opacity=".5";
    gateError("Firebase ist noch nicht konfiguriert — trage die Projektdaten in firebase-config.js ein (siehe README).");
    return;
  }
  btn.onclick=async()=>{
    gateError("");
    btn.disabled=true;
    try{
      await loginWithGoogle();
    }catch(err){
      gateError(loginHint((err&&err.code)||""));
    }finally{
      btn.disabled=false;
    }
  };
}

/* ---------- Start ---------- */
let synced=false;
setWriteErrorHandler(err=>{
  const code=(err&&err.code)||"";
  if(code==="permission-denied") toast("Kein Zugriff — bitte neu anmelden.");
  else if(code && code!=="unavailable") console.warn("Firestore:", code, err);
});

/* Beim Start das Geräte-Token auffrischen (FCM-Token können rotieren) und
   Nachrichten abfangen, die eintreffen, während die App offen ist.
   Fragt bewusst nie von sich aus nach der Berechtigung — das passiert nur über
   den Schalter in den Einstellungen. */
let pushWired=false;
async function initPush(){
  if(pushWired || !data.settings.notify) return;
  if(!("Notification" in window) || Notification.permission!=="granted") return;
  pushWired=true;
  try{
    const m=await import("./messaging.js");
    m.onPushWhileOpen((titel,text)=>toast(text||titel));
    const r=await m.enablePush();
    if(!r.ok) console.info("Push nicht aktiv:", r.grund, r.fehler || "");
  }catch(e){ console.warn("Messaging-Modul:", e); }
}

/* Der Versender läuft auf einem Server in UTC und muss wissen, was "21:00"
   bei dir bedeutet. Wird einmalig hinterlegt und danach nicht mehr angefasst,
   damit sich zwei Geräte nicht gegenseitig überschreiben. */
function ensureTimeZone(){
  if(data.settings.timeZone) return;
  let tz="";
  try{ tz=Intl.DateTimeFormat().resolvedOptions().timeZone||""; }catch(e){}
  if(!tz) return;
  data.settings.timeZone=tz;
  saveSettings();
}

function onData(){
  if(!synced){ synced=true; showScreen("app"); scheduleReminder(); ensureTimeZone(); initPush(); }
  /* Formulare nicht unter den Fingern neu aufbauen. */
  if(view.name==="new"||view.name==="edit") return;
  render();
}

initGate();
showScreen("boot");

/* Ein abgebrochener Redirect-Login soll nicht stumm auf dem Login-Screen enden. */
redirectSettled.then(()=>{
  if(auth.currentUser) return;
  if(redirectError){ clearRedirectPending(); gateError(loginHint(redirectError)); }
  else if(redirectPending()){
    clearRedirectPending();
    gateError("Die Anmeldung kam nicht in der App an. Tipp noch einmal auf „Mit Google anmelden\" — es öffnet sich jetzt ein Fenster statt einer Weiterleitung.");
  }
});

watchAuth(user=>{
  if(user){
    clearRedirectPending();
    synced=false;
    view={name:"home",id:null};
    startSync(user.uid, onData, n=>{
      toast(n===1 ? "Ein Commitment übernommen." : n+" Commitments übernommen.");
    });
    /* Falls Firestore offline ist und noch kein Snapshot kam: trotzdem die App
       zeigen, statt auf dem Login-Screen zu hängen. */
    setTimeout(()=>{ if(!synced){ synced=true; showScreen("app"); render(); scheduleReminder(); } }, 2500);
  }else{
    stopSync();
    synced=false;
    if(reminderTimer) clearTimeout(reminderTimer);
    showScreen("gate");
  }
});

document.addEventListener("visibilitychange",()=>{
  if(!document.hidden && synced && auth.currentUser){ render(); scheduleReminder(); }
});
if("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(()=>{});
