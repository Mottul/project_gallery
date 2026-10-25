---
name: bibliothek-index
description: Bibliothek der Galerie bauen oder ändern – Ordner und Ordner-Modi, Scan, Überwachen (fs.watch, Netzlaufwerke), Bilddienst (utilityProcess), Index-Schema in SQLite mit Migrationen, Aufnahmedatum und GPS ermitteln, Sortier-/Filter-/Gruppier-Abfragen, Vorschaubild-Reihenfolge, Leistung bei 100.000 Bildern. Verwenden, bevor an services/library/, services/bilddienst/, db.ts, sortFilter.ts, dates.ts, geo.ts oder dem Galerie-Raster gearbeitet wird.
---

# Bibliothek und Index

Der Index ist eine **Kopie** dessen, was in den Dateien steht – nie die Wahrheit. Alles muss
sich aus den Dateien neu aufbauen lassen (außer Journal und Bearbeitungsrezepten).

## Wo was liegt (geplant)

| Was | Ort |
|---|---|
| Datenbank, Schema, Migrationen | `src/main/services/db.ts` (Muster Mottulbox: WAL, defekte DB sichern und neu anlegen) |
| Ordner, Modi, Scan, Watcher, Abgleich | `src/main/services/library/` |
| Bilddienst (utilityProcess) und Client | `src/main/services/bilddienst/` |
| Sortieren/Filtern/Gruppieren → SQL-Bausteine (rein) | `src/shared/sortFilter.ts` + Test |
| Aufnahmedatum (Rangfolge, Zeitzone), natürliche Namenssortierung | `src/shared/dates.ts`, `sortFilter.ts` |
| Entfernung, nächster Ort (rein) | `src/shared/geo.ts` + Test |

## Regeln

- **Ein Schreiber:** Nur main schreibt die DB (better-sqlite3 ist synchron). Der Bilddienst
  liefert Ergebnisse in Stapeln (Start: 500), main schreibt je Stapel **eine** Transaktion. Wie
  lange ein Stapel main blockiert, steht im Plan (Labor); über ~16 ms kleiner machen.
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
- **Überwachen:** `fs.watch(dir, { recursive: true })` (lokal); Ereignisse sammeln (Debounce
  ~300 ms) und gezielt abgleichen; `error`/Überlauf → ganzen Ordner abgleichen. Netzlaufwerke
  zusätzlich periodisch. Eigene Schreibvorgänge (Stapel, Metadaten) kurz vormerken, damit sie
  nicht doppelt verarbeitet werden.
- **Fehlercodes unterscheiden** (Review der Mottulbox): „fehlt“ nur bei `ENOENT`/`ENOTDIR`;
  `EBUSY`, `EPERM`, Zeitlimit = vorübergehend, später erneut versuchen, nie als gelöscht werten.

## Aufnahmedatum, Ort

- Rangfolge (`dates.ts`): `DateTimeOriginal` (+ `SubSecTimeOriginal`) → `CreateDate` → XMP
  `photoshop:DateCreated` → Dateierstellung → Änderungszeit. Gespeichert als **lokale Zeit wie
  in der Kamera** (`taken_at`, ISO ohne Zone) plus `taken_offset` (falls bekannt) plus
  `taken_source`. Sortiert wird nach `taken_at`, nicht nach UTC – sonst springen Urlaubsfotos
  um die Zeitverschiebung.
- Ungültige Daten (`0000:00:00 00:00:00`, Jahr < 1826 oder in der Zukunft > 1 Tag) → nächste Quelle.
- GPS als Dezimalgrad mit Vorzeichen (Ref beachten); `0,0` ohne weitere GPS-Tags gilt als „kein
  Standort“. Nächster Ort über die Ortsdaten im Paket (Gitter- oder k-d-Suche), `place_id` im
  Index – neu rechnen, wenn sich die Ortsdaten-Version ändert.

## Abfragen

- `sortFilter.ts` übersetzt eine **geprüfte Beschreibung** (`{ sort: [{ feld, richtung }],
  filter: […], gruppe }`) in SQL mit Platzhaltern. Feldnamen nur aus einer Allowlist, Werte
  nur als Parameter – nie Text aus dem Renderer in das SQL.
- Jede Sortierung endet mit einem eindeutigen Schlüssel (`id`), sonst ist die Reihenfolge bei
  Gleichstand zufällig und das Raster springt.
- Fehlende Werte (kein Datum, kein GPS) stehen **immer am Ende**, unabhängig von der Richtung.
- Natürliche Namenssortierung: Sortierschlüssel beim Einfügen berechnen (`name_sort`, Zahlen
  aufgefüllt, Groß/Klein und Umlaute gefaltet), nicht per eigener SQL-Funktion zur Laufzeit.
- GPS-Entfernung: Vorfilter per Begrenzungsrahmen in SQL, genaue Entfernung (Haversine) in
  `geo.ts`; Ergebnis cachen, solange der Bezugspunkt gleich bleibt.
- Für das Raster: geordnete **Liste der Kennungen** (+ Gruppen-Grenzen) einmal je Abfrage,
  Details nur für den sichtbaren Ausschnitt. Nie 100.000 Objekte über IPC.
- Neue Sortierspalte = Index in der Migration (mit `folder_id`, wenn nach Ordner gefiltert wird);
  `EXPLAIN QUERY PLAN` im Test prüfen, dass er benutzt wird.

## Vorschaubilder

- Reihenfolge: sichtbarer Ausschnitt → nächste Seiten in Scrollrichtung → Rest. Der Renderer
  meldet den Ausschnitt (gedrosselt); die Warteschlange priorisiert neu, statt Aufträge
  abzubrechen und neu anzulegen.
- Platzhalter in Bildfarbe (Durchschnittsfarbe im Index) statt leerer Kachel.
- Cache-Schlüssel aus Bild-Kennung + Größe + Änderungszeit + Stufe + Version des Verfahrens;
  ändert sich das Verfahren (Qualität, Farbraum), Version erhöhen.

## Migrationen

- Schema-Version in der DB (`PRAGMA user_version`); jede Migration einmal, in einer Transaktion,
  mit Test „alte DB → neue DB“ (Fixture aus der vorigen Version erzeugen).
- Neue Spalte, die aus den Dateien kommt: Spalte anlegen und betroffene Bilder zum Nachlesen
  vormerken (`meta_read_at = NULL`), nicht beim Start alles synchron nachholen.

## Tests

- Rein: Datum-Rangfolge und ungültige Daten, natürliche Sortierung, Abfrage-Bausteine (Allowlist,
  NULL ans Ende, eindeutiger Schluss), GPS-Entfernung und nächster Ort.
- DB (vitest mit echter better-sqlite3 im Temp-Ordner): Migrationen, Abgleich (geändert, fehlt,
  nicht erreichbar), Stapel-Transaktionen, `EXPLAIN QUERY PLAN`.
- E2E `galerie`/`sortieren`: Testbibliothek mit bekannter Reihenfolge, Datei von außen ändern
  und löschen (Watcher), Ordner entfernen (keine Reste in DB und Cache).
- Leistung: 50.000/100.000 synthetische Bilder (Skill `bild-labor`), Zielwerte aus `docs/PLAN.md`.
