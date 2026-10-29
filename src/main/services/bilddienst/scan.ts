// Scan eines Bibliotheksordners – läuft im Bilddienst (eigener Prozess), nie im main: Ein
// hängendes Netzlaufwerk hält so nur den Dienst an. Reines Node, getestet in scan.test.ts.
//
// Regeln (Skill bibliothek-index, „Scan“): rekursiv; Symlinks und Junctions werden NICHT verfolgt
// (sie könnten aus dem Ordner herausführen – auch im Kreis); Ausschlüsse aus scanRegeln.ts; was
// sich nicht lesen lässt, wird gemeldet statt still übergangen, damit der Abgleich es nicht als
// „fehlt“ wertet. Gelesen wird nur das Verzeichnis und die Größe/Zeiten – kein Dateiinhalt.
// Nach dem Überwachen genügt ein Teil-Scan der gemeldeten Pfade (scanneTeile).

import { opendir, lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { dateiAufnehmen, ordnerAusgeschlossen } from '@shared/scanRegeln'
import type { GefundeneDatei } from '../library/repo'

export interface ScanErgebnis {
  gefunden: number
  /** relative Pfade (Ordner oder Dateien), die nicht lesbar waren – „/“ als Trenner */
  unlesbar: string[]
}

/** Fehlercode eines fs-Fehlers. */
function code(err: unknown): string {
  return (err as NodeJS.ErrnoException)?.code ?? 'UNBEKANNT'
}

/** „Weg“ heißt nur ENOENT/ENOTDIR – alles andere ist vorübergehend oder Rechte (Review-Checkliste). */
const WEG = new Set(['ENOENT', 'ENOTDIR'])

interface Optionen {
  stapelGroesse?: number
  abgebrochen?: () => boolean
}

const abbruch = (): Error => Object.assign(new Error('abgebrochen'), { code: 'ABGEBROCHEN' })

/**
 * Liest `wurzel` rekursiv ein und meldet gefundene Bilder in Stapeln. Wirft, wenn die Wurzel
 * selbst nicht lesbar ist (der Aufrufer wertet das als „nicht erreichbar“). `abgebrochen` wird
 * zwischen den Einträgen abgefragt.
 */
export function scanne(
  wurzel: string,
  onStapel: (dateien: GefundeneDatei[]) => void,
  opts: Optionen = {}
): Promise<ScanErgebnis> {
  return durchlaufen(wurzel, [''], [], onStapel, opts)
}

/**
 * Teil-Scan nach dem Überwachen (beobachter.ts): nur die genannten relativen Pfade – ein Ordner
 * samt allem darunter, eine Datei für sich; `nurDateien` (als geändert gemeldet) nur, wenn es
 * Dateien sind. Was es nicht (mehr) gibt, liefert nichts; der Abgleich
 * im main wertet es dann als fehlend. Wie beim ganzen Scan wird keiner Verknüpfung gefolgt – auch
 * nicht auf dem Weg dorthin: Liegt eine Junction zwischen Wurzel und Pfad, gilt der Pfad als nicht
 * da (der ganze Scan nähme ihn auch nicht). Wirft, wenn die Wurzel nicht lesbar ist.
 */
export async function scanneTeile(
  wurzel: string,
  pfade: readonly string[],
  nurDateien: readonly string[],
  onStapel: (dateien: GefundeneDatei[]) => void,
  opts: Optionen = {}
): Promise<ScanErgebnis> {
  const wst = await lstat(wurzel)
  if (!wst.isDirectory()) throw Object.assign(new Error('kein Ordner'), { code: 'ENOTDIR' })
  const ordner: string[] = []
  const dateien: string[] = []
  const unlesbar: string[] = []
  const nurDatei = new Set(nurDateien)
  for (const rel of [...pfade, ...nurDateien]) {
    const teile = rel.split('/')
    if (!rel || teile.some((t) => !t || t === '.' || t === '..')) continue
    // Weg dorthin: lauter echte, nicht ausgeschlossene Ordner
    let art: 'ordner' | 'datei' | 'nichts' = 'nichts'
    try {
      for (let i = 0; i < teile.length; i++) {
        const st = await lstat(join(wurzel, ...teile.slice(0, i + 1)))
        const letzter = i === teile.length - 1
        if (st.isSymbolicLink()) break
        if (st.isDirectory()) {
          if (ordnerAusgeschlossen(teile[i])) break
          if (letzter) art = 'ordner'
          continue
        }
        if (letzter && st.isFile() && dateiAufnehmen(teile[i])) art = 'datei'
        break
      }
    } catch (err) {
      if (!WEG.has(code(err))) unlesbar.push(rel)
      continue
    }
    // ein Ordner, der nur als „geändert“ gemeldet wurde, braucht keinen Abgleich
    if (art === 'ordner' && !nurDatei.has(rel)) ordner.push(rel)
    else if (art === 'datei') dateien.push(rel)
  }
  return durchlaufen(wurzel, ordner, dateien, onStapel, opts, unlesbar)
}

async function durchlaufen(
  wurzel: string,
  start: readonly string[],
  einzeln: readonly string[],
  onStapel: (dateien: GefundeneDatei[]) => void,
  { stapelGroesse = 250, abgebrochen = () => false }: Optionen,
  unlesbar: string[] = []
): Promise<ScanErgebnis> {
  let stapel: GefundeneDatei[] = []
  let gefunden = 0
  const offen: string[] = [...start] // relative Ordner, „“ = Wurzel

  const abgeben = (): void => {
    if (stapel.length) onStapel(stapel)
    stapel = []
  }
  /** Größe und Zeiten einer Datei in den Stapel; nicht lesbar = in `unlesbar` */
  const aufnehmen = async (rel: string, name: string): Promise<void> => {
    try {
      const st = await lstat(join(wurzel, rel))
      stapel.push({
        rel,
        name,
        size: st.size,
        mtime: Math.trunc(st.mtimeMs),
        btime: st.birthtimeMs > 0 ? Math.trunc(st.birthtimeMs) : null
      })
      gefunden++
      if (stapel.length >= stapelGroesse) abgeben()
    } catch (err) {
      // gesperrt oder ohne Rechte: nicht als „fehlt“ werten lassen
      if (!WEG.has(code(err))) unlesbar.push(rel)
    }
  }

  for (const rel of einzeln) {
    if (abgebrochen()) throw abbruch()
    await aufnehmen(rel, rel.slice(rel.lastIndexOf('/') + 1))
  }
  while (offen.length) {
    if (abgebrochen()) throw abbruch()
    const rel = offen.pop() as string
    let dir
    try {
      dir = await opendir(rel ? join(wurzel, rel) : wurzel)
    } catch (err) {
      if (!rel) throw err // Wurzel nicht lesbar
      if (!WEG.has(code(err))) unlesbar.push(rel) // verschwundene Unterordner sind einfach weg
      continue
    }
    try {
      for await (const e of dir) {
        if (abgebrochen()) throw abbruch()
        const kind = rel ? `${rel}/${e.name}` : e.name
        // Symlinks/Junctions nie verfolgen (Windows meldet Junctions als symbolische Links)
        if (e.isSymbolicLink()) continue
        if (e.isDirectory()) {
          if (!ordnerAusgeschlossen(e.name)) offen.push(kind)
          continue
        }
        if (!e.isFile() || !dateiAufnehmen(e.name)) continue
        await aufnehmen(kind, e.name)
      }
    } catch (err) {
      if (code(err) === 'ABGEBROCHEN') throw err
      // Lesen des Ordners mittendrin gescheitert: was bisher kam, gilt; der Rest ist unlesbar
      if (!rel) throw err
      unlesbar.push(rel)
    }
  }
  abgeben()
  return { gefunden, unlesbar }
}
