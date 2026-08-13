"use strict";
/* ---------------------------------------------------------------------------
   Abendliche Push-Erinnerung.

   Läuft als geplanter GitHub-Actions-Workflow, nicht im Browser. Prüft für
   jeden Nutzer, ob seine Erinnerungszeit erreicht ist und heute noch etwas
   offen ist — und sendet nur dann.

   Zugang über einen Service-Account (GitHub-Secret FIREBASE_SERVICE_ACCOUNT).
   Das Admin-SDK umgeht die Security Rules; deshalb liest dieses Skript
   ausschließlich und schreibt nur den Merker lastPushed.

   Aufruf:  node scripts/send-reminders.mjs [--dry-run]
--------------------------------------------------------------------------- */
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

const DRY = process.argv.includes("--dry-run");
const FALLBACK_TZ = "Europe/Berlin";

/* Niemals den Inhalt des Secrets ausgeben — auch keinen Ausschnitt.
   Die Meldung von JSON.parse enthält ein Stück der Eingabe; stünde dort ein
   fehlerhafter Service-Account, landete privates Schlüsselmaterial im
   öffentlichen Actions-Log. Deshalb nur beschreiben, was erwartet wird. */
function abbruch(text) {
  console.error(text);
  console.error("Erwartet wird das komplette JSON aus: Firebase-Konsole → " +
    "Projekteinstellungen → Dienstkonten → \"Neuen privaten Schlüssel generieren\".");
  process.exit(1);
}

const raw = (process.env.FIREBASE_SERVICE_ACCOUNT || "").trim();
if (!raw) abbruch("FIREBASE_SERVICE_ACCOUNT fehlt. Als GitHub-Secret hinterlegen.");

if (!raw.startsWith("{")) {
  // Haeufige Verwechslung: der VAPID-Schluessel ist ein Base64-String mit "B".
  const vapidVerdacht = /^B[A-Za-z0-9_-]{40,}$/.test(raw);
  abbruch(vapidVerdacht
    ? "FIREBASE_SERVICE_ACCOUNT enthält offenbar den VAPID-Schlüssel statt des " +
      "Service-Accounts. Der VAPID-Schlüssel gehört nicht hierher, sondern in " +
      "firebase-config.js."
    : `FIREBASE_SERVICE_ACCOUNT ist kein JSON (beginnt mit "${raw[0]}" statt "{").`);
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(raw);
} catch (e) {
  abbruch(`FIREBASE_SERVICE_ACCOUNT ist kein gültiges JSON (${raw.length} Zeichen).`);
}
for (const feld of ["project_id", "client_email", "private_key"]) {
  if (!serviceAccount[feld]) abbruch(`Im FIREBASE_SERVICE_ACCOUNT fehlt das Feld "${feld}".`);
}

/* credential, nicht cert — mit dem falschen Schlüssel ignoriert das Admin-SDK
   den Service-Account stillschweigend und sucht nach Standard-Anmeldedaten. */
const adminApp = initializeApp({
  credential: cert(serviceAccount),
  projectId: serviceAccount.project_id
});

/* Gegen den Emulator laeuft alles auch ohne gueltige Anmeldung — deshalb hier
   ausdruecklich pruefen, dass wirklich eine Zugangsberechtigung haengt. */
if (!adminApp.options.credential) abbruch("Anmeldung am Projekt fehlgeschlagen.");
console.log(`Projekt ${serviceAccount.project_id}, angemeldet als ${serviceAccount.client_email}`);

const db = getFirestore();
const messaging = getMessaging();

/* ---------- Zeit in der Zeitzone des Nutzers ----------
   Bewusst über Intl statt über eine Bibliothek: Sommerzeit ist damit
   automatisch richtig, ohne Abhängigkeit. */
function localNow(timeZone) {
  const tz = timeZone || FALLBACK_TZ;
  let parts;
  try {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false
    }).formatToParts(new Date());
  } catch (e) {
    console.warn(`  unbekannte Zeitzone "${tz}", nutze ${FALLBACK_TZ}`);
    return localNow(FALLBACK_TZ);
  }
  const g = t => (parts.find(p => p.type === t) || {}).value;
  const hour = g("hour") === "24" ? "00" : g("hour");
  return { datum: `${g("year")}-${g("month")}-${g("day")}`, uhrzeit: `${hour}:${g("minute")}` };
}

/* Wie viele aktive Commitments gibt es, und wie viele sind noch offen? */
async function commitmentStand(uid, datum) {
  const snap = await db.collection("users").doc(uid).collection("habits").get();
  let aktiv = 0, offen = 0;
  snap.forEach(doc => {
    const h = doc.data() || {};
    if (h.archived) return;
    /* Was erst spaeter beginnt, ist heute weder offen noch verpasst.
       Alte Dokumente ohne startDate erben den Anlagetag. */
    const start = h.startDate || h.createdAt || "";
    if (start > datum) return;
    aktiv++;
    const c = h.completions || {};
    if (!c[datum]) offen++;
  });
  return { aktiv, offen };
}

/* Wortlaut der Erinnerung. Steht identisch in app.js für die Erinnerung, die
   das Gerät selbst auslöst — beides ist für dich dieselbe Abendmeldung. */
const TITEL = "Abend-Check-in";
const TEXT = "Hast du heute deine Commitments eingehalten?";

const TOTE_TOKEN = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument"
]);

async function main() {
  const users = await db.collection("users").get();
  console.log(`${users.size} Nutzer geprüft${DRY ? " (Probelauf, es wird nichts gesendet)" : ""}`);

  let gesendet = 0, uebersprungen = 0;

  for (const userDoc of users.docs) {
    const uid = userDoc.id;
    const u = userDoc.data() || {};
    const s = u.settings || {};

    if (!s.notify) { uebersprungen++; continue; }

    const { datum, uhrzeit } = localNow(s.timeZone);
    const ziel = typeof s.reminderTime === "string" ? s.reminderTime : "21:00";

    if (uhrzeit < ziel) { uebersprungen++; continue; }
    if (u.lastPushed === datum) { uebersprungen++; continue; }

    const { aktiv, offen } = await commitmentStand(uid, datum);

    /* Geräte immer mitlesen, auch wenn nichts offen ist: sonst sieht man im
       Probelauf nie, ob ueberhaupt ein Geraet angemeldet ist. Das ist ein
       Lesevorgang pro Nutzer und Lauf — vernachlaessigbar. */
    const tokenSnap = await db.collection("users").doc(uid).collection("tokens").get();
    const tokens = tokenSnap.docs.map(d => d.id).filter(Boolean);
    const geraete = `${tokens.length} Gerät(e) angemeldet`;

    if (aktiv === 0) {
      console.log(`${uid}: keine aktiven Commitments, ${geraete}`);
      uebersprungen++;
      continue;
    }
    if (offen === 0) {
      console.log(`${uid}: alles erledigt (${aktiv} aktiv), ${geraete} — keine Erinnerung`);
      // Merker trotzdem setzen, damit spaetere Laeufe heute nicht erneut pruefen.
      if (!DRY) await userDoc.ref.set({ lastPushed: datum }, { merge: true });
      uebersprungen++;
      continue;
    }
    if (!tokens.length) {
      console.log(`${uid}: ${offen} offen, aber kein Gerät angemeldet`);
      uebersprungen++;
      continue;
    }

    console.log(`${uid}: ${offen} von ${aktiv} offen, ${geraete}, lokal ${datum} ${uhrzeit} (Ziel ${ziel})`);
    if (DRY) { gesendet++; continue; }

    const res = await messaging.sendEachForMulticast({
      tokens,
      notification: { title: TITEL, body: TEXT },
      webpush: {
        notification: { title: TITEL, body: TEXT, icon: "icon-192.png", badge: "icon-192.png", tag: "ct-reminder" },
        fcmOptions: { link: "https://zyklustracker-a11y.github.io/commitmenttracker/" }
      }
    });

    // Abgelaufene Token wegräumen, sonst wächst die Liste endlos.
    const aufraeumen = [];
    res.responses.forEach((r, i) => {
      if (r.success) return;
      const code = (r.error && r.error.code) || "";
      console.warn(`  Token ${i + 1} fehlgeschlagen: ${code}`);
      if (TOTE_TOKEN.has(code)) {
        aufraeumen.push(db.collection("users").doc(uid).collection("tokens").doc(tokens[i]).delete());
      }
    });
    if (aufraeumen.length) {
      await Promise.all(aufraeumen);
      console.log(`  ${aufraeumen.length} abgelaufene(s) Token entfernt`);
    }

    if (res.successCount > 0) {
      await userDoc.ref.set({ lastPushed: datum }, { merge: true });
      gesendet++;
      console.log(`  gesendet an ${res.successCount} von ${tokens.length}`);
    } else {
      console.warn("  kein Gerät erreicht, lastPushed bleibt ungesetzt");
    }
  }

  console.log(`Fertig: ${gesendet} Erinnerung(en), ${uebersprungen} übersprungen`);
}

main().catch(err => { console.error(err); process.exit(1); });
