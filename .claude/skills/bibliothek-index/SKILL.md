---
name: bibliothek-index
description: Bibliothek von Galeria Beata bauen oder ändern – Ordner und Ordner-Modi, Scan, Überwachen (fs.watch, Netzlaufwerke), Bilddienst (utilityProcess), Index-Schema in SQLite mit Migrationen, Aufnahmedatum und GPS ermitteln, Sortier-/Filter-/Gruppier-Abfragen, Vorschaubild-Reihenfolge, Leistung bei 100.000 Bildern. Verwenden, bevor an services/library/, services/bilddienst/, db.ts, sortFilter.ts, dates.ts, geo.ts oder dem Galerie-Raster gearbeitet wird.
---

# Bibliothek und Index

Der Index ist eine **Kopie** dessen, was in den Dateien steht – nie die Wahrheit. Alles muss
sich aus den Dateien neu aufbauen lassen (außer Journal und Bearbeitungsrezepten).

## Wo was liegt

| Was | Ort |
|---|---|
| Datenbank, Schema, Migrationen (`PRAGMA user_version`) | `src/main/services/db.ts` (WAL, defekte DB sichern und neu anlegen, neuere DB nie anfassen) |
| Lokaler Datenordner (`%LOCALAPPDATA%\Galeria Beata`) | `src/main/services/lokaleDaten.ts` |
| Index-Zugriffe (Ordner, Stapel, Abgleich, Metadaten-Warteschlange, Abfragen) – nur SQL | `src/main/services/library/repo.ts` + Test |
| Ordner hinzufügen/entfernen, Modus, Warteschlangen (Einlesen, Metadaten), Zustand für den Renderer | `src/main/services/library/library.ts` |
| Grundfelder aus ExifTool-Tags prüfen (rein) | `src/shared/grundfelder.ts` + Test |
| Vorschaubilder erzeugen (Datei prüfen, sharp, BMP über ffmpeg, verschlüsselt ablegen) – im Bilddienst | `src/main/services/bilddienst/vorschau.ts` + `vorschau.lab.test.ts` |
| Warteschlange der Vorschaubilder, Abruf für `thumb://`, Ordner „privat“/entfernen | `src/main/services/library/vorschauen.ts` (Test in `library.test.ts`) |
| Cache: Ablage, AES-256-GCM, Schlüssel (`safeStorage`), Arbeitsspeicher für „privat“ | `src/main/services/cache/` + Tests |
| Nutzerdatei vor dem Lesen prüfen (passt zum Index, echter Pfad im Ordner, Zeitlimit) – Bilddienst und main | `src/main/services/dateien/pruefeDatei.ts` (Test in `vorschau.lab.test.ts`) |
| `bild://` nachschlagen: Pfad zum Streamen oder Umrechnung (TIFF) aus dem Bilddienst, Speicher-LRU | `src/main/services/library/anzeige.ts` + Test; Adresse/`Range` rein in `src/shared/bild.ts` |
| `thumb://`-Adressen, Stufen, Version des Verfahrens (rein); Protokoll-Handler | `src/shared/vorschau.ts` + Test; `src/main/services/protocols/thumb.ts` |
| Bilddienst: Einstieg, Scan, Nachrichten, Client mit Neustart | `src/main/services/bilddienst/` (`einstieg.ts`, `scan.ts`, `protokoll.ts`, `client.ts`) |
| Formate, Scan-Regeln, Pfad-Schlüssel, Namens-Sortierschlüssel (rein) | `src/shared/bildFormate.ts`, `scanRegeln.ts`, `ordnerPruefen.ts`, `sortKey.ts` |
| Sortieren/Filtern/Gruppieren → SQL-Bausteine (rein; 1.2: Sortieren) | `src/shared/sortFilter.ts` + Test |
| Aufnahmedatum (Rangfolge, Zeitzone) | `src/shared/dates.ts` + Test |
| Entfernung, nächster Ort (rein, Phase 2) | `src/shared/geo.ts` + Test |

Umgesetzt in 1.1: Schema 1, Scan im Bilddienst, Abgleich mit Scan-Nummer, „fehlt“ /
„nicht erreichbar“, Pfad-Schlüssel ohne Groß/Klein (Windows), Ordner-Überlappung abgelehnt.
Umgesetzt in 1.2: Schema 2 (`format`, vorläufiges Dateidatum, Indizes je Sortierung, Teilindex
für die Metadaten-Warteschlange), ExifTool-Pool im Bilddienst, Warteschlange der Grundfelder in
`library.ts` (Stapel zu 200; schreibt nur, wenn Größe und Änderungszeit noch stimmen; scheitert
ein Stapel – Absturz, Zeitlimit –, werden die Lücken einzeln nachgelesen, und nur eine Datei, die
auch allein scheitert, gilt als gelesen mit Dateidatum; ein nicht erreichbarer Ordner bleibt offen;
Test `library.test.ts`), Abfrage der Kennungen und
Details. ExifTool beendet sich selbst, wenn der Bilddienst stirbt (stdin endet; geprüft mit
hartem Kill) – es bleiben keine verwaisten Prozesse.
Umgesetzt in 1.3: Schema 3 (`color`, Teilindex `images_thumb_offen`), Vorschaubilder im Bilddienst
(halbe Thread-Zahl parallel, Datei erst in den Speicher gelesen, Zeitlimit 30 s je Datei),
`thumb_state` (NULL = offen, `ok`, sonst Grund: `defekt`, `zu-gross`, `abgelehnt`,
`kein-werkzeug`), Warteschlange mit Vorrang für Abrufe und Cursor je Runde (eine gerade
gesperrte Datei kommt erst in der nächsten Runde wieder), zweiter Absturz an einer Datei = defekt,
Ergebnisse nur bei unveränderter Datei eingetragen (sonst Cache-Dateien wieder gelöscht).
Neuer Schlüssel beim Start (kein sicherer Speicher wie Linux ohne Schlüsselbund, oder DPAPI
entschlüsselt nicht mehr): Der Cache ist leer – alle `ok` werden wieder offen und entstehen im
Hintergrund neu, nicht nur auf Abruf (`library.test.ts`, gefunden über die Linux-CI).
Umgesetzt in 1.5: `bild://id/<kennung>` (Original gestreamt mit `Range`, TIFF als Umrechnung
`anzeigeFuer` im Bilddienst, höchstens 3840 px, nur im Arbeitsspeicher, 64 MB), Papierkorb
(`inPapierkorb` in `library.ts`: Rückfrage, nach der Rückfrage frische Zeilen aus dem Index, je
Datei `pruefeDatei` mit Zeitlimit und `shell.trashItem`, dann `bilderEntfernen` samt Vorschau- und
Anzeige-Cache). Wer Bilder aus dem Index nimmt, wirft auch `anzeigeVerwerfen(ids)`.
Umgesetzt in 1.6: Überwachen – Wächter im Bilddienst (`beobachter.ts`: `fs.watch` rekursiv,
Sammeln 300 ms/2 s, `pfadeZusammenfassen`: Unwichtiges weg, Unterpfade unter gemeldeten Ordnern
weg, mehr als 50 Einträge eines Ordners → der Ordner, mehr als 500 → ganzer Abgleich),
Teil-Scan `scanneTeile` (folgt keiner Verknüpfung, auch nicht auf dem Weg), `teilAbschliessen`
(nur unter den Pfaden, `last_scan` bleibt), Verschoben-Erkennung in beiden Abschlüssen (neue
Zeile mit gleicher Endung, Größe und Änderungszeit wie genau eine verschwundene oder schon
fehlende → die alte übernimmt den Pfad; `hoechsteKennung` vor dem Scan merken; die neue fällt
weg, ihre Vorschaubilder auch). `ueberwachen.ts`: live/periodisch (Netz per `realpath` → UNC),
30-s-Takt (nicht erreichbar → erneut; periodisch nach 5 min; live → nur Erreichbarkeit), Fokus,
Neustart des Dienstes legt die Wächter neu an, dreimal Wächter verloren in 10 min → periodisch.
**Gemessen:** Windows meldet das Löschen des beobachteten Ordners als Endlos-Sturm absoluter Pfade
(`\\?\C:\…`) statt als Fehler; Änderungen über einen Hardlink außerhalb des Ordners meldet
`fs.watch` nicht (genutzt im E2E `galerie` für 409). Schon das **Lesen** einer Datei meldet
Windows als „change“ (Datei und Ordner), sobald ihre letzte Zugriffszeit älter als eine Stunde ist
(Standard „vom System verwaltet“) – darum zählt „change“ nur für Dateien und nur, wenn sich Größe
oder Änderungszeit gegenüber dem eigenen Lesen geändert haben (`gelesenMerken` im Bilddienst);
sonst lösten ExifTool und Vorschaubilder beim ersten Einlesen je einen ganzen Abgleich aus.
**Gemessen mit 50.000 Bildern:** Ein UPSERT je Zeile kostete 47 ms je Stapel (7 s main-Zeit je
ganzem Abgleich) – unveränderte Dateien markiert `stapelSchreiben` jetzt nur als gesehen (2 ms).
Stapel des Bilddienstes kamen schneller, als der main sie schrieb, stauten sich und liefen am Stück
(bis 6,8 s Stillstand, Neustart 18 s bis zur Galerie) – der Client arbeitet Nachrichten einzeln
mit `setImmediate` dazwischen ab. Blockaden der Ereignisschleife schreibt der main ins Log
(„[main] Ereignisschleife … ms blockiert“).
Umgesetzt in 1.4: Abfrage mit Ordner-Filter (`sortFilter.ts`: Unterordner als Bereich auf
`rel_key`, nutzt den Index `folder_id, rel_key`), Verzeichnisse mit Anzahl für den Ordnerbaum,
Größensumme einer Auswahl, Vorschau-Vorrang für den gemeldeten Ausschnitt (`library.visible`:
sichtbar + nächste Seite, vor dem übrigen Hintergrund; `vorschauOffenUnter`).

## Regeln

- **Ein Schreiber:** Nur main schreibt die DB (better-sqlite3 ist synchron). Der Bilddienst
  liefert Ergebnisse in Stapeln, main schreibt je Stapel **eine** Transaktion. Gemessen
  (`scripts/labor/sqlite-index.mjs`, 25.10.2026): 250 Zeilen samt Stichwörtern und FTS5 blockieren
  main im Median 40 ms (höchstens 100 ms), 1.000 Zeilen 90 ms – die FTS5-Pflege kostet je
  Transaktion. Start mit 250 und zwischen zwei Stapeln an die Ereignisschleife abgeben
  (`setImmediate`), damit IPC und `thumb://` dazwischen antworten.
- **Nie synchron auf Nutzerordner** (`statSync`, `existsSync`, `readdirSync`): Ein getrenntes
  Netzlaufwerk hält sonst den main an. `isDirReachable()` mit Zeitlimit (aus der Mottulbox),
  Dateiarbeit im Bilddienst.
- **Bilddienst:** `utilityProcess.fork`, Nachrichten mit Kennung und Zeitlimit; stirbt er, startet
  der Client ihn neu und markiert die Datei, an der er war, als `defekt` (nach dem zweiten Absturz
  an derselben Datei nicht mehr versuchen). Nie ganze Bilder über die Nachrichten – nur Pfade
  hinein, Kennwerte und fertige Cache-Dateien heraus.
- **Scan:** rekursiv, ohne Symlinks/Junctions zu folgen, die aus dem Ordner führen; Ausschlüsse
  (`$RECYCLE.BIN`, `System Volume Information`, versteckte/System-Ordner, eigener Cache,
  Zwischennamen des Stapels `.*.galerie-tmp-*`); Dateien nach Inhalt erkennen (Signatur), nicht
  nur nach Endung.
- **Abgleich** statt Neuaufbau: Schlüssel je Datei = Ordner + relativer Pfad; geändert, wenn
  Größe oder Änderungszeit abweichen → Metadaten und Vorschaubild neu. Verschwundene Dateien
  auf einem nicht erreichbaren Laufwerk bleiben als „nicht erreichbar“ stehen, statt gelöscht
  zu werden; nur bei erreichbarem Ordner ist „fehlt“ endgültig.
- **Überwachen:** `fs.watch(dir, { recursive: true })` (lokal, im Bilddienst – der Aufruf öffnet
  den Ordner synchron); Ereignisse sammeln (Debounce ~300 ms) und gezielt abgleichen;
  `error`/Überlauf → ganzen Ordner abgleichen. Netzlaufwerke nur periodisch. Eigene
  Schreibvorgänge (Stapel, Metadaten, ab Phase 3) kurz vormerken, damit sie nicht doppelt
  verarbeitet werden – der Papierkorb braucht das nicht (seine Zeilen sind schon weg).
- **Fehlercodes unterscheiden** (Review der Mottulbox): „fehlt“ nur bei `ENOENT`/`ENOTDIR`;
  `EBUSY`, `EPERM`, Zeitlimit = vorübergehend, später erneut versuchen, nie als gelöscht werten.

## Aufnahmedatum, Ort

- Rangfolge (`dates.ts`): `DateTimeOriginal` (+ `SubSecTimeOriginal`) → `CreateDate` → XMP
  `photoshop:DateCreated` → die **ältere** von Dateierstellung und Änderungszeit (Kopieren setzt
  unter Windows die Erstellzeit neu). Ein Datum aus den Metadaten überschreibt kein Scan, ein
  Dateidatum jeder. Gespeichert als **lokale Zeit wie
  in der Kamera** (`taken_at`, ISO ohne Zone) plus `taken_offset` (falls bekannt) plus
  `taken_source`. Sortiert wird nach `taken_at`, nicht nach UTC – sonst springen Urlaubsfotos
  um die Zeitverschiebung.
- Ungültige Daten (`0000:00:00 00:00:00`, Jahr < 1826 oder in der Zukunft > 1 Tag) → nächste Quelle.
- GPS als Dezimalgrad mit Vorzeichen (Ref beachten); `0,0` ohne weitere GPS-Tags gilt als „kein
  Standort“. Nächster Ort über die Ortsdaten im Paket (Gitter- oder k-d-Suche), `place_id` im
  Index – neu rechnen, wenn sich die Ortsdaten-Version ändert.
- **Ortsname für die Sortierung** (entschieden: „nach GPS“ = Orte alphabetisch): Ort-Feld der
  Metadaten (MWG `City`), sonst der nächste Ort aus den GPS-Koordinaten; Land als Zusatz. Den
  Sortierschlüssel (`place_sort`: gefaltet wie `name_sort`, dann Land) beim Einfügen rechnen.
  Gleichnamige Orte in verschiedenen Ländern sind getrennte Gruppen.

## Abfragen

- `sortFilter.ts` übersetzt eine **geprüfte Beschreibung** (`{ sort: [{ feld, richtung }],
  filter: […], gruppe }`) in SQL mit Platzhaltern. Feldnamen nur aus einer Allowlist, Werte
  nur als Parameter – nie Text aus dem Renderer in das SQL.
- Jede Sortierung endet mit einem eindeutigen Schlüssel (`id`), sonst ist die Reihenfolge bei
  Gleichstand zufällig und das Raster springt.
- Fehlende Werte (kein Datum, kein GPS) stehen **immer am Ende**, unabhängig von der Richtung.
- Natürliche Namenssortierung: Sortierschlüssel beim Einfügen berechnen (`name_sort`, Zahlen
  aufgefüllt, Groß/Klein und Umlaute gefaltet), nicht per eigener SQL-Funktion zur Laufzeit.
- **Ort (A–Z):** `ORDER BY place_sort, taken_at, id`, gruppiert nach Ort; ohne Standort als
  letzte Gruppe „Ohne Standort“ – auch absteigend (dann nur die Orte umgekehrt). Dafür eine
  eigene Spalte `place_missing` (0/1) vorn in den Index: `ORDER BY place_sort IS NULL …` sortiert
  ohne Index (gemessen bei 50.000 Zeilen 36 statt 11 ms).
- Entfernung zu einem Bezugspunkt (erst Phase 7): Vorfilter per Begrenzungsrahmen in SQL, genaue
  Entfernung (Haversine) in `geo.ts`; Ergebnis cachen, solange der Bezugspunkt gleich bleibt.
- Für das Raster: geordnete **Liste der Kennungen** (+ Gruppen-Grenzen) einmal je Abfrage,
  Details nur für den sichtbaren Ausschnitt. Nie 100.000 Objekte über IPC.
- Neue Sortierspalte = Index in der Migration (mit `folder_id`, wenn nach Ordner gefiltert wird);
  `EXPLAIN QUERY PLAN` im Test prüfen, dass er benutzt wird.

## Vorschaubilder

- Reihenfolge: sichtbarer Ausschnitt → nächste Seiten in Scrollrichtung → Rest. Der Renderer
  meldet den Ausschnitt (gedrosselt); die Warteschlange priorisiert neu, statt Aufträge
  abzubrechen und neu anzulegen. **Stand 1.3:** Signal ist der Abruf selbst – `<img
  loading="lazy">` fragt nur, was (fast) sichtbar ist, und ein Abruf über `thumb://` kommt vor
  dem Hintergrund dran. **Seit 1.4** meldet das virtualisierte Raster zusätzlich den Ausschnitt
  samt nächster Seite (gedrosselt); er kommt vor dem übrigen Hintergrund.
- Platzhalter in Bildfarbe (Durchschnittsfarbe im Index, Spalte `color`) statt leerer Kachel.
- Ordner „privat“: Vorschau nur auf Abruf und nur im Arbeitsspeicher (höchstens 256 MB, älteste
  zuerst heraus); der Hintergrund lässt ihn aus. Wechsel nach „privat“ und Entfernen löschen die
  Cache-Dateien sofort (Kennungen vor dem Löschen der Zeilen merken).
- Cache-Schlüssel aus Bild-Kennung + Größe + Änderungszeit + Stufe + Version des Verfahrens;
  ändert sich das Verfahren (Qualität, Farbraum), Version erhöhen.

## Migrationen

- Schema-Version in der DB (`PRAGMA user_version`); jede Migration einmal, in einer Transaktion,
  mit Test „alte DB → neue DB“ (Fixture aus der vorigen Version erzeugen).
- Neue Spalte, die aus den Dateien kommt: Spalte anlegen und betroffene Bilder zum Nachlesen
  vormerken (`meta_read_at = NULL`), nicht beim Start alles synchron nachholen.

## Tests

- Rein: Datum-Rangfolge und ungültige Daten, natürliche Sortierung, Abfrage-Bausteine (Allowlist,
  NULL ans Ende, eindeutiger Schluss), Ortsname (Metadaten vor GPS, gleichnamige Orte, Umlaute)
  und nächster Ort.
- DB (vitest mit echter better-sqlite3 im Temp-Ordner): Migrationen, Abgleich (geändert, fehlt,
  nicht erreichbar), Stapel-Transaktionen, `EXPLAIN QUERY PLAN`.
- E2E `galerie`/`sortieren`: Testbibliothek mit bekannter Reihenfolge, Datei von außen ändern
  und löschen (Watcher), Ordner entfernen (keine Reste in DB und Cache).
- Leistung: 50.000/100.000 synthetische Bilder (Skill `bild-labor`), Zielwerte aus `docs/PLAN.md`.
