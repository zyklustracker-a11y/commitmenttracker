"use strict";
/* ---------------------------------------------------------------------------
   Firebase Cloud Messaging: Geräte-Token besorgen und in Firestore ablegen,
   damit der Versand (Cloud Function bzw. Scheduler) weiß, wohin er senden soll.

   Struktur:  users/{uid}/tokens/{token} → { token, createdAt, ua, platform }

   Der Versand selbst passiert nicht hier — diese Datei kümmert sich nur um
   Anmeldung und Abmeldung des Geräts.

   Wichtig zu iOS: Web-Push gibt es dort erst ab iOS 16.4 und ausschließlich in
   der über „Zum Home-Bildschirm" installierten PWA. Im normalen Safari-Tab
   liefert isSupported() false, und das ist kein Fehler, sondern die Plattform.
--------------------------------------------------------------------------- */
import {
  getMessaging, getToken, deleteToken, onMessage, isSupported
} from "./vendor/firebase-messaging.js";
import { doc, setDoc, deleteDoc } from "./vendor/firebase-firestore.js";
import { app, auth, db } from "./firebase.js";
import { vapidKey, isPushConfigured } from "./firebase-config.js";

const LAST_TOKEN = "ct_fcm_token";

let messaging = null;
function ms(){
  if(!messaging) messaging = getMessaging(app);
  return messaging;
}

/* Sagt, ob echtes Push auf diesem Gerät überhaupt möglich ist. */
export async function pushAvailable(){
  if(!isPushConfigured()) return { ok:false, grund:"kein-vapid-key" };
  if(!("Notification" in window)) return { ok:false, grund:"keine-notifications" };
  if(!("serviceWorker" in navigator)) return { ok:false, grund:"kein-serviceworker" };
  let supported = false;
  try{ supported = await isSupported(); }catch(e){}
  if(!supported) return { ok:false, grund:"browser-unterstuetzt-kein-push" };
  return { ok:true };
}

/* Token holen und beim Nutzer hinterlegen. Nutzt bewusst die bestehende
   Service-Worker-Registrierung (sw.js) statt einer zweiten: zwei Worker im
   selben Scope würden sich gegenseitig ablösen. */
export async function enablePush(){
  const verfuegbar = await pushAvailable();
  if(!verfuegbar.ok) return verfuegbar;

  const user = auth.currentUser;
  if(!user) return { ok:false, grund:"nicht-angemeldet" };

  if(Notification.permission !== "granted"){
    const p = await Notification.requestPermission();
    if(p !== "granted") return { ok:false, grund:"keine-berechtigung" };
  }

  try{
    const registration = await navigator.serviceWorker.ready;
    const token = await getToken(ms(), { vapidKey, serviceWorkerRegistration: registration });
    if(!token) return { ok:false, grund:"kein-token" };

    await setDoc(doc(db, "users", user.uid, "tokens", token), {
      token,
      createdAt: new Date().toISOString(),
      ua: navigator.userAgent.slice(0, 300),
      platform: navigator.platform || ""
    });
    try{ localStorage.setItem(LAST_TOKEN, token); }catch(e){}
    return { ok:true, token };
  }catch(err){
    console.warn("Push-Anmeldung:", err);
    return { ok:false, grund:"fehler", fehler:(err && err.code) || String(err) };
  }
}

/* Gerät wieder abmelden: Token bei FCM löschen und aus Firestore entfernen. */
export async function disablePush(){
  const user = auth.currentUser;
  let token = null;
  try{ token = localStorage.getItem(LAST_TOKEN); }catch(e){}

  if(user && token){
    try{ await deleteDoc(doc(db, "users", user.uid, "tokens", token)); }catch(e){}
  }
  try{ if(await isSupported()) await deleteToken(ms()); }catch(e){}
  try{ localStorage.removeItem(LAST_TOKEN); }catch(e){}
}

/* Nachrichten, die eintreffen, während die App offen ist. Der Service Worker
   zeigt in dem Fall nichts an, das übernimmt der Aufrufer. */
export async function onPushWhileOpen(cb){
  try{
    if(!(await isSupported())) return;
    onMessage(ms(), payload => {
      const n = (payload && payload.notification) || {};
      cb(n.title || "Abend-Check-in", n.body || "");
    });
  }catch(e){}
}
