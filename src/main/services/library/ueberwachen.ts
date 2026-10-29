// Überwachen der Bibliotheksordner (Phase 1.6, Skill bibliothek-index, „Überwachen“). Lokale Ordner
// beobachtet der Bilddienst (fs.watch) und meldet geänderte Pfade; die Bibliothek gleicht genau
// diese ab (Teil-Abgleich). Netzlaufwerke (UNC, auch verbundene Laufwerke) und Ordner, deren
// Wächter wiederholt ausfiel, gleicht sie periodisch ganz ab. Nicht erreichbare Ordner (Stick
// abgezogen, Netz weg) werden periodisch und beim Fokus des Fensters geprüft – sind sie wieder da,
// folgt ein ganzer Abgleich (und das Überwachen beginnt neu).

import type { FolderStatus, FolderWatch } from '@shared/types'
import type { Meldung } from '../bilddienst/beobachter'
import { bilddienst } from '../bilddienst/client'
import { logLine } from '../log'

/** Was das Überwachen von library.ts braucht (dort liegen Index, Zustand und Warteschlange). */
export interface Umgebung {
  /** Bibliotheksordner mit letztem ganzen Abgleich (ms) */
  ordner(): { id: number; path: string; last_scan: number | null }[]
  status(id: number): FolderStatus
  /** ganzen Abgleich einreihen */
  einlesen(id: number): void
  /** Teil-Abgleich einreihen: Pfade samt allem darunter, Dateien für sich */
  teil(id: number, pfade: string[], dateien: string[]): void
  /** Ordner erreichbar? (mit Zeitlimit, nie synchron) */
  erreichbar(pfad: string): Promise<boolean>
  melden(): void
  beendet(): boolean
}

/** Netzlaufwerke und Ordner ohne Wächter: so oft ganz abgleichen */
export const PERIODISCH_MS = 5 * 60_000
/** So oft prüfen, ob ein nicht erreichbarer Ordner wieder da ist (und Periodisches fällig ist) */
const TAKT_MS = 30_000
/** Beim Fokus: Periodisches abgleichen, wenn der letzte Abgleich mindestens so alt ist */
const FOKUS_MS = 60_000
/** Fällt der Wächter so oft in VERLOREN_MS aus, bleibt der Ordner periodisch */
const VERLOREN_HOECHSTENS = 3
const VERLOREN_MS = 10 * 60_000

let u: Umgebung | null = null
const art = new Map<number, FolderWatch>()
/** Zeitpunkte, an denen der Wächter eines erreichbaren Ordners verloren ging */
const verloren = new Map<number, number[]>()
let takt: NodeJS.Timeout | null = null

export function ueberwachenEinrichten(umgebung: Umgebung): void {
  u = umgebung
  bilddienst.onAenderung = aenderung
  // Bilddienst abgestürzt oder neu gestartet: seine Wächter sind weg – neu anlegen
  bilddienst.onEnde = () => {
    if (u?.beendet()) return
    const live = [...art].filter(([, a]) => a === 'live').map(([id]) => id)
    for (const id of live) art.delete(id)
    setTimeout(() => {
      for (const o of u?.ordner() ?? []) if (live.includes(o.id)) void sicherstellen(o.id, o.path)
    }, 1000).unref()
  }
  takt = setInterval(() => pruefen(PERIODISCH_MS), TAKT_MS)
  takt.unref()
}

export function ueberwachenBeenden(): void {
  if (takt) clearInterval(takt)
  takt = null
  art.clear()
  bilddienst.onAenderung = null
  bilddienst.onEnde = null
}

/** Wie der Ordner aktuell gehalten wird (für den Zustand der Oberfläche) */
export function ueberwachungsArt(id: number): FolderWatch | null {
  return art.get(id) ?? null
}

/**
 * Vor einem ganzen Abgleich (der Ordner ist erreichbar): das Überwachen beginnen, falls es nicht
 * schon läuft – vorher, damit Änderungen während des Einlesens nicht verloren gehen.
 */
export async function sicherstellen(id: number, pfad: string): Promise<void> {
  if (art.get(id) === 'live' || u?.beendet()) return
  const ausfaelle = (verloren.get(id) ?? []).filter((t) => Date.now() - t < VERLOREN_MS)
  if (ausfaelle.length >= VERLOREN_HOECHSTENS) {
    art.set(id, 'periodisch')
    return
  }
  try {
    const { netz } = await bilddienst.beobachten(id, pfad)
    // inzwischen entfernt? Dann gleich wieder aufhören
    if (!u?.ordner().some((o) => o.id === id)) {
      bilddienst.nichtBeobachten(id)
      return
    }
    art.set(id, netz ? 'periodisch' : 'live')
    if (netz) logLine(`[ueberwachen] Ordner ${id} liegt auf einem Netzlaufwerk – periodisch`)
  } catch (err) {
    art.set(id, 'periodisch')
    logLine(
      `[ueberwachen] Ordner ${id}: Überwachen nicht möglich (${(err as NodeJS.ErrnoException).code ?? 'UNBEKANNT'}) – periodisch`
    )
  }
  u?.melden()
}

/** Ordner entfernt: nicht mehr überwachen. */
export function nichtMehrUeberwachen(id: number): void {
  art.delete(id)
  verloren.delete(id)
  bilddienst.nichtBeobachten(id)
}

function aenderung(id: number, m: Meldung): void {
  if (!u || u.beendet() || !art.has(id)) return
  if (m.art === 'pfade') u.teil(id, m.pfade, m.dateien)
  else if (m.art === 'alles') {
    logLine(`[ueberwachen] Ordner ${id}: viele Änderungen – ganzer Abgleich`)
    u.einlesen(id)
  } else {
    // Wächter weg (Ordner gelöscht oder umbenannt, Laufwerk ab): ganz abgleichen – das Einlesen
    // stellt fest, ob der Ordner noch erreichbar ist, und beginnt dann neu zu überwachen
    logLine(`[ueberwachen] Ordner ${id}: Wächter beendet (${m.code})`)
    art.set(id, 'periodisch')
    verloren.set(id, [...(verloren.get(id) ?? []), Date.now()].slice(-VERLOREN_HOECHSTENS))
    u.einlesen(id)
    u.melden()
  }
}

/**
 * Nicht erreichbare Ordner wieder versuchen; periodische ganz abgleichen, wenn ihr letzter
 * Abgleich älter als `alter` ist. Bei überwachten nur nachsehen, ob es sie noch gibt: Nicht jedes
 * Verschwinden meldet der Wächter (Linux beim Umbenennen des Ordners selbst, abgezogener Stick).
 */
function pruefen(alter: number): void {
  if (!u || u.beendet()) return
  const umg = u
  const jetzt = Date.now()
  for (const o of umg.ordner()) {
    const st = umg.status(o.id)
    if (st === 'liest') continue
    const a = art.get(o.id)
    if (st === 'nicht-erreichbar') umg.einlesen(o.id)
    // noch unbekannt (beim Start, bevor das Einlesen das Überwachen einrichtet): nichts – sonst
    // reihte der erste Fokus einen zweiten ganzen Abgleich ein (gesehen mit 50.000 Bildern)
    else if (a === 'periodisch') {
      if (jetzt - (o.last_scan ?? 0) >= alter) umg.einlesen(o.id)
    } else if (a === 'live') {
      void umg.erreichbar(o.path).then((ok) => {
        if (!ok && art.get(o.id) === 'live' && !umg.beendet()) {
          bilddienst.nichtBeobachten(o.id)
          art.set(o.id, 'periodisch')
          umg.einlesen(o.id)
        }
      })
    }
  }
}

/** Ein Fenster der App bekommt den Fokus: wer zurückkommt, sieht den aktuellen Stand. */
export function beiFokus(): void {
  pruefen(FOKUS_MS)
}
