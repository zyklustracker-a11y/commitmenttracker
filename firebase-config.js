"use strict";
/* ---------------------------------------------------------------------------
   Firebase-Konfiguration.

   Diese Werte sind KEINE Geheimnisse — sie identifizieren nur das Projekt und
   dürfen offen im Repository stehen. Der Schutz der Daten passiert über die
   Security Rules (siehe firestore.rules) und den Google-Login.

   So kommst du an die Werte:
     Firebase-Konsole → Projekteinstellungen (Zahnrad) → Allgemein →
     Abschnitt "Meine Apps" → Web-App → "SDK-Konfiguration" → npm/Config.

   Trage sie unten ein und ersetze damit die DEIN-...-Platzhalter.
--------------------------------------------------------------------------- */
export const firebaseConfig = {
  apiKey: "AIzaSyAeQhZmVxSLYSBcGyifBozKDkRURldS9U0",
  authDomain: "commitmenttracker-385b1.firebaseapp.com",
  projectId: "commitmenttracker-385b1",
  storageBucket: "commitmenttracker-385b1.firebasestorage.app",
  messagingSenderId: "647119632260",
  appId: "1:647119632260:web:4a03fb880e4a0f059b8fd1"
};

/* Wird von firebase.js geprüft: solange hier Platzhalter stehen, zeigt der
   Login-Screen einen verständlichen Hinweis statt eines Firebase-Fehlers. */
export const isConfigured = () =>
  Object.values(firebaseConfig).every(v => typeof v === "string" && v && !v.startsWith("DEIN"));

/* ---------------------------------------------------------------------------
   Schlüssel für Web-Push (Cloud Messaging). Ebenfalls nicht geheim — es ist
   der öffentliche Teil eines VAPID-Schlüsselpaars.

   Firebase-Konsole → Projekteinstellungen → Cloud Messaging →
   Abschnitt "Web-Konfiguration" → Web Push certificates → "Schlüsselpaar
   generieren". Der angezeigte Schlüssel gehört hier hinein.

   Ohne diesen Schlüssel bleibt die App voll funktionsfähig; es gibt dann nur
   die Erinnerung im Gerät statt echter Push-Nachrichten.
--------------------------------------------------------------------------- */
export const vapidKey = "DEIN-VAPID-KEY";

export const isPushConfigured = () =>
  typeof vapidKey === "string" && vapidKey.length > 20 && !vapidKey.startsWith("DEIN");
