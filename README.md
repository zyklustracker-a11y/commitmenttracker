# Commitment Tracker (PWA)

Persönlicher Habit- und Commitment-Tracker im abgenommenen Design 4 (warme Farbwelt, Editorial-Zeilen, Analyse-Ebene). Läuft komplett lokal im Browser, keine Server nötig. Firebase/Firestore und Google Login folgen als nächster Ausbauschritt.

## Dateien

- `index.html` — die komplette App (UI, Logik, Datenhaltung)
- `manifest.webmanifest` — macht die App installierbar (PWA)
- `sw.js` — Service Worker für Offline-Betrieb und Benachrichtigungen
- `icon-192.png`, `icon-512.png` — App-Icons

## Auf GitHub Pages veröffentlichen

1. Neues Repository auf GitHub anlegen (z. B. `commitment-tracker`).
2. Alle Dateien aus diesem Ordner ins Repository hochladen (Weboberfläche: "Add file → Upload files" — oder per git push).
3. Im Repository: Settings → Pages → unter "Build and deployment" als Source **Deploy from a branch** wählen, Branch `main`, Ordner `/ (root)`, speichern.
4. Nach 1–2 Minuten ist die App unter `https://DEIN-NAME.github.io/commitment-tracker/` erreichbar.

GitHub Pages liefert automatisch HTTPS — das ist Voraussetzung für Service Worker und Benachrichtigungen.

## Auf dem Handy installieren

- **Android (Chrome):** Seite öffnen → Menü (⋮) → "App installieren" bzw. "Zum Startbildschirm hinzufügen".
- **iPhone (Safari):** Seite öffnen → Teilen-Symbol → "Zum Home-Bildschirm". Erst danach sind Benachrichtigungen möglich (iOS 16.4+). In der App dann Einstellungen → Abendliche Erinnerung aktivieren und die Berechtigung erlauben.

## Was die App kann

- Freie Zieldauer in Tagen oder unbegrenzt; "Ziel erreicht"-Zustand mit Weiterführen/Archivieren
- Historien-Datenmodell: jeder Tag wird gespeichert, Streaks werden daraus berechnet (kein Tageswechsel-Bug, Abhaken sauber rückgängig machbar)
- Automatischer Tageswechsel, ehrliche Streak-Bruch-Anzeige
- Joker (konfigurierbar pro Monat) rettet einen verpassten Tag; gestern nachtragen möglich
- Heatmap (16 Wochen) und Statistiken pro Commitment; Analyse-Ebene mit Tagesring, Quote, Rekord, Verlauf
- Habit-Typen "Etwas tun" / "Etwas lassen"
- Archiv, Sortierung "Offene zuerst", Einstellungen
- Joker-Kontingent pro Commitment einstellbar; Einsatz immer erst nach Rückfrage
- Rückwirkendes Nachtragen über die antippbare Heatmap; Verlauf (Start/Ziel/Brüche/Neustarts) in der Analyse
- Abendliche Erinnerung über die Notification-API

## Grenzen der Erinnerung (wichtig, ehrlich)

Ohne Server kann eine Web-App nur erinnern, solange sie installiert ist und vom System gelegentlich geweckt wird bzw. offen war. Konkret: Die Erinnerung feuert zuverlässig, wenn die App zur Erinnerungszeit offen ist, und beim nächsten Öffnen nach der Erinnerungszeit, falls noch etwas offen ist. Garantierte Push-Nachrichten bei komplett geschlossener App kommen im Firebase-Schritt (Cloud Messaging).

## Wo liegen die Daten? (wichtig)

Aktuell speichert die App alles **nur lokal im Browser** (localStorage) auf dem jeweiligen Gerät. Es gibt noch **keine** Synchronisierung mit einer Datenbank oder deinem Google-Konto — die kommt erst im Firebase-Schritt. Bis dahin: Browserdaten der Seite nicht löschen, sonst sind die Einträge weg.

## Bestehende Daten

Alte Daten aus der ersten Version (localStorage-Schlüssel `habits`) werden beim ersten Start automatisch übernommen: Der aktuelle Streak wird als Historie zurückgerechnet, der Rekord bleibt erhalten.

## Nächste Schritte (später)

1. Firebase-Projekt + Firestore, Datenmodell 1:1 übernehmen (`habits` mit `completions`-Map)
2. Google Login (Firebase Auth)
3. Firebase Cloud Messaging für echte Push-Erinnerungen
