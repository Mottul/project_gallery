# Plan: Galeria Beata – Bildbetrachter und -bearbeiter für Windows

Arbeitstitel „Galeria Beata“ (Repo `project_gallery`). Stand 29. Oktober 2026: Phase 0 und
Phase 1 sind umgesetzt ([Phase 1](#phase-1--bibliothek-und-galerie-erste-nutzbare-version)), als
Nächstes kommt Phase 2. Dieser Plan ist die Grundlage für die
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
in einem Grafikprogramm, Gesichtserkennung, Video-Schnitt und -Umwandlung. (Eine Diashow als Video
speichern ist kein Schnitt – vorgemerkt in [Phase 7](#phase-7--erweiterungen-nach-bedarf).)

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
5. **Überwachen** (seit 1.6): `fs.watch` rekursiv im Bilddienst (lokal), gemeldete Pfade
   gesammelt (300 ms Ruhe, spätestens 2 s) → Teil-Abgleich nur dort; zu viele oder ein Ereignis
   ohne Namen → ganzer Abgleich. Verschobene/umbenannte Dateien behalten Kennung, Metadaten und
   Vorschaubild. Netzlaufwerke (UNC, auch verbundene Laufwerke) periodisch (5 min) und beim Fokus;
   nicht erreichbare Ordner alle 30 s und beim Fokus. Abgleich beim Start wie bisher.
6. **Renderer** fragt `library.query({ sortierung, filter, gruppierung })` → geordnete Liste der
   Kennungen + Anzahl; Details nur für den sichtbaren Ausschnitt; Bilder über `thumb://id/<kennung>/<stufe>`.

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
| `thumb://id/<kennung>/<stufe>` | Vorschaubild (Stufe 256 oder 768 px, entschlüsselt); 404 = Kennung unbekannt, 204 = Bild bekannt, aber ohne Vorschau (defekt) – so entsteht in der Seite kein Konsolenfehler | Kennung ganzzahlig, Stufe aus Allowlist, nur GET, nur aus dem Cache (bzw. Arbeitsspeicher bei „privat“). Fester Rechnername „id“: Chromium liest bei einem Standard-Protokoll einen Rechnernamen aus Ziffern als IP-Adresse („42“ → „0.0.0.42“) – gilt ebenso für `bild://` |
| `bild://id/<kennung>` | Original, wenn Chromium es darstellen kann (JPEG, PNG, WebP, GIF, AVIF, BMP; Typ nach Inhalt, nicht nach Endung; später Videos MP4/WebM …), gestreamt mit **Range-Anfragen** (206, 416); sonst eine bildschirmgroße Umrechnung aus dem Bilddienst (TIFF, später HEIC/RAW: höchstens 3840 px, aufgerichtet, JPEG bzw. WebP bei Alpha; nur im Arbeitsspeicher, 64 MB). 404 = unbekannt oder Datei fehlt, 409 = seit dem Einlesen geändert, 403 = außerhalb des Ordners, 503/504 = gesperrt bzw. Zeitlimit, 204 = bekannt, aber nicht darstellbar | Kennung ganzzahlig, nur GET, `Cache-Control: no-store`; Kennung muss im Index stehen; vor jedem Lesen (5 s Zeitlimit): keine Verknüpfung, Größe und Änderungszeit wie im Index, echter Pfad (nach `realpath`) im Bibliotheksordner (`dateien/pruefeDatei.ts`, dieselbe Prüfung wie im Bilddienst) |

CSP der Seite: `img-src 'self' data: blob: thumb: bild:`, `media-src bild:`, `connect-src 'self'`,
kein `unsafe-eval`; im Build auch keine Inline-Skripte (umgesetzt in Phase 0, die Protokolle
kommen mit Phase 1 dazu).

## Funktionen im Detail

### Bibliothek und Ordner

- Ordner hinzufügen/entfernen (Dialog oder **Drag & Drop** aus dem Explorer – seit 1.4), rekursiv,
  Unterordner einzeln ausschließen.
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
  `OffsetTimeOriginal`) → `CreateDate` → XMP `photoshop:DateCreated` → die **ältere** von
  Dateierstellung und Änderungszeit (entschieden in 1.2: Beim Kopieren setzt Windows die
  Erstellzeit neu und behält die Änderungszeit, beim Bearbeiten umgekehrt – die ältere liegt
  näher an der Aufnahme). Bis ExifTool gelesen hat, steht dieses Dateidatum schon im Index, so
  sortiert „nach Datum“ ohne Lücken. Die Quelle wird gespeichert und im Info-Panel genannt
  („Datum aus Datei, nicht aus der Kamera“). Videos siehe [Videos](#videos).
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

- Doppelklick öffnet; Vollbild (F11), Anpassen / 100 % / Schieberegler / Mausrad-Zoom am
  Mauszeiger (sanft gleitend, am Touchpad feine Schritte), Verschieben, Vor/Zurück (Pfeiltasten,
  auch über Gruppengrenzen), Filmstreifen, Diashow mit Intervall.
- **Kein Moment ohne Bild:** Das gezeigte Bild bleibt stehen, bis das nächste geladen und
  dekodiert ist; die Diashow schaltet erst weiter, wenn das nächste bereit ist.
- **Diashow mit Überblenden und Ken-Burns-Effekt** (Phase 2): Übergang Schnitt/Überblenden, Ken
  Burns aus/automatisch (wechselnd Zoom rein/raus, Hochkant schwenkt senkrecht), Stärke sanft/
  mittel/stark – als CSS-Animation der beiden Bild-Ebenen. Bahn und Übergänge nach dem
  Video-Generator der Mottulbox (`shared/videoGenPlan.ts`: `kenBurnsPath`; `transitionCss.ts`),
  kopiert und angepasst, nicht verknüpft.
- Info-Panel (seit 2.1): Titel, Beschreibung, Bewertung, Farblabel, Stichwörter, Aufnahme mit
  Quelle des Datums, Kamera, Objektiv, Belichtung, Standort (Koordinaten; Ortsname ab 2.2),
  Datei, „alle Felder“ (auf Abruf frisch aus der Datei, mit Suche); Histogramm später.
- Schnell bewerten (Tasten 0–5), Farblabel (6–9), drehen (verlustfrei, siehe Stapel), löschen
  (Papierkorb).
- Vorladen und Dekodieren der Nachbarbilder; Chromium nimmt das vorgeladene Bild für dieselbe
  Adresse wieder, obwohl `bild://` mit `no-store` antwortet (gemessen, E2E `betrachter`).
  EXIF-Ausrichtung beachtet Chromium selbst, sharp bei Vorschaubildern.
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
- ✅ `scripts/download-exiftool.mjs` (`npm run exiftool:fetch`; ExifTool 13.59 aus der
  offiziellen Quelle, Version und SHA-256 fest im Skript), `scripts/download-ffmpeg.mjs`
  (`npm run ffmpeg:fetch`; statt „latest“ wie in der Mottulbox ein fest gepinnter Monats-Build,
  n9.0.2 LGPL) und `scripts/testbilder.mjs` (synthetische Testbibliothek mit Bildern, kaputten
  Dateien und kurzen Videos samt `testbilder.json`, nie echte Fotos; Labortest prüft sie nach).
  sharp 0.35.5 ist als erste Laufzeit-Abhängigkeit dazugekommen.
- **Labor-Befunde bisher** (Windows 11, i7-8750H; sharp 0.35.5, ExifTool 13.59, ffmpeg n9.0.2):
  - ffmpeg statisch: `ffmpeg.exe` und `ffprobe.exe` je 134 MB (zusammen 257 MB). Als „shared“-Build
    teilen sie sich die DLLs: 150 MB, gleiche Dekoder (H.264, HEVC, AV1/dav1d, VP9, ProRes) →
    **entschieden: shared für Windows**.
  - **sharp hält gelesene Dateien offen** (libvips-Datei-Cache): Unter Windows ließ sich danach der
    Ordner nicht löschen. Bilddienst muss `sharp.cache({ files: 0 })` setzen, sonst blockiert die
    Galerie Umbenennen/Löschen von Bildern, die gerade angesehen wurden.
  - **ExifTool erkennt kaputte Bilder nicht zuverlässig:** Ein abgeschnittenes JPEG liest es ohne
    Fehler (nur der Kopf zählt); den Typ bestimmt es aus dem Inhalt (Text mit `.png` = `TXT`).
    „Defekt“ entscheidet der Bilddienst mit sharp (`failOn: 'truncated'`), nicht der Scan per ExifTool.
  - HEVC-Testvideos lassen sich nur mit einem Encoder des Rechners erzeugen (Media Foundation);
    auf dem Entwickler-Laptop fehlt er – HEVC-Abspielen wird mit einer fremden Testdatei geprüft (Phase 6).
  - Testbibliothek (31 Bilder, 5 Videos, 4 defekte Dateien): 3,8 s. Seit 1.3 mit einem BMP
    (von Hand geschrieben – sharp kann BMP weder schreiben noch lesen; ffprobe liest es).
  - **Vorschaubilder (1.3, `vorschau.lab.test.ts`):** alle acht Ausrichtungen pixelgenau in
    beiden Stufen; Display-P3-Rot bleibt nach sRGB kräftig (255/0/0), ohne Profil gelesen wäre es
    blasser (Gegenprobe); CMYK nah am Original; BMP über ffmpeg richtig herum; jede kaputte
    Testdatei lehnt sharp ab. **GIF hat bei sharp immer einen Alpha-Kanal** und wird darum als
    WebP abgelegt (Transparenz bleibt). Eine „BMP“-Datei, die in Wahrheit eine Playlist auf einen
    lokalen Spion-Server ist, löst bei ffmpeg mit `-protocol_whitelist file` keine Anfrage aus.
  - **thumb:// und die Konsole (1.3, E2E):** Jede Antwort 404 auf ein `<img>` erscheint in der
    Seite als Konsolenfehler; 204 nicht (gemessen mit lauter 204). Darum 204 für „bekannt, aber
    ohne Vorschau“.
- ✅ **Labor-Messungen** (Skripte in `scripts/labor/`, wiederholbar; alle unter Electrons Node
  wie später im Bilddienst bzw. main):
  - **sharp – Vorschaubilder** (`sharp-durchsatz.mjs`, 24-MP-JPEG 6,2 MB → 768 px, daraus 256 px):

    | Einstellung | Bilder/s | Spitzenspeicher |
    |---|---|---|
    | ein Bild nach dem anderen | 9,3 | 95 MB |
    | 4 parallel, `concurrency` Vorgabe (12) | 31,5 | 144 MB |
    | 4 parallel, `concurrency(1)` (≈ 4-Kern-Rechner) | 35,6 | 111 MB |
    | **6 parallel, `concurrency(1)`, `UV_THREADPOOL_SIZE` 6** | **45,3** | **139 MB** |
    | 12 parallel, `concurrency(1)` | 51,0 | 227 MB |
    | 4 parallel ohne `fastShrinkOnLoad` | 22,7 | 236 MB |

    → **Bilddienst: mehrere Bilder parallel mit je einem libvips-Thread** (`sharp.concurrency(1)`,
    parallel = halbe Thread-Zahl, mindestens 2; `UV_THREADPOOL_SIZE` = parallel + 2 für `fs`),
    `fastShrinkOnLoad` an. 50.000 Vorschaubilder ≈ 19 min im Hintergrund (Dateien aus dem Cache;
    von USB-Platte langsamer). Panorama 30.000 × 2.000: 160 ms / 89 MB; 108 MP: 290 ms / 117 MB –
    `limitInputPixels` (Vorgabe 268 MP) reicht.
  - **ExifTool `-stay_open`** (`exiftool-durchsatz.mjs`, kleine JPEGs mit Kamera-Metadaten):
    Prozessstart 0,2 s (kein Kaltstart-Problem); Lesen einzeln 71/s, in Stapeln von 50 **165/s**,
    `-fast2` bringt bei JPEG nichts; **2/3/4 Prozesse parallel 315/436/567 Dateien/s** (fast
    linear) → 50.000 Dateien in rund 90 s mit 4 Prozessen. Schreiben 64 Dateien/s; Pixel danach
    gleich, Dateidatum mit `-P` behalten. Unicode-Namen (Umlaute, Emoji) über das Argumentfile
    und Pfade mit 324 Zeichen lesen und schreiben ohne Fehler. → Der Rückfall auf einen
    JS-Leser (Risiken) ist nicht nötig. Netzlaufwerk noch offen (kein NAS am Laptop).
  - **Formatmatrix** (`formate.mjs`, Chromium in der gebauten App über `blob:`):

    | Format | sharp dekodiert | Chromium zeigt/spielt | ExifTool schreibt |
    |---|---|---|---|
    | JPEG (auch progressiv, CMYK, P3), PNG (16 Bit, Alpha), WebP, GIF, AVIF, animiert | ja | ja | ja |
    | TIFF | ja | **nein** → Umrechnung über `bild://` | ja |
    | BMP | **nein** (Binaries ohne BMP) | ja | nein |
    | SVG | ja (librsvg) | ja, mit MIME-Typ | nein |
    | Datei mit falscher Endung (PNG als `.jpg`) | ja | ja | **nein** („Not a valid JPG“) |
    | MP4/MOV H.264+AAC, hochkant, < 1 s; MP4 AV1 | – | ja | ja |
    | WebM VP9+Opus, MKV H.264 | – | ja | **nein** (WebM/MKV nicht schreibbar) |
    | MOV ProRes, AVI MPEG-4 | – | **nein** → Hinweis + „Mit Standardprogramm öffnen“ | ProRes ja, AVI nein |
    | HEVC | – | nicht prüfbar (kein Encoder am Laptop) | – |

    → Metadaten von WebM/MKV/AVI, BMP und SVG nur lesen (oder XMP-Sidecar, Phase 3); vor dem
    Schreiben Endung und Inhalt abgleichen (sonst lehnt ExifTool ab).
  - **better-sqlite3** (`sqlite-index.mjs`, 50.000 Zeilen nach dem Index-Entwurf samt
    Stichwörtern und FTS5, WAL): Stapel 250 / 1.000 / 5.000 blockieren main im Median 40 / 87 /
    200 ms (höchstens 97 / 139 / 244 ms); gesamt 8,5 / 4,2 / 2,0 s; Datei 27 MB. Öffnen nach
    Neustart 3 ms. Alle Sortier- und Filterabfragen über 50.000 Zeilen 2–47 ms (Ziel < 200 ms);
    Details für 200 sichtbare Kacheln 0,4 ms. „Ohne Ort am Ende“ per `IS NULL` sortiert ohne Index
    (36 statt 11 ms) → eigene Spalte im Index (Skill `bibliothek-index`).
- ✅ **Paket** (`electron-builder.yml`, `npm run package`): NSIS One-Click je Benutzer, unsigniert,
  aber mit Symbol und Versionsangaben in der exe (`signExecutable: false`, neu in electron-builder
  26.17). **Installer 179 MB** (Plan: 150–250 MB); entpackt 575 MB, davon ffmpeg 150 MB, ExifTool
  35 MB, sharp + better-sqlite3 22 MB. E2E `paket`: Start aus `app.asar`, sharp und better-sqlite3
  aus `app.asar.unpacked`, ExifTool und ffmpeg aus `resources/` – Gegenprobe ohne `asarUnpack`
  für sharp rot. Installer-Workflow (`installer.yml`) baut bei Tag `v*` einen Release-**Entwurf**.
- ✅ **Abnahme (25.10.2026, Stand `main` nach #1–#6):** E2E grün auf Windows und Linux; Messwerte
  stehen hier; **leere App installiert und startet offline in der Windows-Sandbox**
  (`npm run abnahme:sandbox`, 14 von 14 Prüfungen): Sandbox ohne Netz, Installer still in 25 s
  ohne Rückfrage, je Benutzer unter `%LOCALAPPDATA%\Programs\galeria-beata`, Startmenü- und
  Desktop-Verknüpfung (mit Symbol), ExifTool 13.59 und ffmpeg n9.0.2 starten aus der
  Installation, Fenster „Galeria Beata“ erscheint (Bildschirmfoto geprüft: Oberfläche hell nach
  Windows, Statusleiste „Offline“), die Netzsperre musste nichts abweisen, Deinstallation entfernt
  Programmordner und Verknüpfungen; Einstellungen bleiben wie geplant.
  Noch nicht geprüft und für später vorgemerkt: SmartScreen bei einem heruntergeladenen Installer
  (Bild für `docs/INSTALL.md`, mit dem ersten Release), Netzlaufwerk für ExifTool, HEVC.
- **Phase 0 abgeschlossen.**

### Phase 1 – Bibliothek und Galerie (erste nutzbare Version)

- Ordner hinzufügen/entfernen, Ordner-Modi, Scan, Überwachen, Bilddienst mit Neustart.
- Vorschaubilder (Stufen 256/768) verschlüsselt im Cache (Schicht D), sichtbare zuerst.
- Kacheln mit Größenregler, Liste/Details, Ordnerbaum, Auswahl, Statusleiste.
- Sortieren nach Name, Aufnahmedatum (Grundfelder schon beim Scan), Dateidatum, Größe, Typ.
- Betrachter: Vollbild, Zoom, Vor/Zurück, Filmstreifen, Diashow, Löschen in den Papierkorb.
- Formate: JPEG, PNG, WebP, GIF, AVIF, TIFF; BMP (entschieden 25.10.2026: Vorschaubild per
  ffmpeg, Anzeige direkt in Chromium, Metadaten nur lesen – sharp kann BMP nicht).
- **Abnahme** (50.000 synthetische Bilder): Neustart mit vorhandenem Index bis zur sichtbaren
  Galerie < 2 s, Sortierwechsel < 200 ms, Scrollen ohne Ruckeln, Erstindex im Hintergrund ohne
  hängende Oberfläche; E2E `galerie`, `originale`.
- ✅ **Abnahme gemessen** (29.10.2026, `npm run e2e -- abnahme50k`; Windows 11, i7-8750H, SSD;
  50.000 kleine JPEGs 160 × 120 in 240 Jahr/Monat-Ordnern, 93 MB):

  | Ziel | gemessen |
  |---|---|
  | Neustart bis zur sichtbaren Galerie < 2 s | **1,16 s** (Median aus 3: 1,29 / 1,13 / 1,16 s; Fenster nach 0,5–0,6 s) |
  | Sortierwechsel < 200 ms | Abfrage höchstens 71 ms, Raster mit neuer Reihenfolge Median 4 ms, höchstens 72 ms |
  | Scrollen ohne Ruckeln | 241 Bilder in 4 s, 95 % unter 17 ms, keins über 50 ms |
  | Erstindex ohne hängende Oberfläche | IPC Median 57 ms, 99 % unter 177 ms, höchstens 391 ms; main einmal 260 ms blockiert; Renderer ohne lange Aufgaben |

  Erstindex: eingelesen und Grundfelder nach 136 s, alle Vorschaubilder nach 614 s (rund 80/s
  bei kleinen Bildern – die Zeit je Bild geht in Lesen, Verschlüsseln und zwei Dateien, nicht ins
  Dekodieren). Abgleich beim Start (unverändert): 10–11 s im Bilddienst, im main 0,5 s.
  Arbeitsspeicher: main höchstens 240 MB beim Erstindex (180 MB nach dem Neustart), Seite
  210 MB, Bilddienst 200 MB (93 MB). Lokaler Datenordner 217 MB (Index und 100.000
  verschlüsselte Vorschaubilder).
  **Vorher gefunden und behoben:** ein UPSERT je Zeile (7 s main-Zeit je Abgleich), gestaute
  Nachrichten des Bilddienstes (main bis 6,8 s blockiert, IPC bis 12,7 s, Neustart 18 s bis zur
  Galerie), Lese-Ereignisse von Windows als Änderung (zwei überflüssige ganze Abgleiche beim
  Erstindex), ein zweiter Abgleich durch den ersten Fokus beim Start. Einmal in sieben Läufen
  zeigte das Raster einen Sortierwechsel nicht (nicht nachstellbar; die Messung schreibt bei
  einem Fehlschlag jetzt mit, was die Oberfläche stattdessen zeigt).
- ✅ **Sandbox-Abnahme mit Testbildern** (29.10.2026, `npm run abnahme:sandbox`, Windows-Sandbox
  ohne Netz, alle Prüfungen bestanden): Installer still in 35 s; die installierte App liest die
  Testbibliothek aus „Bilder“ ein (36 Bilder, Grundfelder und Vorschaubilder in 1 s), überwacht
  den Ordner live, zeigt Vorschaubilder, sortiert nach Name natürlich, zeigt das Original im
  Betrachter, nimmt eine Datei von außen auf; Prüfsummen und Änderungszeiten der Testbilder
  unverändert; Vorschaubilder nur verschlüsselt (keine JPEG-Signatur); die Netzsperre musste
  nichts abweisen; nach der Deinstallation kein Index und kein Cache mehr in `%LOCALAPPDATA%`,
  die Testbilder bleiben.
- **Phase 1 umgesetzt.**

**Teilschritte** (je ein Pull Request gegen `main`, jeder für sich grün und installierbar):

| | Inhalt | E2E |
|---|---|---|
| 1.1 ✅ | **Bibliothek-Fundament:** Index-DB (better-sqlite3, Migrationen, lokaler Datenordner unter `%LOCALAPPDATA%`), Bilddienst als utilityProcess mit Neustart, Scan (rekursiv, Ausschlüsse, Abgleich, „fehlt“/„nicht erreichbar“), Ordner hinzufügen/entfernen/neu einlesen, Ordner-Modi, Ordnerliste mit Anzahl | `galerie` (Ordner, Anzahl, Neustart), `originale`; Sandbox: Index lokal, nach Deinstallation weg |
| 1.2 ✅ | **Grundfelder und Sortieren:** Maße (aufgerichtet), Ausrichtung, Format nach Inhalt, Kamera, Aufnahmedatum (Rangfolge, `dates.ts`, `grundfelder.ts`) per ExifTool-Pool im Bilddienst (bis 4 Prozesse, Stapel zu 200, Warteschlange `meta_read_at IS NULL`); Migration 2 (vorläufiges Dateidatum, Indizes je Sortierung); `sortFilter.ts`; `library.query` liefert Kennungen, `library.details` höchstens 1000; vorläufige Tabelle mit „Sortieren nach“ | `sortieren` (Name, Datum, Dateidatum, Größe, Typ; kein ExifTool nach dem Beenden), `originale` (nach dem Lesen aller Metadaten) |
| 1.3 ✅ | **Vorschaubilder:** sharp im Bilddienst (halbe Thread-Zahl parallel, `concurrency(1)`, `UV_THREADPOOL_SIZE` passend; Datei erst in den Speicher gelesen – klare Fehlercodes, keine offene Datei), 768 px und daraus 256 px, JPEG 80 bzw. WebP bei Alpha-Kanal, EXIF-Ausrichtung, sRGB; BMP per ffmpeg (`-protocol_whitelist file`); vor dem Lesen: Datei passt zum Index, echter Pfad im Bibliotheksordner; AES-256-GCM-Cache (Zusatzdaten: Bild, Stufe, Größe, Änderungszeit, Verfahren) mit Schlüssel über `safeStorage`; Migration 3 (`color`, Teilindex); Warteschlange mit Vorrang für Abrufe über `thumb://` (lazy geladene Bilder = sichtbare zuerst), zweiter Absturz an einer Datei = defekt; Ordner „privat“ nur im Speicher, Wechsel nach „privat“ und Entfernen löschen die Cache-Dateien sofort | `galerie` (Bilder erscheinen, Ausrichtung pixelgenau, Cache verschlüsselt, „privat“, Neustart ohne Neuerzeugen, Entfernen ohne Reste, Log ohne Inhalte), `security` (`thumb://`), `paket` (Bilddienst im Paket); Labortest `vorschau.lab.test.ts` |
| 1.4 ✅ | **Galerie-Oberfläche** nach dem Entwurf: Ordnerbaum („Alle Bilder“, Bibliotheksordner mit Unterordnern und Anzahl, Filter auf Ordner samt allem darunter), virtualisiertes Raster (`@tanstack/react-virtual`; Kacheln füllen die Breite, Größenregler 80–320 px und Strg + Mausrad), Liste/Details (wählbare Spalten, Sortieren per Überschrift), Ansicht/Größe/Sortierung je Ordner gemerkt, Auswahl wie im Explorer (Klick, Strg, Umschalt, Strg+A, Esc, Rahmen), Statusleiste mit Anzahl, Auswahl und Summe; der Renderer meldet den sichtbaren Ausschnitt (Vorschau-Vorrang); **neu auf Wunsch: Ordner per Drag & Drop** aus dem Explorer (Pfad liest der Preload aus dem gezogenen Datei-Objekt) | `galerie` (Baum, Auswahl, Rahmen, Größe, Liste, Ansicht je Ordner, echter Drop über das DevTools-Protokoll, 600 Bilder virtualisiert, untergeschobene Datei abgelehnt) |
| 1.5 ✅ | **Betrachter:** `bild://id/<kennung>` (Original mit Range-Anfragen, TIFF im Bilddienst umgerechnet, Prüfung wie beim Vorschaubild, siehe „Protokolle“); Betrachter als Dialog über der Galerie (Doppelklick oder Enter, Esc zurück – das zuletzt gezeigte Bild bleibt gewählt): Vorschau 768 als Platzhalter, Anpassen / 100 % / Mausrad am Zeiger / Verschieben / Doppelklick, Vor/Zurück (Pfeile, Pos1/Ende), virtualisierter Filmstreifen, Diashow (2–10 s), Vollbild (F11), Info (Aufnahme mit Quelle des Datums, Kamera, Datei), Nachbarn vorgeladen; **Papierkorb** (Entf): Rückfrage im main mit Namen, nie in Ordnern „nur lesen“, nach der Rückfrage frischer Stand aus dem Index, je Datei Prüfung (mit Zeitlimit) und `shell.trashItem`, erst danach Index-Zeile und Vorschaubilder weg; geht der Papierkorb nicht (Netzlaufwerk), bleibt alles, wie es ist – endgültiges Löschen mit eigener Rückfrage ist noch offen | `galerie` (Blättern, Filmstreifen, `bild://` byte-gleich, Range, TIFF, Typ nach Inhalt, geänderte Datei 409, Zoom, Ausrichtung, Info, Diashow, Papierkorb), `security` (`bild://`), `originale` (jedes Bild einmal über `bild://`); Unit `anzeige.test.ts`, `library.test.ts` (Papierkorb), Labortest der Umrechnung |
| 1.5+ ✅ | **Feinschliff Betrachter** nach eigener Probe mit Fotos (29.10.2026): Diashow und Blättern ohne „Blitzer“ (zwei Ebenen: das alte Bild bleibt, bis das neue dekodiert ist; Diashow wartet auf das nächste), Filmstreifen nicht mehr vom Scrollbalken angeschnitten, Zoom mit Schieberegler (logarithmisch), Stufen-Menü an der Prozentzahl, sanftem Übergang und feinen Touchpad-Schritten (`lib/zoom.ts`). Die Anordnung der Werkzeugleiste bleibt vorerst, wie sie ist | `betrachter` (kein Moment ohne Bild beim Blättern und in der Diashow – auch bei 4000 × 3000 –, Vorladen ohne zweiten Abruf, Filmstreifen ganz sichtbar, Zoom; Gegenprobe am alten Stand rot); Unit `zoom.test.ts` |
| 1.6 ✅ | **Überwachen und Abnahme:** Wächter im Bilddienst (`fs.watch` rekursiv, gesammelt 300 ms/2 s, „rename“ = Pfad samt allem darunter, „change“ = nur die Datei und nur, wenn sich Größe oder Änderungszeit gegenüber dem eigenen Lesen geändert haben – Windows meldet schon das Lesen), Teil-Abgleich nur der gemeldeten Pfade, Verschoben/Umbenannt erkannt (Kennung, Metadaten, Vorschaubild bleiben), Netzlaufwerke (UNC nach `realpath`) alle 5 min und beim Fokus, nicht erreichbare Ordner alle 30 s und beim Fokus, Hinweis „Abgleich alle 5 min“ im Ordnerbaum; Leistung nach der Messung: unveränderte Dateien nur als gesehen markiert, Nachrichten des Bilddienstes einzeln abgearbeitet, Blockaden des main im Log; Abnahme mit 50.000 Bildern (unten); Sandbox-Abnahme mit Testbildern und der installierten App | `ueberwachen` (Gegenprobe am alten Stand 9 von 10 rot), `galerie` (409 jetzt über einen Hardlink außerhalb), alle; `abnahme50k` auf Wunsch; Unit `beobachter.test.ts`, `scan.test.ts`, `repo.test.ts`, `library.test.ts` |

### Phase 2 – Metadaten lesen, Filtern, Suchen

- Vollständiges Lesen per ExifTool, Info-Panel, „alle Felder“.
- Diashow mit Überblenden und Ken-Burns-Effekt (siehe [Betrachter](#betrachter)); nur im
  Renderer, die zwei Bild-Ebenen dafür gibt es seit 1.5+.
- Offline-Ortsnamen (GeoNames, Lizenz CC BY 4.0 – Hinweis in „Über“) und **Sortieren nach Ort
  (A–Z)** mit Gruppen.
- Sortieren nach allen weiteren Feldern; Gruppieren (Tag/Monat/Jahr, Ordner, Kamera, Ort);
  Blocksatz-Ansicht.
- Filterleiste, gespeicherte Ansichten, Volltextsuche.
- **Abnahme:** E2E `sortieren` mit bekannten Testbildern (Reihenfolge exakt erwartet, „Ohne
  Standort“ am Ende in beiden Richtungen).

**Teilschritte** (festgelegt 29.10.2026, je ein Pull Request gegen `main`):

| | Inhalt |
|---|---|
| 2.1 ✅ | **Alle Metadaten lesen und Info-Panel:** Migration 4 (Stichwörter-Tabelle, `gps_alt`, `missing_since`; alle Dateien im Hintergrund nachlesen); Objektiv, Blende, Belichtungszeit, ISO, Brennweite, GPS (Composite vor XMP, 0/0 ohne Höhe = keiner), Bewertung 0–5, Farblabel, Titel/Beschreibung (XMP vor IPTC vor EXIF), Stichwörter aus XMP, IPTC und Windows zusammengeführt – alles mit Grenzen geprüft (`grundfelder.ts`); Info-Panel im Betrachter (`InfoPanel.tsx`, Farblabel auf Deutsch); „alle Felder“ auf Abruf frisch aus der Datei über den Bilddienst (Prüfung wie vor jedem Lesen, ohne Pfade, höchstens 3.000 Felder, `alleFelder.ts`); **Fehlende entfernen** (Menüpunkt mit Rückfrage, automatisch nach 30 Tagen samt Vorschaubildern); Testbibliothek um Objektiv, Belichtung, Beschreibung, Farblabel und IPTC-Stichwörter ergänzt | `sortieren` (alle neuen Felder exakt wie in der Datei, Info-Panel mit „alle Felder“), `galerie` (Fehlende entfernen, Abbrechen behält, Vorschaubilder weg); Gegenprobe am alten Stand rot; Unit `grundfelder.test.ts`, `alleFelder.test.ts`, `repo.test.ts`, `db.test.ts` (Migration 3 → 4), `format.test.ts` |
| 2.2 ✅ | **Orte offline:** Ortsdaten aus GeoNames `cities1000` mit deutschen Namen aus `alternateNamesV2` (`npm run orte:bauen`; GeoNames erzeugt täglich neu, darum liegt das Ergebnis im Repository: `resources/geo/orte.tsv.gz`, 162.014 Orte, 2,7 MB, Prüfsumme in `orte.json`, Lizenzhinweis `LIZENZ.txt`, im Paket unter `resources/geo`); nächster Ort im Bilddienst (`shared/geo.ts`: Raster aus 1°-Zellen, 50 km, eine mindestens zehnmal größere Stadt im Umkreis √Einwohner × 5 m geht vor – sonst hieße der Eiffelturm „Paris 16 Passy“); Ort-Feld der Metadaten (XMP/IPTC City, Country) hat Vorrang; Ländernamen deutsch über ICU; Migration 5 (Ort, Land, Quelle, `kv` mit dem Stand der Ortsdaten – neuer Stand = Orte neu bestimmen, je Richtung ein Index); **Sortieren nach Ort (A–Z)**, gleichnamige Orte nach Land getrennt, ohne Ort immer am Ende (auch absteigend); Ort im Info-Panel. Gruppen-Überschriften folgen mit 2.3; der Lizenzhinweis in „Über“ mit der Über-Seite | `sortieren` (Ort jeder Testdatei exakt, A–Z und absteigend, ohne Standort am Ende), `paket` (Ortsdaten im Paket); Gegenprobe am alten Stand rot; Unit `geo.test.ts`, `orte.test.ts` (echte Daten: Eiffelturm → Paris, Dom → Köln, Brandenburger Tor → Berlin, München, Wien; verfälschte Datei abgelehnt), `repo.test.ts`, `library.test.ts`, `sortFilter.test.ts`, `grundfelder.test.ts` |
| 2.3 | **Weitere Sortierfelder und Gruppen-Überschriften** (Tag/Monat/Jahr, Ordner, Kamera, Ort) in Raster und Liste; Blocksatz-Ansicht |
| 2.4 | **Filterleiste, gespeicherte Ansichten, Volltextsuche** (FTS5) |
| 2.5 | **Diashow mit Überblenden und Ken Burns** (Wunsch 29.10.2026) |

### Phase 3 – Metadaten bearbeiten

- Bearbeiten-Panel einzeln/mehrfach, Felder aus `shared/metaFields.ts`.
- Schreiben mit Konfliktprüfung, Journal/Rückgängig, Sicherung, Nachprüfung, XMP-Sidecars.
- Schnellbewertung im Betrachter.
- **Drehen beim Bearbeiten** (Wunsch 29.10.2026): verlustfrei über die EXIF-Ausrichtung, im
  Betrachter (Tasten/Knopf) und für eine Auswahl – über denselben Schreibweg wie die Metadaten
  (Sicherung, Journal, Nachprüfung: Pixel unverändert); Vorschaubild und Maße danach neu.
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

**Diashow als Video speichern** (Wunsch 29.10.2026, nach Phase 6 – Clips brauchen die Videos):
aus der Auswahl ein Video mit Reihenfolge, Anzeigedauer, Übergängen, Ken Burns und Musik – der
Ablauf des Video-Generators der Mottulbox (`docs/PLAN-VIDEO-GENERATOR.md` dort: in Stücken rechnen,
`xfade`, concat, Ton getrennt), kopiert und angepasst. Bedingungen und offene Punkte:

- Kein Schnittprogramm (Nicht-Ziel bleibt): je Clip höchstens ein Ausschnitt Start/Ende.
- **Labor zuerst:** Das gebündelte ffmpeg ist ein LGPL-Build – ohne `libx264` und ohne den Filter
  `perspective`, mit dem die Mottulbox Ken Burns rechnet (geprüft 29.10.2026 mit n9.0.2). Da sind:
  `zoompan` (ganze Pixel, ruckelt – vorher hochskalieren?), H.264 über `libopenh264`, Media
  Foundation (`h264_mf`) oder die Grafikkarte (`h264_nvenc`/`_qsv`/`_amf`), AV1 (`libsvtav1`),
  VP9, AAC. Ken-Burns-Qualität, Geschwindigkeit und Lizenz im Labor vergleichen (Skill `bild-labor`).
- Leitplanken: liest nur (Originale bleiben), schreibt nur die neue Datei in einen gewählten
  Ordner, ohne Metadaten der Quellen (kein Standort, Schicht E); Zwischenstücke im lokalen
  Datenordner, danach gelöscht; Abbrechen ohne halbe Dateien; ffmpeg nur mit
  `-protocol_whitelist file`.
- Vorschau live mit derselben Ken-Burns-Bahn wie die Diashow aus Phase 2 – eine reine Funktion für
  Vorschau und Datei.

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
| ExifTool-Start/Durchsatz unter Windows langsam (Perl in der exe) | Gemessen (Phase 0): Start 0,2 s, 165 Dateien/s je Prozess, 567/s mit 4 Prozessen – `-stay_open`, Stapel von 50, mehrere Prozesse; kein JS-Leser nötig |
| Dekoder-Absturz an präparierten Dateien | Bilddienst als eigener Prozess, Zeitlimit je Datei, Datei als „defekt“ markieren; Updates für Dekoder |
| `fs.watch` verpasst Änderungen (Netzlaufwerk, Überlauf) | Abgleich beim Start, bei Fokus und periodisch; Überlauf → Ordner neu abgleichen. Gemessen (1.6): Löschen des beobachteten Ordners selbst meldet Windows als Endlos-Sturm absoluter Pfade statt als Fehler (→ „Ordner weg“); Linux meldet es womöglich gar nicht (→ Erreichbarkeit alle 30 s); Änderungen über einen Hardlink außerhalb meldet `fs.watch` nicht (→ `pruefeDatei` vor jedem Lesen, 409) |
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
- **BMP** ab Phase 1: Vorschaubild per ffmpeg, Anzeige in Chromium, Metadaten nur lesen (sharp
  kann BMP nicht, Labor 25.10.2026).

**Entschieden (29. Oktober 2026):**

- **Fehlende Dateien:** Menüpunkt „Fehlende aus der Galerie entfernen“ je Ordner und automatisch
  nach 30 Tagen (Index-Zeile samt Vorschaubildern) – bis dahin erkennt der Abgleich eine
  zurückgekehrte oder verschobene Datei wieder (2.1).
- **Ortsdaten:** GeoNames `cities1000` – Orte ab 1.000 Einwohnern, auch kleine Urlaubsorte (2.2).
- **Drehen** gehört zu Phase 3 (Metadaten bearbeiten): verlustfrei über die EXIF-Ausrichtung.
- **Phase 2 beginnt mit 2.1** (Metadaten), die Diashow-Effekte kommen als 2.5.

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
