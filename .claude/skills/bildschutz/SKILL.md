---
name: bildschutz
description: Prüfliste für den Schutz der Bilddaten in der Galerie (Schichten A–F aus docs/PLAN.md) – kein Netz, Originale unantastbar, Renderer ohne Dateizugriff, verschlüsselter Cache und Index-Daten lokal, Export ohne Standort, Lieferkette. Verwenden bei jeder Änderung, die Dateien liest oder schreibt, ein Protokoll, IPC, Cache, Log, Export, Abhängigkeit oder eine Netzwerk-Funktion berührt – und vor jedem Abschluss solcher Änderungen.
---

# Bildschutz

Die Galerie hat private Fotos (Gesichter, Wohnorte per GPS, Tagesabläufe per Datum) vor sich.
Jede Schicht unten hat einen **Nachweis**; eine Änderung, die eine Schicht berührt, braucht ihn
weiterhin grün. Schichten und Begründung: `docs/PLAN.md`, „Schutzkonzept für Bilddaten“.

## A – Nichts verlässt den Rechner

- [ ] Keine neue Netz-Funktion. `node:http`, `node:https`, `node:net`, `node:dgram`,
      `node:tls` und Electrons `net` sind im main per ESLint gesperrt – **Sperre nie lockern**,
      auch nicht „nur zum Testen“.
- [ ] Netzsperre in der Sitzung (`services/netzsperre.ts`) lässt nur App-Seite und eigene
      Protokolle durch; neue Protokolle dort und in der CSP eintragen, sonst nichts.
- [ ] Inhalte aus Bildern laden nichts nach: SVG nur als `<img>` oder über sharp gerastert,
      nie als Dokument/`<object>`; XMP/IPTC-Texte nur als Text darstellen (escapen).
- [ ] Keine externen Schriften, Skripte, Karten-Kacheln, Symbole – alles im Paket.
- [ ] Links in Metadaten (z. B. Urheber-URL) öffnen nur auf Klick im Standardbrowser und nur
      http(s) (Wächter aus der Mottulbox).
- **Nachweis:** E2E `netz` (lokaler Spion-Server, Testbilder mit Fremd-URLs in SVG/XMP; keine
  einzige Anfrage).

## B – Originale unantastbar

- [ ] Liest die Änderung nur? Dann öffnet sie Dateien **nur lesend**.
- [ ] Schreibt sie in Nutzerdateien? Dann ausdrücklich ausgelöst, Dateien in der Rückfrage bzw.
      Vorschau genannt, Ordner-Modus „nur lesen“ beachtet, Sicherung, atomar, nachgeprüft,
      Journal für Rückgängig (Skills `metadaten-schreiben`, `stapelverarbeitung`).
- [ ] Löschen nur über `shell.trashItem`; geht das nicht (Netzlaufwerk, Wechseldatenträger),
      ausdrückliche Rückfrage „endgültig löschen“ mit Anzahl.
- [ ] Keine Nebenprodukte im Ordner des Nutzers (`_original`, `Thumbs`, Temp-Dateien) – Zwischen-
      dateien entweder im App-Temp-Ordner oder als Nachbardatei, die immer weggeräumt wird.
- [ ] Fehlerpfade räumen auf (`finally`): halbe Ausgaben, Zwischennamen.
- **Nachweis:** E2E `originale` (Prüfsumme jeder Testdatei vor/nach dem ganzen Lauf; geändert
  sein dürfen nur die Dateien, die ein Schritt ausdrücklich ändert) und Pixel-Hash nach dem
  Schreiben von Metadaten.

## C – Renderer ohne Dateizugriff

- [ ] Kein `file://`, keine Pfade im Renderer-Zustand außer zur Anzeige (Pfad als Text).
- [ ] Bilder nur über `thumb://<id>/<stufe>` und `bild://<id>`; der Handler schlägt die Kennung im
      Index nach, prüft `realpath` innerhalb eines Bibliotheksordners (Symlinks/Junctions nach
      außen!) und dass die Datei zum Index passt.
- [ ] Jeder IPC-Eingang geprüft: Typ, Allowlist, Grenzen (Skill `ipc-kanal`). Pfade, in die
      geschrieben wird, stammen aus einem Dialog des main oder aus dem Index, nie direkt vom Renderer.
- [ ] Fenster nur über `secureWebPreferences` (Sandbox, contextIsolation, kein Node, keine Webviews).
- **Nachweis:** Unit-Tests der Protokolle (erfundene Kennung, `..`, `%2e%2e`, Symlink nach
  außen, Datei inzwischen getauscht) und E2E `security`.

## D – Abgeleitete Daten geschützt

- [ ] Index und Cache unter `%LOCALAPPDATA%\<App>\` (nicht Roaming, nicht im Bibliotheksordner).
- [ ] Vorschaubilder **nur verschlüsselt** auf die Platte: AES-256-GCM, zufälliger Nonce je
      Datei, Schlüssel per `safeStorage` (DPAPI) geschützt; beim Lesen Tag prüfen – manipuliert =
      neu erzeugen, nie anzeigen.
- [ ] Ordner „privat“: keine Vorschaubilder auf der Platte (nur Arbeitsspeicher).
- [ ] Ordner entfernen / Cache leeren löscht wirklich alles Abgeleitete (Zeilen, FTS, Dateien,
      Journal-Einträge mit Werten nach Einstellung).
- [ ] **Log ohne Inhalte:** Kennungen und Fehlercodes, Pfade nur wo nötig; nie GPS, Titel,
      Beschreibungen, Stichwörter, Personen. Fehlermeldungen an den Nutzer dürfen Pfade nennen.
- **Nachweis:** Unit-Test der Verschlüsselung (falscher Schlüssel, ein Byte gekippt); E2E: keine
  Datei im Cache beginnt mit der JPEG-Signatur `FF D8 FF`; Log nach dem E2E-Lauf enthält keine
  Koordinate aus den Testbildern.

## E – Weitergeben ohne Spuren

- [ ] Export ab Werk **ohne Standort**; Profile „ohne Seriennummern/Besitzer“ und „ohne alle
      Metadaten“; die Vorschau des Exports sagt, was mitgeht.
- [ ] Kopieren in die Zwischenablage / Ziehen nach außen: gleiche Vorgabe wie Export, wenn
      dabei eine neue Datei entsteht.
- **Nachweis:** Labortest – exportierte Datei per ExifTool lesen, keine `GPS*`-Tags,
  `SerialNumber`-Felder nach Profil.

## F – Lieferkette und Programm

- [ ] Neue Abhängigkeit? Nur, wenn nötig; ohne Install-Skript; exakt gepinnt; ≥ 7 Tage alt
      (Skill `abhaengigkeiten`); Laufzeit-Abhängigkeit in `docs/SICHERHEIT.md` begründen.
- [ ] Gebündelte Programme (ExifTool) nur aus offizieller Quelle mit Prüfsumme.
- [ ] Bildverarbeitung bleibt im Bilddienst (eigener Prozess), mit Zeitlimit je Datei.
- **Nachweis:** CI `npm audit --omit=dev` ohne Befund, Prüfsummen in `scripts/`.

## Entwicklung

- **Nie echte Fotos** in Repository, Tests, Fixtures, Screenshots von Fehlern oder Issues –
  Testbilder aus `scripts/testbilder.mjs`.
- Neue Schicht-Regel gefunden (z. B. im Review)? Hier ergänzen und in `docs/SICHERHEIT.md`.
