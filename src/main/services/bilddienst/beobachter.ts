// Überwachen eines Bibliotheksordners – läuft im Bilddienst wie der Scan: fs.watch öffnet den
// Ordner synchron, ein hängendes Laufwerk hielte im main alle Fenster an. Die Ereignisse werden
// gesammelt (Ruhe RUHE_MS, spätestens nach HOECHSTENS_MS) und als relative Pfade gemeldet; der
// main gleicht genau diese ab (Teil-Abgleich). Ein Ereignis ohne Namen oder zu viele Pfade melden
// „alles“ – dann gleicht der main den ganzen Ordner ab (Skill bibliothek-index, „Überwachen“).
//
// Gemessen (Windows 11, Node 24, 29.10.2026): Pfade kommen relativ mit „\“, auch mit Umlauten und
// Emoji; beim Umbenennen eines Ordners kommen alter und neuer Name. Wird der beobachtete Ordner
// selbst gelöscht, meldet fs.watch keinen Fehler, sondern ohne Ende „rename“ mit dem absoluten
// Pfad (\\?\C:\…) – das gilt hier als „Ordner weg“, der Wächter schließt sofort.
//
// Ebenso gemessen: Schon das LESEN einer Datei meldet Windows als „change“ (Datei und ihr Ordner),
// sobald ihre letzte Zugriffszeit älter als eine Stunde ist (Standard „vom System verwaltet“).
// Darum: „rename“ (dazu, weg, umbenannt) gleicht den Pfad samt allem darunter ab; „change“ nur die
// Datei selbst – ein Ordner mit „change“ fällt weg (seine Einträge melden sich selbst), ebenso
// eine Datei, die der Bilddienst gerade gelesen hat und deren Größe und Änderungszeit gleich
// geblieben sind (`gelesen`). Sonst lösten ExifTool und die Vorschaubilder beim ersten Einlesen
// je einen ganzen Abgleich aus (gesehen mit 50.000 Bildern).

import { watch, type FSWatcher } from 'node:fs'
import { lstat, stat } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import { ordnerAusgeschlossen } from '@shared/scanRegeln'

export type Meldung =
  /** pfade: samt allem darunter abgleichen; dateien: nur diese Datei (geändert) */
  | { art: 'pfade'; pfade: string[]; dateien: string[] }
  | { art: 'alles' }
  | { art: 'weg'; code: string }

const RUHE_MS = 300
const HOECHSTENS_MS = 2000
/** So lange merkt sich der Wächter, was der Bilddienst selbst gelesen hat */
const GELESEN_MS = 10 * 60_000
/** Mehr Pfade auf einmal: den ganzen Ordner abgleichen statt Pfad für Pfad */
export const GRENZE = 500
/** Mehr geänderte Einträge in einem Ordner: den Ordner abgleichen statt jedes einzeln */
export const GESCHWISTER = 50

/** Liegt der Pfad auf einem Netzlaufwerk? `echt` = Ergebnis von realpath.native (Windows: ein
 *  verbundenes Laufwerk wird dort zum UNC-Pfad \\server\freigabe). */
export function istNetzpfad(echt: string, windows = process.platform === 'win32'): boolean {
  if (!windows) return false
  const p = echt.replace(/\//g, '\\')
  if (/^\\\\\?\\UNC\\/i.test(p)) return true
  return p.startsWith('\\\\') && !p.startsWith('\\\\?\\') && !p.startsWith('\\\\.\\')
}

/** Name aus fs.watch → relativer Pfad mit „/“; null = absolut (der Ordner selbst ist weg). */
export function relativerPfad(name: string): string | null {
  const p = name.replace(/\\/g, '/')
  if (p.startsWith('/') || /^[a-z]:/i.test(p)) return null
  return p.replace(/\/+$/, '')
}

/** Ereignisse in ausgeschlossenen Ordnern (Papierkorb, versteckt …) und an versteckten Dateien
 *  (auch Zwischennamen des Stapels) brauchen keinen Abgleich – der Scan nähme sie ohnehin nicht. */
function unwichtig(p: string): boolean {
  const teile = p.split('/')
  const letzter = teile[teile.length - 1]
  return !letzter || letzter.startsWith('.') || teile.slice(0, -1).some(ordnerAusgeschlossen)
}

const elternteil = (p: string): string => {
  const i = p.lastIndexOf('/')
  return i < 0 ? '' : p.slice(0, i)
}

/**
 * Gemeldete Pfade zusammenfassen: Unwichtiges weg, was unter einem anderen gemeldeten Pfad liegt
 * weg (der Abgleich eines Ordners umfasst alles darunter), viele Einträge eines Ordners zum Ordner.
 * null = den ganzen Ordner abgleichen (zu viele, oder es träfe die Wurzel).
 */
export function pfadeZusammenfassen(
  pfade: Iterable<string>,
  grenze = GRENZE,
  geschwister = GESCHWISTER
): string[] | null {
  let menge = new Set([...pfade].filter((p) => !unwichtig(p)))
  for (;;) {
    // was unter einem anderen liegt, deckt dessen Abgleich ab
    const sortiert = [...menge].sort((a, b) => a.length - b.length)
    const behalten: string[] = []
    for (const p of sortiert) {
      if (!behalten.some((a) => p === a || p.startsWith(a + '/'))) behalten.push(p)
    }
    // viele in einem Ordner: den Ordner abgleichen
    const je = new Map<string, number>()
    for (const p of behalten) je.set(elternteil(p), (je.get(elternteil(p)) ?? 0) + 1)
    const voll = [...je].filter(([, n]) => n > geschwister).map(([e]) => e)
    if (voll.includes('')) return null
    if (!voll.length) {
      return behalten.length > grenze ? null : behalten.sort()
    }
    menge = new Set([...behalten.filter((p) => !voll.includes(elternteil(p))), ...voll])
  }
}

const WINDOWS = process.platform === 'win32'
/** Vergleichsschlüssel eines relativen Pfads (Windows: ohne Groß/Klein) */
const schluessel = (rel: string): string => (WINDOWS ? rel.toLowerCase() : rel)

export class Beobachter {
  private waechter: FSWatcher | null = null
  /** „rename“: samt allem darunter */
  private pfade = new Set<string>()
  /** „change“: nur die Datei */
  private dateien = new Set<string>()
  private alles = false
  private ruhe: NodeJS.Timeout | null = null
  private spaetestens: NodeJS.Timeout | null = null
  /** vom Bilddienst gelesen: Größe, Änderungszeit, wann */
  private readonly gelesen = new Map<string, { size: number; mtime: number; t: number }>()

  constructor(
    private readonly wurzel: string,
    private readonly melden: (m: Meldung) => void,
    private readonly zeiten = { ruheMs: RUHE_MS, hoechstensMs: HOECHSTENS_MS }
  ) {}

  /** Beginnt zu beobachten; wirft, wenn fs.watch den Ordner nicht öffnen kann. */
  starten(): void {
    const w = watch(this.wurzel, { recursive: true, encoding: 'utf8' }, (typ, name) =>
      this.ereignis(typ, name)
    )
    w.on('error', (err: NodeJS.ErrnoException) => this.weg(err.code ?? 'UNBEKANNT'))
    this.waechter = w
  }

  schliessen(): void {
    this.waechter?.close()
    this.waechter = null
    if (this.ruhe) clearTimeout(this.ruhe)
    if (this.spaetestens) clearTimeout(this.spaetestens)
    this.ruhe = this.spaetestens = null
    this.pfade.clear()
    this.dateien.clear()
    this.alles = false
  }

  /**
   * Der Bilddienst liest gleich diese Datei (ExifTool, Vorschaubild, Umrechnung) – ihr „change“
   * zählt danach nur, wenn sich Größe oder Änderungszeit geändert haben. Pfade außerhalb: nichts.
   */
  gelesenMerken(pfad: string, size: number, mtime: number): void {
    const rel = relative(this.wurzel, pfad)
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) return
    this.gelesen.set(schluessel(rel.replace(/\\/g, '/')), { size, mtime, t: Date.now() })
  }

  private weg(code: string): void {
    if (!this.waechter) return
    this.schliessen()
    this.melden({ art: 'weg', code })
  }

  private ereignis(typ: string, name: string | null): void {
    if (!this.waechter) return
    if (name === null) {
      this.alles = true
    } else {
      const rel = relativerPfad(name)
      if (rel === null) return this.weg('WURZEL')
      if (!this.alles && rel) (typ === 'rename' ? this.pfade : this.dateien).add(rel)
      // sehr viele (große Kopie): nicht weiter sammeln, gleich den ganzen Ordner. „change“ zählt
      // erst nach dem Filtern (abgeben) – meist ist es nur Lesen (ExifTool, Vorschaubilder)
      if (this.pfade.size > GRENZE * 4 || this.dateien.size > GRENZE * 100) {
        this.alles = true
        this.pfade.clear()
        this.dateien.clear()
      }
    }
    if (this.ruhe) clearTimeout(this.ruhe)
    this.ruhe = setTimeout(() => void this.abgeben(), this.zeiten.ruheMs)
    this.spaetestens ??= setTimeout(() => void this.abgeben(), this.zeiten.hoechstensMs)
  }

  /** „change“-Pfade, die wirklich zählen: Dateien, nicht selbst gelesen oder seither anders. */
  private async geaenderteDateien(kandidaten: readonly string[]): Promise<string[]> {
    const jetzt = Date.now()
    for (const [k, e] of this.gelesen) if (jetzt - e.t > GELESEN_MS) this.gelesen.delete(k)
    const out: string[] = []
    for (let i = 0; i < kandidaten.length; i += 64) {
      const teil = kandidaten.slice(i, i + 64)
      const st = await Promise.all(
        teil.map((rel) => lstat(join(this.wurzel, rel)).catch(() => null))
      )
      teil.forEach((rel, k) => {
        const s = st[k]
        if (s?.isDirectory()) return
        const e = this.gelesen.get(schluessel(rel))
        if (s && e && s.size === e.size && Math.trunc(s.mtimeMs) === e.mtime) return
        out.push(rel)
      })
    }
    return out
  }

  private async abgeben(): Promise<void> {
    if (this.ruhe) clearTimeout(this.ruhe)
    if (this.spaetestens) clearTimeout(this.spaetestens)
    this.ruhe = this.spaetestens = null
    const alles = this.alles
    const roh = [...this.pfade]
    const geaendert = [...this.dateien]
    this.pfade.clear()
    this.dateien.clear()
    this.alles = false
    let m: Meldung | null = null
    if (alles) m = { art: 'alles' }
    else {
      const pfade = pfadeZusammenfassen(roh)
      if (pfade === null) m = { art: 'alles' }
      else {
        // was unter einem „rename“-Pfad liegt, gleicht dessen Abgleich ohnehin ab
        const kandidaten = geaendert.filter(
          (d) => !unwichtig(d) && !pfade.some((p) => d === p || d.startsWith(p + '/'))
        )
        const dateien = (await this.geaenderteDateien(kandidaten)).sort()
        if (dateien.length > GRENZE * 4) m = { art: 'alles' }
        else if (pfade.length || dateien.length) m = { art: 'pfade', pfade, dateien }
      }
    }
    if (!m || !this.waechter) return
    // Gibt es den Ordner noch? (Linux meldet sein Löschen nicht als absoluten Pfad)
    const meldung = m
    await stat(this.wurzel).then(
      (st) => {
        if (!this.waechter) return
        if (st.isDirectory()) this.melden(meldung)
        else this.weg('ENOTDIR')
      },
      (err: NodeJS.ErrnoException) => this.weg(err.code ?? 'UNBEKANNT')
    )
  }
}
