"use strict";
/* ---------------------------------------------------------------------------
   Firebase-Initialisierung: App, Auth (Google) und Firestore mit
   Offline-Persistenz.

   Das SDK liegt lokal unter vendor/ (siehe README) — damit funktioniert die App
   auch beim Kaltstart ohne Netz, ohne Abhängigkeit von einem CDN.
--------------------------------------------------------------------------- */
import { initializeApp } from "./vendor/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  getRedirectResult, onAuthStateChanged, signOut,
  setPersistence, indexedDBLocalPersistence, browserLocalPersistence
} from "./vendor/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager
} from "./vendor/firebase-firestore.js";
import { firebaseConfig, isConfigured } from "./firebase-config.js";

export { isConfigured };

export const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
/* Eingeloggt bleiben, auch nach Neustart der App. IndexedDB ist die
   haltbarste Variante; wenn sie fehlt (z. B. privates Fenster), fällt Auth
   automatisch auf localStorage zurück. */
setPersistence(auth, indexedDBLocalPersistence)
  .catch(() => setPersistence(auth, browserLocalPersistence))
  .catch(() => {});

/* Offline-First: Firestore hält eine vollständige lokale Kopie vor. Eintragen
   ohne Netz landet in dieser Kopie und wird automatisch synchronisiert, sobald
   wieder Verbindung besteht. Kein eigener Sync-Code. */
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

/* Merker fuer einen begonnenen Redirect-Login. Bewusst localStorage: das SDK
   legt seinen Zwischenstand in sessionStorage ab, und genau der geht verloren,
   wenn iOS die PWA nach der Rueckkehr von Google neu startet. */
const REDIRECT_FLAG = "ct_redirect_login";
export const redirectPending = () => localStorage.getItem(REDIRECT_FLAG) !== null;
export const clearRedirectPending = () => { try{ localStorage.removeItem(REDIRECT_FLAG); }catch(e){} };

/* Fehler, bei denen ein Popup aussichtslos ist und der Redirect die letzte
   Chance bleibt. Alles andere wird nach oben gereicht und angezeigt. */
const REDIRECT_ERRORS = [
  "auth/popup-blocked",
  "auth/popup-closed-by-user",
  "auth/cancelled-popup-request",
  "auth/operation-not-supported-in-this-environment",
  "auth/web-storage-unsupported"
];

/* Popup zuerst — auch in der installierten PWA.
   Der Redirect ist auf iOS unzuverlaessig: die PWA wird nach der Rueckkehr von
   Google haeufig neu ab start_url gestartet, damit ist der Zwischenstand fuer
   getRedirectResult weg. Dazu kommt, dass Safari den Storage-Zugriff auf die
   authDomain (*.firebaseapp.com) blockiert, weil das eine Fremddomain ist.
   Deshalb nur noch als Notnagel, wenn das Popup gar nicht erst aufgeht. */
export async function loginWithGoogle(){
  try{
    await signInWithPopup(auth, provider);
    clearRedirectPending();
    return "popup";
  }catch(err){
    const code = (err && err.code) || "";
    if(!REDIRECT_ERRORS.includes(code)) throw err;
    try{ localStorage.setItem(REDIRECT_FLAG, String(Date.now())); }catch(e){}
    await signInWithRedirect(auth, provider);
    return "redirect";
  }
}

/* Ergebnis eines Redirect-Logins einsammeln. Der Fehlercode wird behalten,
   damit der Login-Screen ihn zeigen kann statt still zurueckzufallen. */
export let redirectError = null;
export const redirectSettled = getRedirectResult(auth).then(res => {
  if(res) clearRedirectPending();
  return res;
}).catch(err => {
  redirectError = (err && err.code) || String(err);
  console.warn("Redirect-Login:", redirectError);
  return null;
});

export const logout = () => signOut(auth);
export const watchAuth = cb => onAuthStateChanged(auth, cb);
