# Commitment Tracker (PWA)

Persönlicher Habit- und Commitment-Tracker im abgenommenen Design 4 (warme Farbwelt,
Editorial-Zeilen, Analyse-Ebene). Vanilla JS in ES-Modulen, kein Framework, kein
Build-Schritt. Daten liegen in Firebase (Google-Login + Firestore) und funktionieren
vollständig offline.

## Dateien

| Datei | Zweck |
| --- | --- |
| `index.html` | Gerüst, Styles, Login- und Startbildschirm |
| `app.js` | UI und Logik (Views, Berechnungen, Aktionen) |
| `store.js` | Datenschicht: Firestore-Live-Sync, Schreiben, Migration |
| `firebase.js` | Firebase-Init, Google-Login, Firestore mit Offline-Kopie |
| `firebase-config.js` | Projektdaten (nicht geheim) |
| `dates.js` | Datumsrechnung, bewusst lokal statt UTC |
| `vendor/` | Firebase Web SDK 11.10.0, lokal statt vom CDN |
| `sw.js` | Service Worker: Offline-Betrieb und Benachrichtigungen |
| `firestore.rules` | Zugriffsregeln |
| `manifest.webmanifest`, `icon-*.png` | macht die App installierbar |

Das SDK liegt absichtlich lokal unter `vendor/`: so startet die App auch ohne Netz,
ohne von einem CDN abzuhängen. Die absoluten gstatic-Importe in den Bundles wurden
dafür auf relative Pfade umgeschrieben — beim Aktualisieren des SDK daran denken.

## Einrichtung in Firebase

Projekt: **commitmenttracker-385b1**

1. **Firestore** in Native Mode anlegen (erledigt).
2. **Authentication → Google** aktivieren (erledigt).
3. **Autorisierte Domains** (Authentication → Settings → Authorized domains):
   `zyklustracker-a11y.github.io` eintragen. Ohne diesen Eintrag verweigert der
   Google-Login auf GitHub Pages den Dienst.
4. **Security Rules** aus `firestore.rules` in der Konsole unter Firestore → Regeln
   einfügen und veröffentlichen — oder per CLI:

   ```
   firebase deploy --only firestore:rules
   ```

## Auf GitHub Pages veröffentlichen

Läuft bereits — unter Settings → Pages ist als Source **GitHub Actions** eingestellt.
Der Workflow `.github/workflows/pages.yml` lädt bei jedem Push auf `main` das
Wurzelverzeichnis hoch und veröffentlicht es. Kein manueller Schritt mehr nötig:

```
https://zyklustracker-a11y.github.io/commitmenttracker/
```

Den Fortschritt eines Deployments siehst du im Reiter *Actions*.

Alle Pfade in der App sind relativ, der Unterpfad `/commitmenttracker/` ist damit
kein Problem: `manifest.webmanifest` nutzt `"start_url": "./"` und `"scope": "./"`,
der Service Worker wird als `sw.js` registriert und cached `"./"`-Pfade. GitHub Pages
liefert HTTPS, das ist Voraussetzung für Service Worker und Benachrichtigungen.

## Auf dem Handy installieren

- **Android (Chrome):** Seite öffnen → Menü (⋮) → „App installieren".
- **iPhone (Safari):** Seite öffnen → Teilen → „Zum Home-Bildschirm". Erst danach
  sind Benachrichtigungen möglich (iOS 16.4+).

### Login in der installierten PWA

Der Login läuft überall über `signInWithPopup`, auch in der installierten App.
`signInWithRedirect` bleibt nur der Notnagel, falls das Popup gar nicht erst
aufgeht — verlassen sollte man sich darauf nicht: iOS startet die PWA nach der
Rückkehr von Google oft neu ab `start_url`, womit der Zwischenstand für
`getRedirectResult` verloren geht, und Safari blockiert zusätzlich den
Storage-Zugriff auf die `authDomain`, weil `*.firebaseapp.com` eine Fremddomain
ist. Der Redirect endet dann still wieder auf dem Login-Screen.

Wer das dauerhaft sauber lösen will, braucht eine eigene Domain als `authDomain`
(Firebase Hosting oder ein Proxy auf `/__/auth/`) — auf GitHub Pages geht das nicht,
weil dort nur statische Dateien liegen.

## Wo liegen die Daten?

In Firestore, unter deinem Google-Konto:

```
users/{uid}                    → { settings, migratedFromLocal }
users/{uid}/habits/{habitId}   → ein Dokument pro Commitment,
                                 completions als Map "YYYY-MM-DD" → "done" | "joker"
```

Streaks, Rekorde, Quoten und der Verlauf werden **nie gespeichert**, sondern immer
aus `completions` berechnet. Dadurch gibt es keinen Tageswechsel-Bug, und Abhaken
lässt sich sauber rückgängig machen.

`createdAt` ist der Anlagetag und bleibt unverändert. Der **offizielle Beginn** steht
in `startDate` und ist frei wählbar — beim Anlegen und später über „Bearbeiten".
Alles, was zählt (Heatmap, Quote, Verlauf, Joker, Erinnerung), richtet sich nach
`startDate`; Dokumente aus der Zeit davor erben den Anlagetag.

Die Security Rules erlauben ausschließlich `request.auth.uid == userId`. Alles andere
ist verboten, weil Firestore jeden Pfad ohne passende Regel abweist.

## Offline

Firestore läuft mit `persistentLocalCache` und Multi-Tab-Manager. Das heißt:

- Anzeigen **und** Eintragen funktionieren ohne Netz, auch nach einem Neustart der App.
- Änderungen landen zuerst lokal und werden automatisch synchronisiert, sobald wieder
  Verbindung besteht. Es gibt bewusst keinen eigenen Sync-Code.
- Für die allererste Anmeldung wird einmal Netz gebraucht; danach hält die Sitzung.

## Bestehende Daten

Beim ersten Login wandern vorhandene localStorage-Daten automatisch nach Firestore —
`ct_data_v2`, und falls das fehlt, das Alt-Format unter `habits` (v1, aktueller Streak
wird als Historie zurückgerechnet, Rekord bleibt erhalten). Die lokale Kopie wird
danach als `ct_data_v2_migrated` **umbenannt statt gelöscht**, als Sicherheitsnetz.
Ein Merker im Nutzerdokument verhindert, dass ein zweiter Start noch einmal migriert.

## Was die App kann

- Startdatum frei wählbar: Heute, Morgen oder ein Datum — wer abends etwas eingeht,
  das er heute schon gebrochen hat, lässt es morgen beginnen; heute ist dann weder
  offen noch verpasst. Nachträglich änderbar.
- Rückwirkender Start trägt die Tage bis gestern gleich als erledigt ein, sodass
  Streak, Rekord und Quote sofort stimmen („seit fünf Tagen dabei" → Tag 5). Heute
  bleibt offen zum Abhaken, das Nachtragen lässt sich abwählen, und Lücken innerhalb
  der bisherigen Laufzeit bleiben Lücken.
- Freie Zieldauer in Tagen oder unbegrenzt; „Ziel erreicht"-Zustand mit
  Weiterführen/Archivieren
- Historien-Datenmodell, Streaks werden berechnet
- Automatischer Tageswechsel, ehrliche Streak-Bruch-Anzeige
- Joker (pro Commitment konfigurierbar) rettet einen verpassten Tag
- Heatmap (16 Wochen) zum Nachtragen, Statistiken pro Commitment
- Analyse-Ebene mit Tagesring, Quote, Rekord, Verlauf
- Habit-Typen „Etwas tun" / „Etwas lassen", Archiv, Sortierung „Offene zuerst"
- Abendliche Erinnerung über die Notification-API

## Erinnerungen

Zwei Wege, die sich ergänzen:

1. **Im Gerät** (`scheduleReminder` in `app.js`) — feuert, wenn die App zur
   Erinnerungszeit offen ist, und beim nächsten Öffnen danach, falls noch etwas
   offen ist. Funktioniert ohne Server, aber nicht bei geschlossener App.
2. **Echtes Push** über Firebase Cloud Messaging — auch bei geschlossener App.

Die Geräteseite für Push ist fertig: `messaging.js` holt beim Einschalten des
Schalters ein FCM-Token und legt es unter `users/{uid}/tokens/{token}` ab; beim
Ausschalten wird es dort und bei FCM gelöscht. Der Service Worker zeigt
eintreffende Nachrichten im `push`-Handler an. Läuft die App gerade, übernimmt
`onPushWhileOpen` und zeigt einen Toast statt einer Systemmeldung.

Bewusst kein zweiter Service Worker: die übliche `firebase-messaging-sw.js` würde
`sw.js` im selben Scope ablösen. Der `push`-Handler liest die Nutzlast direkt.

### Der Versand

`scripts/send-reminders.mjs` läuft als geplanter GitHub-Actions-Workflow
(`.github/workflows/reminder.yml`), viertelstündlich. Für jeden Nutzer prüft er:
Schalter an? Erinnerungszeit in **dessen** Zeitzone erreicht? Heute noch nicht
erinnert? Noch etwas offen? Nur wenn alles zutrifft, geht eine Nachricht raus.
Abgelaufene Token werden dabei aufgeräumt.

Bewusst über GitHub Actions statt Cloud Functions: das kostet nichts und braucht
keinen Blaze-Plan. Der Preis dafür ist ungenaues Timing — GitHub führt geplante
Workflows unter Last einige Minuten später aus. Für eine Abenderinnerung genügt
das; punktgenau geht nur mit Cloud Scheduler (Blaze).

Schlägt der Versand fehl, bleibt `lastPushed` ungesetzt und der nächste Lauf
versucht es erneut.

**Einrichtung (einmalig):**

1. Firebase-Konsole → Projekteinstellungen → **Dienstkonten** → „Neuen privaten
   Schlüssel generieren". Es lädt eine JSON-Datei herunter.
2. GitHub → Settings → Secrets and variables → Actions → **New repository
   secret**, Name `FIREBASE_SERVICE_ACCOUNT`, Inhalt: das **komplette JSON**.
3. VAPID-Schlüssel in `firebase-config.js` eintragen (siehe Kommentar dort).

Der private Schlüssel gehört ausschließlich in das Secret, **niemals** ins
Repository — das hier ist öffentlich.

Zum Ausprobieren: Actions → „Abend-Erinnerung" → *Run workflow* → Haken bei
„Nur pruefen, nichts senden". Der Probelauf zeigt in der Ausgabe, wer eine
Erinnerung bekommen würde, ohne etwas zu senden.

Solange VAPID-Schlüssel oder Secret fehlen, bleibt die App voll funktionsfähig —
es gibt dann nur die Erinnerung im Gerät. `enablePush()` scheitert leise und
protokolliert den Grund.

### Grenzen auf iOS (wichtig, ehrlich)

Web-Push gibt es auf dem iPhone erst ab **iOS 16.4** und ausschließlich in der über
„Teilen → Zum Home-Bildschirm" **installierten** PWA. Im normalen Safari-Tab meldet
`isSupported()` false — das ist kein Fehler, sondern die Plattform. Zusätzlich
vergibt iOS Push-Berechtigungen nur nach einer echten Nutzergeste, deshalb fragt die
App ausschließlich über den Schalter in den Einstellungen und nie beim Start.

## Service Worker aktualisieren

Nichts zu tun. Im Repository steht `const CACHE = "ct-dev";`, und der
Pages-Workflow ersetzt das beim Deployment durch die Commit-Kennung
(`ct-1d1c1b8` o. Ä.). Jede Änderung bekommt damit automatisch einen frischen
Cache, und installierte PWAs ziehen das Update.

Verschwindet der Platzhalter aus `sw.js`, bricht das Deployment mit einer
deutlichen Meldung ab — sonst bliebe die Cache-Version stillschweigend gleich
und Updates kämen nicht mehr an.

Nebenwirkung: auch ein Commit, der nur diese README ändert, erzeugt eine neue
Cache-Version und lässt die PWA einmal neu laden. Das ist der Preis dafür, dass
keine echte Änderung durchrutschen kann.
