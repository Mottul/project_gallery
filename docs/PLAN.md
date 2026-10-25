# Plan: Galeria Beata – Bildbetrachter und -bearbeiter für Windows

Arbeitstitel „Galeria Beata“ (Repo `project_gallery`). Stand 25. Oktober 2026: Phase 0 läuft,
das Gerüst steht ([Phase 0](#phase-0--fundament-und-labor)). Dieser Plan ist die Grundlage für die
Umsetzung: vor jeder Phase lesen, offene Fragen
klären, nach der Umsetzung Erledigtes in die Doku überführen. Gebaut wird lokal auf dem
Windows-PC des Nutzers; die CI prüft zusätzlich jeden Pull Request.

- [Vorschau der Oberfläche](#vorschau-der-oberfläche)
- [Ziele](#ziele)
- [Leitplanken](#leitplanken)
- [Entscheidungen](#entscheidungen)
- [Was aus der Mottulbox übernommen wird](#was-aus-der-mottulbox-übernommen-wird)
- [Architektur](#architektur)
- [Funktionen im Detail](#funktionen-im-detail)
- [Schutzkonzept für Bilddaten](#schutzkonzept-für-bilddaten)
- [Installation und Auslieferung](#installation-und-auslieferung) – mit [App-Aktualisierung](#app-aktualisierung)
- [Phasen](#phasen)
- [Tests und Qualität](#tests-und-qualität)
- [Risiken](#risiken)
- [Entscheidungen und offene Fragen](#entscheidungen-und-offene-fragen)
- [Skills](#skills)

## Vorschau der Oberfläche

Klickbare Entwürfe (privat, nur für den Nutzer freigegeben):
<https://claude.ai/artifact/4Q4Exe9RKDCRAgU9MGPXrK>. Bilder darin sind synthetische Platzhalter;
Akzent Hellgrün, Hell- und Dunkelmodus (Umschalter oben rechts in jedem Bildschirm), Schrift
Segoe UI.

| Bildschirm | Zeigt |
|---|---|
| Galerie – Kacheln | Ordnerbaum mit Ordner-Modi („nur lesen“, „privat“), Größenregler, Sortieren mit Gruppen (Ort A–Z, Datum, Name natürlich, Kamera, Bewertung, Größe), Auswahl, Marken für Standort/Bewertung/bearbeitet/Video, Statusleiste „Offline · verschlüsselt“ |
| Galerie – Liste | Detailtabelle nach Ort (A–Z), wählbare Spalten, Auswahl per Kästchen |
| Betrachter | Großansicht mit Filmstreifen, Zoom, verlustfreies Drehen, Schnellbewertung, Papierkorb, Info-Panel (Aufnahme mit Datumsquelle, Ort offline, Kamera, Histogramm, Beschreibung, Datei) |
| Bildbearbeitung | Zuschnitt mit Seitenverhältnissen, Regler mit Live-Vorschau, Vorher/Nachher, Rezept, „Als Kopie speichern“ / „Original ersetzen“ |
| Metadaten bearbeiten | Mehrfachauswahl mit ‹verschieden›, Stichwörter hinzufügen/entfernen, Bewertung, Farblabel, Standort entfernen, Schreiben nur geänderter Felder, Bericht mit Konflikt („inzwischen außerhalb geändert“) |
| Stapelverarbeitung | Schritte, Aktionskette (Umbenennen, Zeit verschieben, Export mit Datenschutz-Profil), Vorschau mit Konflikten (Groß/Klein, Ziel existiert, Ordner nur lesen), Ausführen erst ohne Konflikte, Bericht, Rückgängig |
| Farben | Design-Tokens für Hell und Dunkel (Akzent, Flächen, Schrift, Status) mit Kontrastwerten – Vorlage für die CSS-Variablen |

## Ziele

Aus der Anfrage:

1. **Windows-Desktop-App** zum Betrachten und Bearbeiten von Bildern.
2. **Ordner angeben**, deren Bilder in der Galerie erscheinen (Bibliotheksordner, rekursiv).
3. **Sortieren** nach Aufnahme-/Erstelldatum, GPS (Orte alphabetisch), Name und weiteren
   Metadaten (Kamera, Objektiv, Bewertung, Größe …).
4. **Anzeigegröße einstellbar:** Kacheln (stufenlos), Liste, weitere Ansichten.
5. **Metadaten bearbeiten** (einzeln und für viele Bilder auf einmal).
6. **Stapelverarbeitung** generell: Umbenennen, Metadaten, Drehen, Konvertieren, Exportieren …
7. **Installation so einfach wie möglich.**
8. **Alles funktioniert offline.**
9. **Bilddaten gut geschützt.**
10. **Videos** in der Galerie: anzeigen, abspielen, sortieren, Metadaten bearbeiten.
11. **Updates in der App** für wichtige Komponenten.
12. **Hell- und Dunkelmodus**, freundlicher hellgrüner Akzent.

**Nicht-Ziele (vorerst):** Cloud, Konten, Synchronisation, RAW-Entwicklung, Ebenen/Retusche wie
in einem Grafikprogramm, Gesichtserkennung, Video-Schnitt und -Umwandlung.

## Leitplanken

Drei Anforderungen gelten für jede Funktion und entscheiden im Zweifel:

| Leitplanke | Heißt konkret |
|---|---|
| **Offline** | Keine Funktion braucht Netz. Die App öffnet von sich aus **keine** Verbindung – technisch erzwungen (Netzsperre in der Sitzung, Lint-Regel gegen Netz-Module im main, E2E mit Spion-Server). Alles Nötige liegt im Paket: ExifTool, ffmpeg, Bildbibliothek, Ortsdaten, Schriften, Symbole. **Einzige Ausnahme:** die [App-Aktualisierung](#app-aktualisierung) – nur nach Zustimmung, nur zu einer festen Adresse, nichts über den Nutzer. |
| **Bilddaten geschützt** | Originale werden nur auf ausdrücklichen Befehl verändert, dann mit Sicherung, atomar und nachgeprüft. Löschen geht in den Papierkorb. Abgeleitete Daten (Vorschaubilder, Index mit GPS) bleiben lokal, verschlüsselt bzw. löschbar. Details: [Schutzkonzept](#schutzkonzept-für-bilddaten). |
| **Einfache Installation** | Eine Datei, Doppelklick, ohne Administratorrechte, ohne Fragen, ohne Downloads beim ersten Start, ohne Laufzeitumgebung (.NET, Java, Python). |

## Entscheidungen

| Thema | Entscheidung | Warum |
|---|---|---|
| Plattform | **Electron + React + TypeScript**, Build mit electron-vite | Wie die Mottulbox: Bausteine, Sicherheits-Härtung, E2E-Harness, CI und Skills lassen sich übernehmen. Tauri/.NET wären kleiner, aber alles neu – und das Bild-Ökosystem (sharp) ist Node. Die Paketgröße (~150–250 MB mit ffmpeg) ist zweitrangig. |
| Versionen | **Gleicher Stand wie die Mottulbox** beim Start (Electron 44, React 18, Tailwind 3, zustand 5, vitest 4) | UI-Bausteine und Konfigurationen 1:1 nutzbar; große Umstiege (React 19, Tailwind 4) später gemeinsam mit der Mottulbox. |
| Bilder dekodieren, Vorschaubilder, Export | **sharp** (libvips) | Schnell (Verkleinern schon beim Dekodieren bei JPEG), liest JPEG, PNG, WebP, GIF, AVIF, TIFF, SVG; N-API-Binaries im Paket, in der aktuellen Version (0.35) **ohne Install-Skript** (passt zu `ignore-scripts=true`). HEIC (HEVC) ist in den fertigen Binaries **nicht** enthalten → Phase 6. |
| Metadaten lesen/schreiben | **ExifTool** (gebündelte Windows-Version, eigener dünner Wrapper im `-stay_open`-Modus) | Einziges Werkzeug, das EXIF, IPTC und XMP in allen Formaten (auch RAW, HEIC, MP4/MOV, Sidecars) zuverlässig schreibt. Wie ffmpeg in der Mottulbox: Download-Skript mit Prüfsumme, im Paket unter `resources/`, kein npm-Paket mit eigenen Abhängigkeiten. |
| Videos | **Abspielen in Chromium** (`<video>`), **Vorschaubilder und Kennwerte per ffmpeg/ffprobe** (gebündelt wie in der Mottulbox, Prüfsumme, nur lokale Dateien), **Metadaten per ExifTool** | Chromium spielt die gängigen Formate ohne Zusatz; ffmpeg liefert Standbilder, Dauer und Codecs für alle Formate – und ist zugleich ein Kandidat für HEIC. Keine Umwandlung, kein Schnitt. |
| Bildarbeit im eigenen Prozess | **utilityProcess „Bilddienst“** (sharp, ExifTool- und ffmpeg-Steuerung) | Eine präparierte oder kaputte Datei kann einen Dekoder abstürzen lassen – dann stirbt nur der Dienst (Neustart, Datei als „nicht lesbar“ markiert), nicht die App. Der main bleibt für Fenster und IPC frei. |
| Index | **SQLite** (better-sqlite3, wie Mottulbox) mit FTS5 für die Suche, Datenbank nur im main (ein Schreiber) | Sortieren/Filtern über Indizes in Millisekunden auch bei 100.000 Dateien; der Bilddienst liefert Ergebnisse in Stapeln, main schreibt sie in Transaktionen. |
| Galerie-Raster | Virtualisiert (`@tanstack/react-virtual`, wird ins Renderer-Bündel gebaut) | Nur sichtbare Kacheln im DOM; flüssig bei großen Bibliotheken. |
| Bilder zum Renderer | **Eigene Protokolle** `thumb://` und `bild://` mit Kennung aus dem Index, nie `file://` | Der Renderer kennt keine Pfade und kann keine beliebige Datei lesen (Muster `foto://` der Mottulbox). |
| Bearbeitung | **Nicht-destruktiv:** Bearbeitungsrezept (reines, getestetes `editPlan`), Vorschau im Renderer, Ergebnis mit sharp aus dem Original | Original bleibt, bis ausdrücklich „Original ersetzen“ gewählt wird; Rezepte lassen sich auf viele Bilder übertragen (Stapel). |
| Stapelverarbeitung | **Plan → Vorschau → Ausführen → Bericht → Rückgängig**, Warteschlange aus der Mottulbox (`JobQueue`/`JobList`) | Niemand startet blind eine Aktion auf 5.000 Dateien; Konflikte stehen vor dem Start in der Vorschau. |
| App-Aktualisierung | **Eigener schlanker Updater** gegen die GitHub-Releases des Repos, Installer **mit eigenem Schlüssel signiert** (Ed25519), Prüfung nur nach Zustimmung | Wichtige Korrekturen (Chromium, Bild-Dekoder, ExifTool) erreichen den Nutzer ohne Handarbeit; die eigene Signatur schützt auch ohne Windows-Code-Signatur vor untergeschobenen Installern. Details: [App-Aktualisierung](#app-aktualisierung). |
| Erscheinungsbild | **System / Hell / Dunkel** (Standard: folgt Windows), Akzent **Hellgrün**, Farben als CSS-Variablen | Wie die Mottulbox technisch (Variablen, Klasse am `<html>`), aber eigener, freundlicher Akzent statt Gold. Details: [Erscheinungsbild](#erscheinungsbild). |
| Sprache | Deutsch für Oberfläche und Code-Kommentare (wie Mottulbox) | Einheitlich mit dem bestehenden Projekt. |
| Zielsystem | **Windows 10/11 x64**; Linux läuft in der CI für E2E mit | Gewünscht ist Windows; Linux kostet in der CI nichts und fängt Pfadannahmen. macOS optional später. |

## Was aus der Mottulbox übernommen wird

Kopiert (mit Herkunft im Kopfkommentar), nicht als gemeinsames Paket – das hält beide Projekte
unabhängig. Galeria Beata ist eine eigenständige App: Die Mottulbox ist nur Kopiervorlage in
Phase 0, zur Laufzeit und im Build gibt es keine Verbindung. Pfade beziehen sich auf
`Mottul/project_mega`, Stand `origin/main` (lokale Kopie unter `..\project_mega`).

| Baustein | Herkunft | Wofür hier |
|---|---|---|
| Build-Gerüst | `electron.vite.config.ts`, `tsconfig*.json`, `eslint.config.mjs`, `.prettierrc.json`, `.npmrc` | gleiche Konventionen (kein Semikolon, 100 Zeichen, `--max-warnings 0`, `ignore-scripts`) |
| Electron-Binary mit Prüfsumme | `scripts/fetch-electron-bin.mjs` | Einrichten ohne Install-Skripte |
| Prüfskripte | `scripts/check-filenames.mjs`, `scripts/check-doc-refs.mjs` | Dateinamen-Kollisionen unter Windows, tote Verweise in Doku/Skills |
| Fenster-Härtung | `services/windows/appWindows.ts` (`secureWebPreferences`), `windowGuards.ts`, `windowPolicy.ts` | Sandbox, keine Navigation, keine neuen Fenster, Berechtigungen per Allowlist |
| Einstellungen, Log, atomares Schreiben | `services/store.ts`, `log.ts`, `fsAtomic.ts`, `broadcast.ts` | settings.json mit Wiederherstellung, Schreiben über Nachbardatei + Umbenennen |
| Datei-Dialoge | `services/fileDialogs.ts`, `dialogStartPath.ts` | Ordner merken (Electron startet sonst in „Downloads“) |
| Netzlaufwerke | `services/reachableDir.ts` | nie synchron auf Nutzerordner zugreifen, Zeitlimit |
| Datenbank | `services/db.ts` (Muster) | WAL, Migrationen, Wiederherstellung einer defekten DB |
| Warteschlange | `services/jobs/queue.ts`, `jobList.ts` | Vorschaubilder, Metadaten schreiben, Stapel, Export |
| ffmpeg | `scripts/download-ffmpeg.mjs`, `services/ffmpeg/ffmpegPath.ts`, `ffmpeg/probe.ts`, `ffmpeg/mediaInfoParse.ts`, `convert/runFfmpeg.ts` | Video-Standbilder, Dauer, Codecs; Prüfsumme beim Download, Abbruch per `AbortSignal`. Kein HAP nötig → kleinerer LGPL-Build prüfen (Labor) |
| EXIF-Ausrichtung | `services/fotos/fotoImage.ts` | Gegenprobe im Test (sharp dreht selbst) |
| Eigenes Protokoll | `ipc/fotos.handlers.ts` (`foto://`) | Vorbild für `thumb://`/`bild://` |
| IPC-Vertrag | `shared/ipc-contracts.ts`, `preload/index.ts` | Channels + typisierte API, Renderer nur über `api` |
| UI-Bausteine | `renderer/src/components/ui/*`, `lib/settings`, `lib/persistStorage`, `lib/useDraft`, Theme-Mechanik (`assets/main.css`, `lib/accent`) | Felder, Knöpfe, Auswahl; Hell/Dunkel über Variablen – Farbwerte neu (Hellgrün) |
| Update-Muster | `services/ffmpeg/ffmpegUpdate.ts`, `ffmpegUpdatePlan.ts`, `e2e/ffmpeg-update.mjs` | Vorbild für die App-Aktualisierung: feste Quelle, Prüfung vor Aktivierung, Test gegen Schein-Server |
| E2E-Harness | `e2e/harness.mjs`, `e2e/run.mjs` | gebaute App mit Playwright starten, frischer Benutzerordner |
| CI und Abhängigkeiten | `.github/workflows/ci.yml`, `installer.yml`, `dependabot.yml` (7 Tage Abstand) | Prüfungen, E2E auf Windows/Linux, Installer bei Tag `v*` |

## Architektur

```
src/
├── main/
│   ├── index.ts                  # Lebenszyklus, Netzsperre, Protokolle, Wächter
│   ├── ipc/                      # library · meta · batch · edit · update · settings (*.handlers.ts), registry.ts,
│   │                             # handle.ts (jeder Handler prüft den Absender)
│   └── services/
│       ├── store.ts · db.ts · log.ts · fsAtomic.ts · fileDialogs.ts · reachableDir.ts · broadcast.ts
│       ├── netzsperre.ts          # alle Anfragen außer App-Seite und eigenen Protokollen abweisen
│       ├── netzRegel.ts           # die Regel dazu, rein und getestet
│       ├── windows/              # appWindows, windowGuards, windowPolicy (aus Mottulbox)
│       ├── library/              # Ordner, Scan, Überwachen, Index schreiben, Abfragen
│       ├── bilddienst/           # utilityProcess: Einstieg, Client mit Neustart und Zeitlimits
│       ├── images/               # Vorschaubilder, Rendern von Rezepten, Export (läuft im Bilddienst)
│       ├── video/                # Standbild, Dauer, Codecs über ffmpeg/ffprobe (läuft im Bilddienst)
│       ├── ffmpeg/               # Pfad zur Binary, Aufruf mit Zeitlimit (aus Mottulbox)
│       ├── cache/                # Vorschaubild-Ablage (verschlüsselt), Schlüssel über safeStorage
│       ├── exiftool/             # stay_open-Wrapper, Argumentdateien bauen, Pfad zur Binary
│       ├── metadata/             # lesen, schreiben, Journal (Rückgängig), Sidecars
│       ├── batch/                # Stapel-Aufträge (Umbenennen, Metadaten, Export …)
│       ├── protocols/            # thumb:// und bild://
│       ├── update/               # App-Aktualisierung: einzige Stelle mit Netz (Allowlist, Signatur)
│       └── jobs/                 # queue, jobList (aus Mottulbox)
├── shared/                       # rein und getestet, auch im Renderer nutzbar
│   ├── types.ts · ipc-contracts.ts · settingsCheck.ts · settingsMerge.ts
│   ├── metaFields.ts             # bearbeitbare Felder: Allowlist, Prüfung, Zuordnung zu Tags
│   ├── sortFilter.ts             # Sortier-/Filter-/Gruppier-Beschreibung -> SQL-Bausteine
│   ├── renamePattern.ts          # Namensmuster {datum:yyyy-MM-dd}_{zähler:3}
│   ├── batchPlan.ts              # Stapel planen: Ziele, Konflikte, Vorschau
│   ├── editPlan.ts               # Bearbeitungsrezept -> Arbeitsschritte (Vorschau und Rendern)
│   ├── updatePlan.ts             # Release-Liste prüfen, Version wählen, „wichtig“ erkennen
│   └── dates.ts · geo.ts         # Aufnahmedatum ermitteln, Entfernungen, nächster Ort
├── preload/index.ts              # typisierte API über contextBridge
└── renderer/src/
    ├── galerie/                  # Ordnerbaum, Raster, Liste, Filterleiste, Auswahl
    ├── betrachter/               # Vollbild, Zoom, Filmstreifen, Diashow, Video, Info-Panel
    ├── metadaten/                # Bearbeiten-Panel (einzeln und mehrfach)
    ├── stapel/                   # Assistent: Aktionen, Vorschau, Fortschritt, Bericht
    ├── editor/                   # Zuschneiden, Drehen, Regler, Vorher/Nachher
    ├── einstellungen/            # Ordner, Cache, Datenschutz, Darstellung, Aktualisierung
    └── components/ui/ · lib/     # aus Mottulbox
e2e/                              # harness, smoke, netz, originale, galerie, metadaten, stapel, update …
scripts/                          # fetch-electron-bin, download-exiftool, download-ffmpeg, testbilder, release-sign, check-*
resources/exiftool/win/           # gebündeltes ExifTool (nicht im Git, per Skript geladen)
resources/ffmpeg/win/             # gebündeltes ffmpeg/ffprobe (nicht im Git, per Skript geladen)
```

### Datenfluss

1. Nutzer fügt einen Ordner hinzu (Ordner-Dialog im main → Ordner gilt als freigegeben).
2. **Scan** (Bilddienst): Dateiliste rekursiv, Ausschlüsse (`$RECYCLE.BIN`, `System Volume
   Information`, versteckte Ordner, eigene Cache-Ordner) → main schreibt Grunddaten in Stapeln.
3. **Metadaten** (Bilddienst, ExifTool stapelweise) → Spalten im Index + vollständige Liste als JSON.
4. **Vorschaubilder** (Bilddienst, sharp; Videos: Standbild per ffmpeg, dann sharp): sichtbare
   Dateien zuerst, dann der Rest im Hintergrund; verschlüsselt in den Cache.
5. **Überwachen:** `fs.watch` rekursiv (lokal), Abgleich beim Start und bei Fokus; Netzlaufwerke
   periodisch mit Zeitlimit. Bei Überlauf der Ereignisse: Ordner neu abgleichen.
6. **Renderer** fragt `library.query({ sortierung, filter, gruppierung })` → geordnete Liste der
   Kennungen + Anzahl; Details nur für den sichtbaren Ausschnitt; Bilder über `thumb://<id>/<stufe>`.

### Index (Skizze)

```sql
folders  (id, path UNIQUE, mode /* normal | nur-lesen | privat */, added_at, last_scan)
images   (id, folder_id, rel_path, name, name_sort, ext, kind /* bild | video | raw */, size, mtime, btime,
          width, height, orientation, duration_ms, video_codec, playable,
          taken_at /* lokal, ISO */, taken_offset, taken_source,
          gps_lat, gps_lon, gps_alt, place_id, place_sort, camera_make, camera_model, lens,
          iso, aperture, exposure, focal, rating, color_label, title, description,
          thumb_state, meta_json, meta_read_at, status /* ok | fehlt | defekt */)
keywords (image_id, keyword)          -- normalisiert, für Filter und Gruppen
journal  (id, at, action, image_id, before_json, after_json, undone_at)   -- Rückgängig
recipes  (image_id, recipe_json, version, updated_at)                    -- Bearbeitungen
images_fts (name, title, description, keywords, place)                   -- FTS5
```

Indizes auf jede Sortierspalte (mit `folder_id`), `taken_at` mit Rückfall-Reihenfolge,
`place_sort`, `rating`, `camera_model`. Schema mit Version und Migrationen wie `db.ts` der Mottulbox.

### Protokolle

| Protokoll | Liefert | Prüfung |
|---|---|---|
| `thumb://<id>/<stufe>` | Vorschaubild (Stufe 256 oder 768 px, entschlüsselt) | Kennung ganzzahlig, Stufe aus Allowlist, nur aus dem Cache |
| `bild://<id>` | Original, wenn Chromium es darstellen kann (JPEG, PNG, WebP, GIF, AVIF, BMP; Videos MP4/WebM …, mit **Range-Anfragen** fürs Spulen); sonst eine bildschirmgroße Umrechnung (TIFF, später HEIC/RAW) | Kennung muss im Index stehen, Pfad liegt (nach `realpath`) in einem Bibliotheksordner, Datei unverändert seit dem Index |

CSP der Seite: `img-src 'self' data: blob: thumb: bild:`, `media-src bild:`, `connect-src 'self'`,
kein `unsafe-eval`; im Build auch keine Inline-Skripte (umgesetzt in Phase 0, die Protokolle
kommen mit Phase 1 dazu).

## Funktionen im Detail

### Bibliothek und Ordner

- Ordner hinzufügen/entfernen (Dialog), rekursiv, Unterordner einzeln ausschließen.
- **Ordner-Modus:** *normal*; *nur lesen* (die App schreibt dort nie, auch nicht im Stapel – fürs
  Archiv); *privat* (keine Vorschaubilder auf der Platte, nur im Arbeitsspeicher).
- Ordnerbaum links mit Anzahl; „Alle Bilder“, „Videos“, „Zuletzt hinzugefügt“, „Ohne Datum“,
  „Ohne Standort“.
- Entfernen eines Ordners löscht seine Index-Zeilen und Vorschaubilder sofort (keine Reste).
- Fehlende Dateien (USB-Platte ab) bleiben als „nicht erreichbar“ sichtbar statt zu verschwinden.
- Ausgelegt auf **bis 100.000 Dateien** (entschieden), lokal und USB; Netzlaufwerke mit Zeitlimits.

### Galerie-Ansichten

- **Kacheln** mit stufenlosem Größenregler (ca. 80–400 px, auch Strg + Mausrad), quadratisch
  beschnitten oder im Seitenverhältnis.
- **Blocksatz** (Justified, Zeilen gleicher Höhe wie in Google Fotos/Lightroom) – Phase 2.
- **Liste/Details:** Tabelle mit wählbaren, sortierbaren Spalten (Name, Datum, Kamera, Maße,
  Größe, Dauer, Bewertung, Ort …) und kleinem Vorschaubild.
- **Gruppen-Überschriften** (Tag, Monat, Jahr, Ordner, Kamera, Ort) in allen Ansichten.
- Auswahl wie im Explorer (Klick, Strg, Umschalt, Strg+A, Rahmen ziehen), Statusleiste mit
  Anzahl und Summe.
- Videos tragen eine Marke mit Abspielsymbol und Dauer.
- Ansicht, Größe und Sortierung je Ordner gemerkt (Bedienzustand, nicht in der Datei).

### Sortieren, Filtern, Gruppieren, Suchen

- **Aufnahmedatum** mit fester Rangfolge: EXIF `DateTimeOriginal` (+ `SubSecTimeOriginal`,
  `OffsetTimeOriginal`) → `CreateDate` → XMP `photoshop:DateCreated` → Dateierstellung →
  Änderungsdatum. Die Quelle wird gespeichert und im Info-Panel genannt („Datum aus Datei, nicht
  aus der Kamera“). Videos siehe [Videos](#videos).
- **Name** natürlich sortiert („Bild 2“ vor „Bild 10“), ohne Groß/Klein, Umlaute richtig.
- **GPS = Orte alphabetisch (entschieden):** sortiert und gruppiert nach Ortsname A–Z, das Land
  als Zusatz („Dubrovnik · Kroatien“); innerhalb eines Ortes nach Aufnahmedatum. Der Ortsname
  kommt aus dem Ort-Feld der Metadaten (MWG `City`), sonst offline aus den GPS-Koordinaten
  (nächster Ort aus GeoNames-Daten im Paket). Gleichnamige Orte in verschiedenen Ländern bleiben
  getrennte Gruppen. Dateien **ohne Standort stehen immer am Ende**, auch absteigend. Dazu Filter
  „mit/ohne Standort“. Entfernung zu einem Bezugspunkt und Karte erst bei Bedarf (Phase 7).
- **Weitere:** Kamera, Objektiv, ISO, Blende, Belichtungszeit, Brennweite, Bewertung, Farblabel,
  Auflösung, Seitenverhältnis, Dateigröße, Dauer, Typ (Bild/Video), Ordner, Änderungsdatum.
- **Filterleiste:** Zeitraum, Bewertung ≥, Farblabel, Kamera, Stichwort, Ort, Typ (Bild/Video),
  Format, Ausrichtung (hoch/quer), mit/ohne GPS; kombinierbar, als Ansicht speicherbar.
- **Suche:** Volltext (FTS5) über Name, Titel, Beschreibung, Stichwörter, Ort.

### Betrachter

- Doppelklick öffnet; Vollbild (F11), Anpassen / 100 % / Mausrad-Zoom am Mauszeiger, Verschieben,
  Vor/Zurück (Pfeiltasten, auch über Gruppengrenzen), Filmstreifen, Diashow mit Intervall.
- Info-Panel: Aufnahme, Kamera, Ort, Datei, Beschreibung, „alle Felder“; Histogramm.
- Schnell bewerten (Tasten 0–5), Farblabel (6–9), drehen (verlustfrei, siehe Stapel), löschen
  (Papierkorb).
- Vorladen der Nachbarbilder; EXIF-Ausrichtung beachtet Chromium selbst, sharp bei Vorschaubildern.
- Vergleichsansicht (zwei Bilder nebeneinander, gekoppelter Zoom) – Phase 7.

### Videos

- **Anzeigen:** Kachel mit Standbild (ffmpeg, bei ~10 % der Dauer; schwarze Anfangsbilder
  meiden), Marke mit Dauer; in Liste und Info-Panel Dauer, Auflösung, Bildrate, Codec.
- **Abspielen** im Betrachter (`<video>` über `bild://` mit Range-Anfragen): Play/Pause, Spulen,
  Lautstärke, Vollbild, Einzelbild vor/zurück. Was Chromium nicht abspielen kann (je nach Rechner
  z. B. HEVC aus dem iPhone, AVCHD `.mts`), zeigt einen klaren Hinweis und „Mit Standardprogramm
  öffnen“; eine Abspiel-Kopie im Cache nur, wenn das Labor es für nötig hält.
- **Aufnahmedatum:** Videos speichern Zeiten anders als Fotos – QuickTime-`CreateDate` ist laut
  Spezifikation UTC, Apple legt zusätzlich `CreationDate` mit Zeitzone ab. Rangfolge: Datum mit
  Zeitzone → QuickTime-Datum (UTC → lokale Zeit) → Datei. Im Labor mit Handy- und Kameravideos
  bestätigen.
- **Standort:** GPS aus den Video-Metadaten (ExifTool), damit auch Videos nach Ort (A–Z) sortiert
  werden.
- **Metadaten bearbeiten:** Titel, Beschreibung, Stichwörter, Bewertung über ExifTool (XMP bzw.
  QuickTime-Felder in MP4/MOV); was Explorer davon anzeigt, klärt das Labor. Prüfung danach: die
  Video- und Tonspuren sind unverändert (Prüfsumme der Spuren per ffmpeg).
- **Stapel:** Umbenennen, Zeit verschieben, Metadaten, Ordnen gelten auch für Videos; Export =
  Kopie, auf Wunsch ohne Standort. Keine Umwandlung, kein Schnitt.

### Erscheinungsbild

- **Design:** System (Standard, folgt der Windows-Einstellung über `nativeTheme`), Hell, Dunkel –
  Umschalter in der Titelleiste und in den Einstellungen. Optional „Betrachter immer dunkel“.
- **Akzent Hellgrün** (entschieden): Fläche `#4ade80` mit dunkler Schrift `#052e16` in beiden
  Modi; Linien, Symbole, Links, Auswahlrahmen im Dunkelmodus `#4ade80`, im Hellmodus `#15803d`
  (5:1 auf Weiß). Weitere Akzente wählbar (Himmelblau, Apricot, Flieder).
- **Status nicht in Akzentfarbe:** OK Türkis, Warnung Bernstein, Fehler Rot – immer mit Symbol
  und Text, nie Farbe allein.
- **Umsetzung wie Mottulbox:** CSS-Variablen, Klasse am `<html>`, Farben nur über Tailwind-Tokens;
  Marken auf Vorschaubildern bleiben in beiden Modi dunkel-halbtransparent (Fotos sind hell und
  dunkel). Tokens und Kontraste: Bildschirm „Farben“ der [Vorschau](#vorschau-der-oberfläche).

Werte aus den Entwürfen (Kontrast gegen `--bg`; Startpunkt für `assets/main.css`):

| Token | Dunkel | Hell | Wofür |
|---|---|---|---|
| `--bg` | `#09090b` | `#fcfcfd` | Grund |
| `--leiste` | `#111113` | `#f4f4f6` | Titelleiste, Seitenleisten |
| `--karte` | `#18181b` | `#ffffff` | Felder, Karten |
| `--gedaempft` | `#27272a` | `#e9e9ee` | gewählt, Chips |
| `--rand` / `--rand-stark` | `#2a2a2e` / `#3f3f46` | `#dcdce3` / `#c4c4cc` | Linien |
| `--text` | `#fafafa` (19 : 1) | `#1b1b22` (16,7 : 1) | Inhalte |
| `--text2` | `#d4d4d8` (13,4 : 1) | `#3a3a44` (11 : 1) | Werte |
| `--text3` | `#a1a1aa` (7,8 : 1) | `#5c5c66` (6,4 : 1) | Hinweise |
| `--akzent` + `--auf-akzent` | `#4ade80` + `#052e16` (8,6 : 1) | gleich | Hauptknopf, Fläche |
| `--akzent-linie` | `#4ade80` (11,4 : 1) | `#15803d` (4,9 : 1) | Links, Symbole, Auswahlrahmen |
| `--ok` | `#2dd4bf` | `#0f766e` (5,3 : 1) | erledigt, geprüft |
| `--gelb` | `#fbbf24` | `#b45309` (4,9 : 1) | Warnung, Sterne |
| `--fehler` | `#fca5a5` | `#b91c1c` (6,3 : 1) | Konflikt, Fehler |
| Betrachter `--buehne` | `#050506` | `#e4e4e9` | Hintergrund hinter dem Bild |

Weitere Akzente: Himmelblau `#7dd3fc` (Linie hell `#0369a1`), Apricot `#fdba74` (`#c2410c`),
Flieder `#c4b5fd` (`#6d28d9`), jeweils mit dunkler Schrift auf der Fläche.

### Metadaten bearbeiten

Einzeln und für eine Auswahl: gemischte Werte zeigen „‹verschieden›“; geschrieben werden nur
geänderte Felder; Stichwörter **hinzufügen/entfernen** statt ersetzen. Geschrieben wird **in die
Datei**, bei RAW und schreibgeschützten Dateien in ein XMP-Sidecar (entschieden).

| Feld | Schreibt in (Startpunkt – im Labor gegen Windows-Explorer, digiKam und Lightroom prüfen) |
|---|---|
| Titel | `XMP-dc:Title`, `IPTC:ObjectName`, `XPTitle` |
| Beschreibung | MWG `Description` (EXIF `ImageDescription`, IPTC `Caption-Abstract`, `XMP-dc:Description`) |
| Stichwörter | MWG `Keywords` (IPTC `Keywords`, `XMP-dc:Subject`) und `XPKeywords` |
| Bewertung (0–5) | `XMP-xmp:Rating` und EXIF `Rating`/`RatingPercent` (Explorer) |
| Farblabel | `XMP-xmp:Label` |
| Aufnahmedatum | `DateTimeOriginal`, `CreateDate`, `OffsetTime*`, `XMP-photoshop:DateCreated` |
| Standort | `GPSLatitude/Ref`, `GPSLongitude/Ref`, `GPSAltitude/Ref`; entfernen = alle GPS-Tags |
| Ort (Text) | MWG `City`, `State`, `Country`, `Location` |
| Urheber, Copyright | MWG `Creator`, MWG `Copyright` |

- **Schreiben:** über die Warteschlange; vorher prüfen, ob die Datei seit dem Lesen geändert wurde
  (Größe + Änderungszeit); alte Werte ins Journal (Rückgängig); optional vollständige Sicherung;
  danach neu lesen und vergleichen; Dateidatum auf Wunsch behalten.
- Regeln im Skill [`metadaten-schreiben`](../.claude/skills/metadaten-schreiben/SKILL.md).

### Stapelverarbeitung

Assistent in fünf Schritten: **Auswahl → Aktionen (Kette) → Vorschau → Ausführen → Bericht**,
danach „Rückgängig“ für umkehrbare Aktionen. Voreinstellungen („Rezepte“) speicherbar.

| Aktion | Details |
|---|---|
| Umbenennen | Muster mit Platzhaltern `{name}`, `{datum:yyyy-MM-dd_HH-mm-ss}`, `{zähler:3}`, `{kamera}`, `{ort}`, `{titel}`, `{ext}`; Groß/Klein; Suchen/Ersetzen |
| Metadaten | Felder setzen, Stichwörter hinzufügen/entfernen, Urheber/Copyright für alle |
| Zeit verschieben | Uhrzeit der Kamera falsch gestellt: ± Tage/Stunden/Minuten, oder „dieses Bild war um 14:32“ → Versatz für alle |
| Standort | entfernen; setzen (Ort wählen); später aus GPX-Track zuordnen |
| Drehen/Spiegeln | verlustfrei über die EXIF-Ausrichtung (Standard) oder pixelweise |
| Konvertieren/Exportieren | Bilder: Format (JPEG, PNG, WebP, AVIF, TIFF), Qualität, längste Kante, Farbraum sRGB, Metadaten-Profil, Zielordner, Namensmuster. Videos: Kopie, Metadaten-Profil |
| Ordnen | in Ordner nach Datum verschieben/kopieren (`{jahr}/{monat}`) |
| Bearbeitung übertragen | Rezept eines Bildes auf die Auswahl anwenden (Phase 5) |

- **Vorschau** als Tabelle vorher/nachher mit Konflikten (gleicher Zielname, Groß/Klein unter
  Windows, reservierte Namen, Pfad zu lang, Ordner nur lesen) – nichts startet mit offenen Konflikten.
- **Ausführen** einzeln je Datei: ein Fehler stoppt nicht den Rest; Abbrechen jederzeit;
  Bericht mit Fehlern je Datei.
- Regeln im Skill [`stapelverarbeitung`](../.claude/skills/stapelverarbeitung/SKILL.md).

### Bildbearbeitung

- Drehen (90° und frei/Begradigen), Spiegeln, Zuschneiden (frei und Seitenverhältnisse),
  Größe ändern, Belichtung, Helligkeit, Kontrast, Sättigung, Farbtemperatur, Schärfen,
  Auto-Korrektur, Schwarzweiß.
- **Rezept** (versioniert, rein in `shared/editPlan.ts`) im Index; Vorschau im Renderer
  (Canvas/WebGL auf dem 768-px-Vorschaubild bzw. einer bildschirmgroßen Umrechnung), Ergebnis
  mit sharp aus dem Original. Test: Vorschau und Ergebnis stimmen innerhalb einer Toleranz überein.
- Speichern: **„Als Kopie speichern“** (Standard), „Original ersetzen“ (Sicherung, Metadaten
  übernehmen, Ausrichtung auf 1 setzen), Rückgängig/Wiederholen im Editor, Vorher/Nachher.

## Schutzkonzept für Bilddaten

„Gut geschützt“ wird in sechs Schichten umgesetzt (entschieden: A–F reichen; keine App-Sperre,
kein verschlüsselter Index, kein Tresor). A–D sind Pflicht ab Phase 1, E–F folgen.
Checkliste: Skill [`bildschutz`](../.claude/skills/bildschutz/SKILL.md).

| | Schicht | Umsetzung | Nachweis |
|---|---|---|---|
| **A** | **Nichts verlässt den Rechner** | Netzsperre: `session.webRequest` weist alles außer App-Seite und eigenen Protokollen ab; ESLint verbietet `node:http(s)`, `node:net`, `node:dgram`, Electrons `net` im main – **außer** in `services/update/` (eigene Sitzung, Host-Allowlist, nur nach Zustimmung); ffmpeg nur mit `-protocol_whitelist file` und `file:`-Pfaden (sonst öffnet es aus präparierten Dateien auch `http:`, `concat:` …); keine Telemetrie, keine Absturzberichte; Schriften/Symbole/Ortsdaten im Paket | E2E `netz`: lokaler Spion-Server bekommt nie eine Anfrage, auch nicht über Dateien mit Fremd-URLs (SVG, XMP, Playlist-Dateien); mit eingeschalteter Update-Prüfung nur die eine Anfrage an die Update-Adresse |
| **B** | **Originale unantastbar** | Standard ist lesen; jede schreibende Aktion ist ausdrücklich und nennt die Dateien; vorher Sicherung (`Sicherungen/`, Aufbewahrung einstellbar), atomar ersetzen, danach nachprüfen; Löschen nur in den Papierkorb (`shell.trashItem`), sonst ausdrückliche Rückfrage; Ordner-Modus „nur lesen“; Journal für Rückgängig | E2E `originale`: Prüfsummen aller Testdateien vor/nach jedem Lauf; nach Metadaten-Schreiben sind **Pixeldaten** bzw. **Video-/Tonspuren** gleich |
| **C** | **Renderer ohne Dateizugriff** | Sandbox, contextIsolation, kein Node, keine Webviews, keine Navigation (aus Mottulbox); Dateien nur über `thumb://`/`bild://` mit Kennungen aus dem Index; jeder IPC-Eingang wird geprüft (Allowlist, Grenzen); Schreiben nur in freigegebene Pfade | Unit-Tests der Protokolle (erfundene Kennung, `..`, Symlink aus dem Ordner) und E2E `security` |
| **D** | **Abgeleitete Daten geschützt** | Index und Vorschaubilder unter `%LOCALAPPDATA%` (nicht im Roaming-Profil, nicht in OneDrive); Vorschaubilder **AES-256-GCM-verschlüsselt**, Schlüssel über `safeStorage` (Windows-DPAPI, an das Benutzerkonto gebunden); „privat“-Ordner ohne Cache auf der Platte; Cache leeren; Ordner entfernen löscht alles Abgeleitete; Log ohne Metadaten-Werte (keine GPS-Daten, Titel o. Ä.) | Unit-Test Verschlüsselung (falscher Schlüssel, manipulierte Datei); E2E: Cache enthält keine JPEG-Signatur |
| **E** | **Weitergeben ohne Spuren** | Export standardmäßig **ohne Standort** (Bilder und Videos), wahlweise ohne Seriennummern/Besitzer oder ohne alle Metadaten; „Was steckt drin?“-Bericht vor dem Export | Labortest: exportierte Datei enthält keine GPS-Tags |
| **F** | **Lieferkette und Programm** | Wenige Laufzeit-Abhängigkeiten, exakt gepinnt, 7 Tage Abstand, `ignore-scripts`, Lockfile mit Integrity; ExifTool/ffmpeg/Electron mit Prüfsumme; Updates mit eigener Signatur; Fehlergrenzen, Wiederherstellung defekter DB/Einstellungen; Bilddienst als eigener Prozess | CI: `npm audit --omit=dev` ohne Befund, Prüfsummen in den Skripten; E2E `update` lehnt falsch signierte Installer ab |

## Installation und Auslieferung

- **Eine Datei:** `Galeria-Beata-<Version>-setup.exe` (NSIS, **One-Click, je Benutzer**):
  Doppelklick, keine Administratorrechte, keine Fragen, Startmenü- und Desktop-Verknüpfung,
  startet danach.
- **Alles im Paket:** ExifTool, ffmpeg/ffprobe, sharp/libvips, Ortsdaten, Schriften. Beim ersten
  Start wird **nichts** geladen; keine Laufzeitumgebung nötig (Electron bringt Chromium mit).
- **Portable Variante** (`Galeria-Beata-<Version>-portable.exe`, Phase 7): ohne Installation,
  z. B. vom USB-Stick; Daten wahlweise neben der Datei.
- **Bewusst unsigniert (entschieden):** SmartScreen meldet beim ersten Installieren
  „Unbekannter Herausgeber“ (*Weitere Informationen → Trotzdem ausführen*). `docs/INSTALL.md`
  zeigt den Weg mit Bildern, wie bei der Mottulbox. Updates prüft die App selbst über ihre eigene
  Signatur (unten).
- **Deinstallation** entfernt Programm **und** Cache/Index (enthält Vorschaubilder); Einstellungen
  und Sicherungen nach Rückfrage bzw. Doku. Umsetzung im Skill [`windows-paket`](../.claude/skills/windows-paket/SKILL.md).
- **„Öffnen mit“**/Dateizuordnung für JPEG, PNG, MP4 … (Phase 7), damit Doppelklick im Explorer
  Galeria Beata öffnet.
- Abnahme jeder Version in der **Windows-Sandbox ohne Netz** (`<Networking>Disable</Networking>`):
  installieren, Ordner hinzufügen, ansehen, Video abspielen, Metadaten schreiben, deinstallieren.

### App-Aktualisierung

**Wofür Updates nötig sind** – eine Bildbetrachter-App öffnet ständig fremde Dateien, und deren
Dekoder sind ein bekannter Angriffsweg:

| Komponente | Warum aktualisieren | Beispiel |
|---|---|---|
| **Electron/Chromium** | zeigt Bilder und Videos an (Dekoder für JPEG, PNG, WebP, AVIF, GIF, Video) | WebP-Lücke 2023 (CVE-2023-4863): präparierte Bilder konnten Code ausführen, in freier Wildbahn ausgenutzt |
| **ExifTool** | liest Metadaten aus fremden Dateien; kennt neue Kameras und RAW-Formate erst mit neuen Versionen | CVE-2021-22204: Codeausführung über eine präparierte Bilddatei (behoben in 12.24) |
| **sharp/libvips** | dekodiert alle Bilder für Vorschaubilder und Export | Dekoder-Fehler in Bildbibliotheken werden regelmäßig behoben |
| **ffmpeg** | liest Videos für Standbilder und Kennwerte | Video-Demuxer und -Dekoder sind große, oft gepatchte Angriffsfläche |
| **Ortsdaten, App selbst** | neue Orte (selten), Fehlerkorrekturen, neue Funktionen | – |

**Ein Weg für alles:** Electron lässt sich nicht einzeln austauschen, also ist jedes Update eine
neue Version des ganzen Pakets (alle Komponenten darin). Getrennte Selbst-Updates für ExifTool
oder ffmpeg wie in der Mottulbox braucht es damit nicht.

**Ablauf:**

1. **Beim ersten Start fragt die App einmal:** „Nach wichtigen Updates suchen? (höchstens einmal
   pro Woche, nichts über dich oder deine Bilder)“ – *Ja* oder *Nein*; jederzeit änderbar in den
   Einstellungen. Unabhängig davon: Knopf „Nach Updates suchen“ unter *Über*.
2. **Anfrage:** nur ein GET an die Release-Liste des Repos (feste Adresse, keine Kennung, keine
   Cookies, keine Daten aus der Bibliothek). Ohne Netz: still weiter, nächster Versuch nächste Woche.
3. **Anzeige:** neue Version mit kurzer Beschreibung; Releases tragen eine Markierung
   **„wichtig“** und nennen die betroffenen Komponenten („Sicherheitskorrektur: Chromium,
   ExifTool“). Wichtige Updates erscheinen als Hinweis in der Statusleiste, andere nur unter *Über*.
4. **Laden nur auf Klick**, dann Prüfung: SHA-256 aus der signierten Release-Beschreibung und
   **Ed25519-Signatur** gegen den öffentlichen Schlüssel, der fest in der App steckt (Node `crypto`,
   keine Abhängigkeit). Passt etwas nicht: verwerfen, nichts ausführen, Meldung.
5. **Installieren:** laufende Aufträge abwarten bzw. Rückfrage, dann den geprüften Installer
   starten (One-Click) und die App beenden; Bibliothek, Einstellungen und Journal bleiben.
   Migrationen laufen beim nächsten Start.

**Technik und Regeln:** eigener schlanker Updater in `services/update/` statt `electron-updater`
(der prüft ohne Windows-Code-Signatur nur eine Prüfsumme aus derselben Quelle – wer das
GitHub-Konto übernimmt, könnte sonst einen Installer unterschieben). Einzige Stelle im main mit
Netz-Zugriff (ESLint-Ausnahme nur für diesen Ordner), eigene Sitzung mit Host-Allowlist (GitHub-API
und Release-Downloads; Weiterleitungen nur innerhalb der Allowlist). Der **private
Signierschlüssel** bleibt beim Nutzer (Datei außerhalb des Repos, `npm run release:sign`); ein
Verlust heißt: neuer Schlüssel, Umstieg per manuellem Installer. Test: E2E `update` gegen einen
lokalen Schein-Release-Server (Muster `e2e/ffmpeg-update.mjs` der Mottulbox) – gültig, falsch
signiert, manipulierter Installer, kein Netz. Ob Windows bei einem von der App selbst geladenen
Installer SmartScreen zeigt, in der Sandbox prüfen.

## Phasen

Jede Phase endet mit einem installierbaren Stand, grüner CI und aktualisierter Doku. Zielwerte
sind vorläufig und werden in Phase 0 an Messungen geprüft.

### Phase 0 – Fundament und Labor

- ✅ Gerüst aus der Mottulbox (Tabelle oben): Build, Lint, Format, Typen, Tests, E2E-Harness, CI
  (Windows + Linux), Dependabot, `CLAUDE.md`, Doku-Gerüst (`docs/ENTWICKLUNG.md`,
  `docs/SICHERHEIT.md`, `docs/INSTALL.md`). Der Installer-Workflow (`installer.yml`) kommt mit
  dem Paket.
- ✅ Erscheinungsbild von Anfang an: Tokens für Hell/Dunkel (Akzent Hellgrün), Umschalter
  System/Hell/Dunkel (Standard: wie Windows, auch für Titelleiste und Dialoge).
- ✅ Netzsperre (Schicht A) und Fenster-Härtung (C) von Anfang an, mit E2E `netz` und `security`.
  Strenger als die Mottulbox: Wächter geben nichts an den Browser weiter, `file:` nur im Ordner der
  App-Seite, IPC prüft den Absender, CSP im Build ohne Inline-Skripte, eine Instanz je Benutzer.
- `scripts/download-exiftool.mjs` (`npm run exiftool:fetch`; offizielle Quelle, Version und
  SHA-256 fest im Skript), `scripts/download-ffmpeg.mjs` (aus der Mottulbox) und
  `scripts/testbilder.mjs` (synthetische Testbibliothek mit Bildern und kurzen Videos, nie echte
  Fotos).
- **Labor** (Skill `bild-labor`), Ergebnisse in diesen Plan:
  - sharp im Electron-Bilddienst: Vorschaubilder je Sekunde (24-MP-JPEG; Entwickler-Laptop
    i7-8750H mit 6 Kernen/12 Threads und 16 GB, zusätzlich mit `concurrency` 4 für 4-Kern-Rechner),
    Spitzenspeicher, `concurrency`, sehr große Bilder (Panorama > 100 MP), kaputte Dateien.
  - ExifTool `-stay_open`: Lesen von 1.000 / Schreiben von 100 Dateien, Unicode-Pfade
    (`-charset filename=utf8`), Pfade > 260 Zeichen, Netzlaufwerk.
  - Formatmatrix (was dekodiert sharp, was zeigt/spielt Chromium – auch HEVC –, was schreibt
    ExifTool).
  - Paket: `asarUnpack` für sharp/`@img`, ExifTool und ffmpeg über `extraResources`, Größe des
    Installers (LGPL- statt GPL-Build von ffmpeg).
  - better-sqlite3: 50.000 Zeilen in Stapeln einfügen – wie lange blockiert main je Stapel?
- **Abnahme:** leere App installiert und startet offline in der Windows-Sandbox; E2E grün auf
  Windows und Linux; Messwerte stehen hier.

### Phase 1 – Bibliothek und Galerie (erste nutzbare Version)

- Ordner hinzufügen/entfernen, Ordner-Modi, Scan, Überwachen, Bilddienst mit Neustart.
- Vorschaubilder (Stufen 256/768) verschlüsselt im Cache (Schicht D), sichtbare zuerst.
- Kacheln mit Größenregler, Liste/Details, Ordnerbaum, Auswahl, Statusleiste.
- Sortieren nach Name, Aufnahmedatum (Grundfelder schon beim Scan), Dateidatum, Größe, Typ.
- Betrachter: Vollbild, Zoom, Vor/Zurück, Filmstreifen, Diashow, Löschen in den Papierkorb.
- Formate: JPEG, PNG, WebP, GIF, AVIF, TIFF; BMP nach Labor.
- **Abnahme** (50.000 synthetische Bilder): Neustart mit vorhandenem Index bis zur sichtbaren
  Galerie < 2 s, Sortierwechsel < 200 ms, Scrollen ohne Ruckeln, Erstindex im Hintergrund ohne
  hängende Oberfläche; E2E `galerie`, `originale`.

### Phase 2 – Metadaten lesen, Filtern, Suchen

- Vollständiges Lesen per ExifTool, Info-Panel, „alle Felder“.
- Offline-Ortsnamen (GeoNames, Lizenz CC BY 4.0 – Hinweis in „Über“) und **Sortieren nach Ort
  (A–Z)** mit Gruppen.
- Sortieren nach allen weiteren Feldern; Gruppieren (Tag/Monat/Jahr, Ordner, Kamera, Ort);
  Blocksatz-Ansicht.
- Filterleiste, gespeicherte Ansichten, Volltextsuche.
- **Abnahme:** E2E `sortieren` mit bekannten Testbildern (Reihenfolge exakt erwartet, „Ohne
  Standort“ am Ende in beiden Richtungen).

### Phase 3 – Metadaten bearbeiten

- Bearbeiten-Panel einzeln/mehrfach, Felder aus `shared/metaFields.ts`.
- Schreiben mit Konfliktprüfung, Journal/Rückgängig, Sicherung, Nachprüfung, XMP-Sidecars.
- Schnellbewertung im Betrachter.
- **Abnahme:** E2E `metadaten` (Werte stehen danach in der Datei, Pixeldaten unverändert,
  Rückgängig stellt den alten Stand her); Checkliste von Hand: Explorer und digiKam zeigen Titel,
  Stichwörter, Bewertung.

### Phase 4 – Stapelverarbeitung

- Assistent, alle Aktionen der Tabelle außer „Bearbeitung übertragen“, Rezepte speichern.
- Zweistufiges Umbenennen (Tausch A↔B, nur Groß/Klein), Rückgängig über das Journal.
- Export mit Datenschutz-Profilen (Schicht E: ohne Standort ab Werk, ohne Seriennummern/Besitzer,
  ohne alle Metadaten) und „Was steckt drin?“-Bericht vor dem Export.
- **Abnahme:** E2E `stapel` (Vorschau = Ergebnis, Konflikte blockieren, Abbrechen hinterlässt
  keine halben Dateien, Rückgängig).

### Phase 5 – Bildbearbeitung und App-Aktualisierung → Version 1.0

- Editor mit Werkzeugen, Rezept, Vorschau/Ergebnis-Abgleich, Als Kopie / Original ersetzen.
- Rezept auf Auswahl übertragen (Stapel).
- **App-Aktualisierung** (Abschnitt oben): Frage beim ersten Start, Prüfung, signierte Releases,
  `npm run release:sign`, Installer-Workflow hängt Signatur und Release-Beschreibung an.
- **Abnahme:** Labortest Vorschau ↔ Ergebnis (PSNR-Grenze), E2E `editor` und `update`; Update von
  der Vorversion in der Windows-Sandbox (mit Netz nur für diesen Schritt).
- **Version 1.0** nach Phase 5 – ab hier erreichen Korrekturen die Nutzer über die App.

### Phase 6 – Weitere Formate: Videos, HEIC, RAW (fest eingeplant)

- **Videos** (Abschnitt [Videos](#videos)): Standbild und Kennwerte per ffmpeg, Abspielen im
  Betrachter, Aufnahmedatum und GPS aus den Video-Metadaten, Metadaten bearbeiten, Stapel.
  Formate: MP4/MOV (H.264, HEVC), WebM, AVI, MTS – was Chromium spielt, entscheidet das Labor.
- **HEIC** (iPhone): Dekoder im Labor vergleichen – das gebündelte ffmpeg (ist dann ohnehin da)
  oder libheif als WebAssembly im Bilddienst; Kriterien: Lizenz, Paketgröße, Geschwindigkeit,
  Bild-Raster (iPhone-HEIC besteht aus Kacheln), Farbprofil, EXIF-Ausrichtung. Vorschaubilder und
  Betrachter über `bild://` als Umrechnung; Metadaten schreibt ExifTool direkt in die HEIC-Datei.
- **RAW – die wichtigsten Formate zuerst (entschieden):** Canon CR2/CR3, Nikon NEF, Sony ARW,
  Fujifilm RAF, DNG (Adobe, viele Handys). Anzeige über das eingebettete Vorschau-JPEG (ExifTool
  `PreviewImage`/`JpgFromRaw`), keine RAW-Entwicklung; Metadaten nur als XMP-Sidecar (Original
  bleibt unberührt); Export aus dem Vorschau-JPEG mit Hinweis auf die Auflösung. Weitere (ORF,
  RW2, PEF …) nach Bedarf.
- Testdateien: synthetisch erzeugte Videos (lavfi) und HEIC; für RAW kleine, frei lizenzierte
  Musterdateien je Hersteller (Herkunft und Lizenz dokumentieren) – keine eigenen Fotos.
- Videos können auf Wunsch früher kommen (nach Phase 2), weil sie unabhängig von HEIC/RAW sind.
- **Abnahme:** Formatmatrix im Labor, E2E `galerie` mit Video-, HEIC- und RAW-Testdateien,
  `originale` mit Videos.

### Phase 7 – Erweiterungen nach Bedarf

Sortieren nach Entfernung zu einem Ort, Karte offline (Natural-Earth-Grundkarte), Duplikate
(exakt per Hash, ähnlich per Wahrnehmungs-Hash), GPX-Zuordnung, Vergleichsansicht,
Dateizuordnung, portable Variante.

## Tests und Qualität

- **Rein und getestet** (vitest): `sortFilter`, `renamePattern`, `batchPlan`, `editPlan`,
  `metaFields`, `updatePlan`, `dates`, `geo`, Argumentdateien für ExifTool, Protokoll-Prüfungen,
  Signaturprüfung.
- **Labortests** mit echtem sharp/ExifTool/ffmpeg auf synthetischen Dateien (`*.lab.test.ts`, wie
  `player.lab.test.ts` der Mottulbox).
- **E2E** (Playwright, gebaute App, frischer Benutzerordner, Testbibliothek aus
  `scripts/testbilder.mjs`): `smoke`, `security`, `netz`, `originale`, `galerie`, `sortieren`,
  `metadaten`, `stapel`, `editor`, `update`, `paket`.
- **Nie echte Fotos oder Videos** in Repository, Tests, Logs oder Fehlerberichten.
- Vor jedem Abschluss: Skill `abschluss-check`; zusätzlich `review-checkliste` und `bildschutz`.

## Risiken

| Risiko | Gegenmittel |
|---|---|
| ExifTool-Start/Durchsatz unter Windows langsam (Perl in der exe) | `-stay_open`, ein Prozess je Spur, stapelweise; im Labor messen. Rückfall fürs schnelle Lesen beim Scan: reiner JS-Leser (z. B. exifr), Schreiben bleibt bei ExifTool |
| Dekoder-Absturz an präparierten Dateien | Bilddienst als eigener Prozess, Zeitlimit je Datei, Datei als „defekt“ markieren; Updates für Dekoder |
| `fs.watch` verpasst Änderungen (Netzlaufwerk, Überlauf) | Abgleich beim Start, bei Fokus und periodisch; Überlauf → Ordner neu abgleichen |
| Metadaten erscheinen in anderen Programmen nicht | Feld-Zuordnung im Labor gegen Explorer/digiKam/Lightroom prüfen, MWG-Regeln |
| Chromium spielt manche Videos nicht (HEVC je nach Rechner, AVCHD) | Klarer Hinweis + „Mit Standardprogramm öffnen“; Abspiel-Kopie nur nach Labor-Entscheidung |
| Update-Weg wird missbraucht (Konto übernommen) | Eigene Ed25519-Signatur, Schlüssel nur beim Nutzer; Laden nur auf Klick |
| Signierschlüssel verloren | Neuer Schlüssel, Umstieg einmalig per manuellem Installer; Sicherungskopie des Schlüssels offline |
| SmartScreen schreckt ab (unsigniert, entschieden) | INSTALL.md mit Bildern; Installer-Name und Herausgeber-Angaben eindeutig |
| Große Bibliotheken (100.000 Dateien) | Kennungslisten statt Objekte über IPC, Indizes, virtualisiertes Raster; Messung mit 100.000 synthetischen Dateien |
| Zeitzonen beim Aufnahmedatum (besonders Videos: UTC) | Datum „lokal wie in der Kamera“ speichern, Versatz getrennt; Zeitverschiebung als eigene Stapel-Aktion |
| Paketgröße wächst durch ffmpeg | LGPL-Build mit nur den nötigen Teilen prüfen; Größe je Version notieren |

## Entscheidungen und offene Fragen

**Entschieden (25. Oktober 2026):**

- **Name:** Arbeitstitel „Galeria Beata“.
- **Schutz:** die Schichten A–F; keine App-Sperre, kein verschlüsselter Index, kein Tresor.
- **„Sortieren nach GPS“** heißt: Orte alphabetisch (A–Z), gruppiert, ohne Standort am Ende.
- **Videos:** ja – anzeigen, abspielen, sortieren, Metadaten; kein Schnitt (Phase 6, auf Wunsch früher).
- **HEIC und RAW:** gebraucht, Phase 6; RAW zuerst CR2/CR3, NEF, ARW, RAF, DNG.
- **Bibliothek:** ausgelegt auf bis 100.000 Dateien.
- **Metadaten** in die Datei; Sidecar für RAW und schreibgeschützte Dateien.
- **Updates in der App** für wichtige Komponenten – Prüfung nur nach Zustimmung beim ersten Start,
  eigene Signatur (Phase 5, vor Version 1.0).
- **Code-Signatur:** keine, der Installer bleibt unsigniert.
- **Erscheinungsbild:** Hell-/Dunkelmodus (Standard: wie Windows), Akzent Hellgrün statt Gold.
- **Umsetzung** lokal auf dem PC des Nutzers.
- **Eigenständige App**, kein Werkzeug der Mottulbox; Bausteine werden in Phase 0 einmalig
  kopiert, danach besteht keine Verbindung (siehe [Tabelle](#was-aus-der-mottulbox-übernommen-wird)).
- **Logo:** vorerst einfaches Bild-Symbol in Hellgrün; ein eigenes Logo kann später folgen.
- **Paket nur für Windows**; Linux läuft nur in der CI für E2E mit.
- **Update-Prüfung ab Werk:** einmalige Frage beim ersten Start (siehe [App-Aktualisierung](#app-aktualisierung)).

**Noch offen:** nichts. Neue Fragen hier eintragen.

## Skills

In `.claude/skills/` angelegt. Aus der Mottulbox übernommen und angepasst:

| Skill | Wofür |
|---|---|
| `abschluss-check` | Prüfung vor Commit/PR: Format, Lint, Typen, Tests, E2E, Doku, Bericht |
| `ipc-kanal` | neue IPC-Fläche (Channel, API, Preload, Handler) mit Eingabeprüfung |
| `electron-e2e` | E2E-Tests der gebauten App, bewährte Muster und Grenzen aus der Mottulbox |
| `abhaengigkeiten` | Pakete mit 7 Tagen Abstand, Electron-Hauptversionen, native Module (sharp, better-sqlite3), ExifTool, ffmpeg |
| `review-checkliste` | bestätigte Fehlerklassen aus den Mottulbox-Reviews, ergänzt um Bild-spezifische |

Neu für Galeria Beata:

| Skill | Wofür |
|---|---|
| `bild-labor` | Bild- und Videoverfahren (sharp, ExifTool, ffmpeg, Formate) messen statt raten – Testdateien, Pixel, Durchsatz, Speicher |
| `bibliothek-index` | Scan, Überwachen, Index-Schema, Migrationen, Sortier-/Filter-Abfragen, Leistung |
| `metadaten-schreiben` | Metadaten sicher schreiben: Feld-Zuordnung, ExifTool-Aufrufe, Journal, Nachprüfung, Sidecars |
| `stapelverarbeitung` | Stapel planen, Konflikte, zweistufiges Umbenennen, Ausführen, Bericht, Rückgängig |
| `bildschutz` | Schutzkonzept A–F als Prüfliste vor jeder Änderung, die Dateien, Cache, Netz oder Export berührt |
| `windows-paket` | Installer (One-Click, je Benutzer), Ressourcen im Paket, Offline-Test in der Windows-Sandbox, App-Aktualisierung und Release-Signatur |

Nicht übernommen, weil Mottulbox-spezifisch: `projektdatei`, `kabelverlauf`, `anleitung-inhalte`,
`fernsteuerung-seite`, `konvertierungs-kern`, `neues-werkzeug`, `ffmpeg-labor` (Vorgehen steckt in
`bild-labor`), `aufraeumen` (bei Bedarf später samt Skripten übernehmen).
