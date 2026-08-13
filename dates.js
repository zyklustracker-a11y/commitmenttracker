"use strict";
/* ---------- Dates (lokal, nicht UTC) ---------- */
export const dstr = d => d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
export const today = () => dstr(new Date());
export const addDays = (s,n) => { const [y,m,d]=s.split("-").map(Number); const t=new Date(y,m-1,d); t.setDate(t.getDate()+n); return dstr(t); };
export const yesterday = () => addDays(today(),-1);
export const tomorrow = () => addDays(today(),1);
export const daysBetween = (a,b) => { const [y1,m1,d1]=a.split("-").map(Number),[y2,m2,d2]=b.split("-").map(Number);
  return Math.round((new Date(y2,m2-1,d2)-new Date(y1,m1-1,d1))/86400000); };
export const WD=["Sonntag","Montag","Dienstag","Mittwoch","Donnerstag","Freitag","Samstag"];
export const MO=["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];
export const fmtLong = s => { const [y,m,d]=s.split("-").map(Number); const t=new Date(y,m-1,d); return WD[t.getDay()]+", "+d+". "+MO[m-1]; };
export const fmtShort = s => { const [y,m,d]=s.split("-").map(Number); return d+". "+MO[m-1].slice(0,3); };
export const fmtEv = s => { const [y,m,d]=s.split("-").map(Number); const cy=new Date().getFullYear();
  return d+". "+MO[m-1].slice(0,3)+(y!==cy?" "+y:""); };
export const greeting = () => { const h=new Date().getHours(); return h<5?"Gute Nacht":h<11?"Guten Morgen":h<18?"Guten Tag":"Guten Abend"; };
