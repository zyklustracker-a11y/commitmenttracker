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

- Freie Zieldauer in Tagen oder unbegrenzt; „Ziel erreicht"-Zustand mit
  Weiterführen/Archivieren
- Historien-Datenmodell, Streaks werden berechnet
- Automatischer Tageswechsel, ehrliche Streak-Bruch-Anzeige
- Joker (pro Commitment konfigurierbar) rettet einen verpassten Tag
- Heatmap (16 Wochen) zum Nachtragen, Statistiken pro Commitment
- Analyse-Ebene mit Tagesring, Quote, Rekord, Verlauf
- Habit-Typen „Etwas tun" / „Etwas lassen", Archiv, Sortierung „Offene zuerst"
- Abendliche Erinnerung über die Notification-API

## Grenzen der Erinnerung (wichtig, ehrlich)

Die Erinnerung läuft derzeit im Gerät, nicht auf einem Server. Sie feuert zuverlässig,
wenn die App zur Erinnerungszeit offen ist, und beim nächsten Öffnen nach der
Erinnerungszeit, falls noch etwas offen ist. Garantierte Push-Nachrichten bei komplett
geschlossener App brauchen Firebase Cloud Messaging plus eine Cloud Function
(Scheduler) — das ist der nächste Ausbauschritt und setzt den Blaze-Plan voraus.

## Service Worker aktualisieren

Nach jeder Änderung an den ausgelieferten Dateien die Konstante `CACHE` in `sw.js`
hochzählen (aktuell `ct-v5`). Sonst holen installierte PWAs das Update nicht.
