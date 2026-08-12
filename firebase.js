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

/* iOS meldet eine installierte PWA über navigator.standalone. Dort ist ein
   Popup unzuverlässig (es öffnet außerhalb der App), deshalb direkt Redirect. */
const prefersRedirect = () =>
  window.navigator.standalone === true ||
  (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);

const REDIRECT_ERRORS = [
  "auth/popup-blocked",
  "auth/popup-closed-by-user",
  "auth/cancelled-popup-request",
  "auth/operation-not-supported-in-this-environment",
  "auth/web-storage-unsupported"
];

export async function loginWithGoogle(){
  if(prefersRedirect()){
    await signInWithRedirect(auth, provider);
    return;
  }
  try{
    await signInWithPopup(auth, provider);
  }catch(err){
    if(REDIRECT_ERRORS.includes(err && err.code)){
      await signInWithRedirect(auth, provider);
      return;
    }
    throw err;
  }
}

/* Ergebnis eines Redirect-Logins einsammeln. Fehler hier sind nicht fatal —
   onAuthStateChanged entscheidet, ob jemand eingeloggt ist. */
export const redirectSettled = getRedirectResult(auth).catch(err => {
  console.warn("Redirect-Login:", err && err.code ? err.code : err);
  return null;
});

export const logout = () => signOut(auth);
export const watchAuth = cb => onAuthStateChanged(auth, cb);
