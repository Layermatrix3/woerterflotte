# WÖRTERFLOTTE

**Lerne. Ziele. Versenke.** Zwei Spieler beantworten Fremdwörter-Fragen, bevor sie auf die gegnerische Flotte schießen. Der Einzelspieler spielt gegen einen Computergegner mit drei Schwierigkeitsgraden.

## Lokal starten

Öffne im Projektordner ein Terminal. Mit vorhandenem Node.js startest du die Vorschau so:

```sh
node serve.mjs
```

Öffne [Wörterflotte auf localhost](http://127.0.0.1:8080/woerterflotte/). Alternativ funktioniert `python3 -m http.server 8080` mit [der Stammadresse](http://localhost:8080/). Ein Webserver ist nötig, damit der Browser die JavaScript-Module und den JSON-Katalog laden kann.

Einzelspieler, Lernmodus, Einstellungen und Lehrermodus starten ohne Firebase. Ein erfolgreicher Erstaufruf über HTTPS oder localhost ermöglicht auf unterstützten Browsern auch den Offline-Start. Auf dem iPad lässt sich die veröffentlichte Seite in Safari über **Teilen → Zum Home-Bildschirm** hinzufügen.

## Firebase einmalig einrichten

1. Erstelle in der [Firebase Console](https://console.firebase.google.com/) ein eigenes Projekt für das Spiel und registriere unter **Projekteinstellungen → Allgemein → Deine Apps** eine Web-App. Firebase Hosting brauchst du dafür nicht.
2. Öffne **Build → Authentication** und klicke auf **Jetzt starten**.
3. Aktiviere unter **Anmeldemethode** den Anbieter **Anonym**. Ergänze unter **Einstellungen → Autorisierte Domains** den Host deiner Pages-Adresse, etwa `mein-konto.github.io`. Für lokale Online-Tests ergänze den verwendeten Host, etwa `127.0.0.1` oder `localhost`. [Firebase-Anleitung zur anonymen Anmeldung](https://firebase.google.com/docs/auth/web/anonymous-auth)
4. Erstelle unter **Build → Realtime Database** eine Datenbank im **gesperrten Modus**. Kopiere anschließend die exakte Datenbank-URL aus der Konsole. [Firebase-Anleitung zur Realtime Database](https://firebase.google.com/docs/database/web/start)
5. Öffne den Reiter **Regeln**, ersetze den Inhalt durch `database.rules.json` und veröffentliche die Regeln.
6. Übertrage die fünf Werte der öffentlichen Web-App-Konfiguration nach `js/firebase-config.js`. Ergänze insbesondere `databaseURL` aus Schritt 4, falls sie in der Vorlage fehlt. Service-Account-Schlüssel und andere private Zugangsdaten gehören nicht ins Repository. [Firebase-Webkonfiguration](https://firebase.google.com/docs/web/setup)

## Auf GitHub Pages veröffentlichen

7. Erstelle ein Repository, etwa `woerterflotte`. Ein öffentliches Repository unterstützt GitHub Pages im kostenlosen Tarif.
8. Lade den **Inhalt** dieses Projektordners in die Wurzel des Branches `main`. Dort müssen `index.html`, `css/`, `js/`, `data/`, `assets/`, `manifest.json`, `sw.js` und `.nojekyll` liegen. Beim Upload per Git bleibt die Punktdatei erhalten.
9. Wähle **Settings → Pages → Deploy from a branch → main → / (root)** und speichere. Öffne die von GitHub angezeigte HTTPS-Adresse. [GitHub-Anleitung zur Veröffentlichungsquelle](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
10. Öffne die Adresse in Safari auf zwei iPads. Erstelle auf Gerät A eine Lobby und tritt auf Gerät B per Code oder QR-Link bei. Beide klicken auf **Bereit**. Gerät A startet das Spiel. Bestätige auf beiden Geräten die Flotten. Unterbrich während eines Schusses auf Gerät B die Verbindung und verbinde das Gerät wieder. Prüfe, ob der Schuss ausgewertet wird und die Partie weiterläuft. Lade die Seite danach neu und wähle im Hauptmenü **Partie fortsetzen**.

Für einen Test mit nur einem Rechner nutze zwei separate Browserprofile oder zwei unterschiedliche Browser. Tabs desselben Profils teilen sich standardmäßig die anonyme Firebase-Identität.

## Fragen und Lehrermodus

`data/fremdwoerter.json` enthält die 24 Tafelwörter mit Bedeutung, Lückensatz, falschen Optionen, zulässigen Varianten und Schwierigkeit. Daraus erzeugt das Spiel sechs Fragetypen mit 144 Fragen im vollständigen gemischten Grundkatalog. Die Reihenfolge und Optionen werden pro Partie gemischt. Eine Runde durch den Fragenstapel enthält jede passende Frage einmal.

Der Lehrermodus speichert Ergänzungen und eigene Fragen im Browser. Über **Vorgaben und Lehrerkatalog übernehmen** wird der Katalog bei der nächsten Partie vorausgewählt. Beim Erstellen einer Lobby kannst du diese Auswahl umschalten. Eine Lobby erhält eine feste Kopie des gewählten Katalogs.

## Online-Spiel und Datenschutz

- Die Datenbank enthält Spitznamen, anonyme Firebase-UIDs, Lobby-Zustand und Spielzüge. Der Code gewährt durch seine vier Stellen nur eine begrenzte Zugangshürde. Angemeldete Nutzer können eine wartende Lobby lesen, wenn sie ihren Code kennen. Eine Partie ist auf zwei Plätze beschränkt.
- Geheime Schiffspositionen bleiben im Browser, der sie platziert hat. Beim Schuss wertet der verteidigende Client das Zielfeld aus und übermittelt das Ergebnis. Während der Verteidiger offline ist, kann dieser Schuss erst nach seiner Rückkehr ausgewertet werden.
- Ein Seitenneuladen verwendet die anonyme Identität und die lokal gespeicherte Flotte weiter. Bei gelöschten Websitedaten oder einem Gerätewechsel fehlen diese Daten. Nach einer ausdrücklichen Auflösung endet die Lobby sofort.
- Lobbys laufen nach rund 24 Stunden ab. Erreicht der verbundene Gastgeber das Ablaufdatum, räumt sein Browser die Lobby auf. Neue Zuweisungen können abgelaufene Einträge überschreiben. Eine terminierte physische Löschung ohne aktiven Client setzt einen separaten vertrauenswürdigen Prozess voraus. Über die Realtime-Database-Konsole können alte Einträge bei Bedarf gelöscht werden.
- Die Datenbankregeln beschränken unter anderem Mitgliedschaft, Rollenwechsel, Phasen, Revisionen und Zielkoordinaten. Mit einem manipulierten Browser bleibt Betrug möglich. Die Clients kennen den Lösungskatalog, prüfen Antworten selbst und melden Treffer auf dem eigenen Feld. Firebase-Regeln können diese Ergebnisse nicht unabhängig nachrechnen. Für einen wettbewerbssicheren Modus wäre vertrauenswürdige serverseitige Spiellogik nötig.

## Tests

`node --test` prüft Platzierung, Fragen, Antwortfolgen, Zeitlimit, Treffer, Fehlschüsse, Versenkungen, Sieg, Spezialfähigkeiten, KI, Lehrerkatalog und relative Laufzeitdateien.

Im lokalen Firebase-Realtime-Database-Emulator wurde eine Zweispielerpartie mit separaten SDK-Clients und Testidentitäten geprüft, einschließlich Lobby, Zugriffsschutz, Anwesenheit, Wiederverbindung, Revanche und Auflösung. Der veröffentlichte Firebase-Zugriff mit anonymer Anmeldung, QR-Scan, iPad-Touch, Browserdarstellung und Offline-Start auf realen Geräten stehen als Praxistest nach der Einrichtung aus.

Der QR-Code wird lokal erzeugt. Enthalten ist `qrcode-generator` 1.4.4 von Kazuhiko Arase unter der [MIT-Lizenz](js/vendor/LICENSE).
