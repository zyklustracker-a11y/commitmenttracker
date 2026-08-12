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
  apiKey: "DEIN-API-KEY",
  authDomain: "DEIN-PROJEKT.firebaseapp.com",
  projectId: "DEIN-PROJEKT",
  storageBucket: "DEIN-PROJEKT.firebasestorage.app",
  messagingSenderId: "DEINE-SENDER-ID",
  appId: "DEINE-APP-ID"
};

/* Wird von firebase.js geprüft: solange hier Platzhalter stehen, zeigt der
   Login-Screen einen verständlichen Hinweis statt eines Firebase-Fehlers. */
export const isConfigured = () =>
  Object.values(firebaseConfig).every(v => typeof v === "string" && v && !v.startsWith("DEIN"));
