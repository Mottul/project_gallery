// Nachrichten zwischen main (client.ts) und Bilddienst (einstieg.ts). Nur kleine Daten: Pfade
// hinein, Kennwerte heraus – nie ganze Bilder (Skill bibliothek-index, „Bilddienst“).

import { cpus } from 'node:os'
import type { TagWert } from '@shared/metaFields'
import type { MetaFeld } from '@shared/types'
import type { GefundeneDatei } from '../library/repo'
import type { Meldung } from './beobachter'
import type { OrtsAntwort } from './orte'

/** Datei, deren Grundfelder gelesen werden sollen (Kennung aus dem Index, absoluter Pfad;
 *  Größe und Änderungszeit laut Index – der Wächter übergeht damit das eigene Lesen) */
export interface MetaDatei {
  id: number
  pfad: string
  size: number
  mtime: number
}

/** Rohe ExifTool-Tags je Datei; null = nicht gelesen */
export interface MetaErgebnis {
  id: number
  roh: Record<string, unknown> | null
}

/** Datei, deren Vorschaubilder entstehen sollen (alles, was zum Prüfen nötig ist) */
export interface VorschauDatei {
  id: number
  pfad: string
  /** Bibliotheksordner: der echte Pfad der Datei muss darin liegen */
  ordner: string
  size: number
  mtime: number
  /** Format nach Inhalt (ExifTool) oder Endung – „bmp“ geht über ffmpeg */
  format: string
  /** platte = verschlüsselt in den Cache; speicher = zurück an main (Ordner „privat“) */
  ziel: 'platte' | 'speicher'
}

export type VorschauErgebnis =
  | { id: number; ok: true; farbe: string; gross?: Uint8Array; klein?: Uint8Array }
  | { id: number; ok: false; code: string }

/** Datei für die Anzeige-Umrechnung (Betrachter, TIFF) */
export interface AnzeigeDatei {
  pfad: string
  ordner: string
  size: number
  mtime: number
}

/** Umgerechnetes Bild (JPEG/WebP, höchstens 3840 px) oder der Grund, warum nicht */
export interface AnzeigeErgebnis {
  daten: Uint8Array | null
  code: string | null
}

/** Metadaten in eine Datei schreiben (Phase 3); Ablauf in schreiben.ts */
export interface SchreibAuftrag {
  datei: AnzeigeDatei
  tags: TagWert[]
  /** Wohin das Original vor dem Ersetzen kopiert wird; null = keine Sicherung */
  sicherung: string | null
  /** Nachbardatei für das Schreiben (im selben Ordner) */
  zwischen: string
}

/** ok: neue Größe und Zeit samt frisch gelesenen Grundfeldern; sonst der Grund als Code */
export type SchreibErgebnis =
  | { ok: true; size: number; mtime: number; roh: Record<string, unknown> | null }
  | { ok: false; code: string }

/** main → Bilddienst */
export type AnDienst =
  | {
      typ: 'einrichten'
      /** Schlüssel des Vorschau-Caches – nur über die Nachricht, nie über Argumente (sichtbar) */
      schluessel: Uint8Array
      cacheOrdner: string
      ffmpeg: string | null
      /** Ordner der Ortsdaten (resources/geo); null = keine */
      geo: string | null
    }
  | { typ: 'scan'; auftrag: number; wurzel: string }
  /** Teil-Scan nach dem Überwachen: relative Pfade („/“) samt allem darunter, Dateien für sich */
  | { typ: 'teilscan'; auftrag: number; wurzel: string; pfade: string[]; dateien: string[] }
  /** Ordner überwachen (fs.watch) – außer auf einem Netzlaufwerk; Antwort „beobachtet“ */
  | { typ: 'beobachten'; auftrag: number; ordner: number; wurzel: string }
  | { typ: 'nicht-beobachten'; ordner: number }
  | { typ: 'meta'; auftrag: number; dateien: MetaDatei[] }
  | { typ: 'vorschau'; auftrag: number; dateien: VorschauDatei[] }
  | { typ: 'anzeige'; auftrag: number; datei: AnzeigeDatei }
  /** Nächster Ort zu Koordinaten (2.2) */
  | { typ: 'orte'; auftrag: number; punkte: { id: number; lat: number; lon: number }[] }
  /** „alle Felder“ einer Datei für das Info-Panel (2.1), frisch gelesen */
  | { typ: 'alle-felder'; auftrag: number; datei: AnzeigeDatei }
  /** Werte bestimmter Tags, vor dem Schreiben fürs Journal */
  | { typ: 'tags-lesen'; auftrag: number; datei: AnzeigeDatei; tags: TagWert[] }
  | { typ: 'schreiben'; auftrag: number; schreiben: SchreibAuftrag }
  /** Nachbardateien, die ein Absturz liegen ließ (nur Namen der Form `.*.galerie-tmp-*`) */
  | { typ: 'zwischen-weg'; pfade: string[] }
  | { typ: 'abbrechen'; auftrag: number }
  | { typ: 'beenden' }

/** Bilddienst → main */
export type VomDienst =
  | { typ: 'stapel'; auftrag: number; dateien: GefundeneDatei[] }
  | { typ: 'fertig'; auftrag: number; gefunden: number; unlesbar: string[] }
  | { typ: 'meta-ergebnis'; auftrag: number; ergebnisse: MetaErgebnis[] }
  | { typ: 'vorschau-ergebnis'; auftrag: number; ergebnisse: VorschauErgebnis[] }
  | { typ: 'anzeige-ergebnis'; auftrag: number; ergebnis: AnzeigeErgebnis }
  | { typ: 'orte-ergebnis'; auftrag: number; orte: OrtsAntwort[] }
  /** null = nicht lesbar (geändert, fehlt, ExifTool fehlt) */
  | { typ: 'alle-felder-ergebnis'; auftrag: number; felder: MetaFeld[] | null }
  | {
      typ: 'tags-ergebnis'
      auftrag: number
      werte: Record<string, unknown> | null
      code: string | null
    }
  | { typ: 'schreib-ergebnis'; auftrag: number; ergebnis: SchreibErgebnis }
  /** netz = Netzlaufwerk: nicht überwacht, der main gleicht periodisch ab */
  | { typ: 'beobachtet'; auftrag: number; netz: boolean }
  /** ohne Auftrag: Änderungen in einem überwachten Ordner */
  | { typ: 'aenderung'; ordner: number; meldung: Meldung }
  | { typ: 'fehler'; auftrag: number; code: string; meldung: string }
  | { typ: 'log'; text: string }

/** Größe eines Stapels (Labor: 250 Zeilen blockieren main ~40 ms, Skill bibliothek-index). */
export const STAPEL = 250

/** Start-Argument des Bilddienstes: Pfad zum gebündelten ExifTool (leer = keins) */
export const ARG_EXIFTOOL = '--exiftool='

/**
 * Vorschaubilder gleichzeitig (Labor: je ein libvips-Thread, halbe Thread-Zahl, mindestens 2 –
 * 6 parallel: 45 Bilder/s). Zugleich die Stapelgröße eines Auftrags.
 */
export function vorschauParallel(): number {
  return Math.max(2, Math.floor(cpus().length / 2))
}
