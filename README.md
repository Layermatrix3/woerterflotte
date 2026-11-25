# WÖRTERFLOTTE

**Lerne. Ziele. Versenke.** Zwei Spieler beantworten Fremdwörter-Fragen, bevor sie auf die gegnerische Flotte schießen. Der Einzelspieler spielt gegen einen Computergegner mit drei Schwierigkeitsgraden.

## Online spielen

Öffne [Wörterflotte auf GitHub Pages](https://layermatrix3.github.io/woerterflotte/). Wähle **Lobby erstellen**, gib deinen Namen ein und teile den sechsstelligen Raumcode, den Einladungslink oder den QR-Code. Die zweite Person wählt **Lobby beitreten** oder öffnet den Einladungslink. Beide klicken auf **Bereit**. Der Gastgeber startet die Partie.

Der Online-Modus nutzt wie Komma-Sprung PeerJS für den Verbindungsaufbau und WebRTC für die Spielzüge. Beide Geräte brauchen Internet. Bei restriktiven WLAN- oder Firewall-Einstellungen kann die direkte Verbindung scheitern. Im laufenden Spiel hält der Gastgeber seinen Browser geöffnet. Nach einem Neuladen kann er über **Partie fortsetzen** seinen lokal gespeicherten Raum wieder öffnen. Für zwei Testspieler am selben Rechner sind zwei getrennte Browserprofile erforderlich.

## Lokal starten und veröffentlichen

Mit vorhandenem Node.js startest du im Projektordner eine Vorschau:

```sh
node serve.mjs
```

Öffne danach [die lokale Vorschau](http://127.0.0.1:8080/woerterflotte/). Ein Webserver ist nötig, damit der Browser die JavaScript-Module und den JSON-Katalog laden kann.

Für eine eigene GitHub-Pages-Kopie lege die Dateien im Quellbranch ab und wähle **Settings → Pages → Deploy from a branch → main → / (root)**. Alle Laufzeitpfade sind relativ. [GitHub-Anleitung zur Veröffentlichungsquelle](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

Ein erfolgreicher Erstaufruf über HTTPS oder localhost ermöglicht auf unterstützten Browsern den Offline-Start für den Einzelspieler und den Lernbereich. Auf dem iPad lässt sich die veröffentlichte Seite in Safari über **Teilen → Zum Home-Bildschirm** hinzufügen.

## Spielmodi

Im Modus **Schiffeversenken ohne Fragen** darfst du sofort schießen. Die Lernmodi bieten Fremdwörter, Deutsch (Artikel und Mehrzahl), Mathe (Kopfrechnen) und Englisch (Vokabeln). Nach einem Treffer bleibst du dran und löst im Lernmodus die nächste Aufgabe. Fehlschuss, falsche Antwort und Zeitablauf geben den Zug ab.

## Fragen und Lehrermodus

`data/fremdwoerter.json` enthält 100 Fremdwörter, darunter die 24 ursprünglichen Tafelwörter. Daraus erzeugt das Spiel sechs Fragetypen mit 600 Fragen im vollständigen gemischten Grundkatalog. Die Reihenfolge und Optionen werden pro Partie gemischt.

Der Lehrermodus speichert Ergänzungen und eigene Fragen im Browser. Über **Vorgaben und Lehrerkatalog übernehmen** wird der Katalog bei der nächsten Partie vorausgewählt. Beim Erstellen einer Lobby kannst du diese Auswahl umschalten. Eine Lobby erhält eine feste Kopie des gewählten Katalogs.

## Spielstand und Datenschutz

- Die Browser teilen Spitznamen, den verwendeten Fragenkatalog und den öffentlichen Spielstand. Die ungetroffenen Schiffspositionen bleiben beim jeweiligen Spieler. Der verteidigende Browser meldet Treffer und Versenkungen für den angefragten Zug.
- Der Gastgeber verwaltet die Zugfolge und speichert die Partie lokal. Eine kurze Unterbrechung kann der Gast durch Wiederverbinden überbrücken. Bei gelöschten Websitedaten oder einem Gerätewechsel fehlen die lokalen Spielstände.
- Nach rund 24 Stunden läuft ein Raum ab. Der Raumcode ist eine Einladung für ein Unterrichtsspiel. Die beteiligten Browser kennen die Fragenlösungen und berichten Treffer auf der eigenen Flotte. Gegen manipulierte Browser wäre vertrauenswürdige serverseitige Spiellogik nötig.

## Tests

`node --test` prüft Platzierung, Fragen, Zugfolge, Zeitlimit, Spezialfähigkeiten, KI, Lehrerkatalog, QR-Erzeugung und Peer-Nachrichten. Der Peer-Test verwendet simulierte Datenkanäle. Ein gemeinsamer Test auf zwei iPads prüft den öffentlichen Signalisierungsdienst und das jeweilige WLAN.

Der QR-Code wird lokal erzeugt. Enthalten ist `qrcode-generator` 1.4.4 von Kazuhiko Arase unter der [MIT-Lizenz](js/vendor/LICENSE).
