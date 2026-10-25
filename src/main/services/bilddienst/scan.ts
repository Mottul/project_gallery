// Scan eines Bibliotheksordners – läuft im Bilddienst (eigener Prozess), nie im main: Ein
// hängendes Netzlaufwerk hält so nur den Dienst an. Reines Node, getestet in scan.test.ts.
//
// Regeln (Skill bibliothek-index, „Scan“): rekursiv; Symlinks und Junctions werden NICHT verfolgt
// (sie könnten aus dem Ordner herausführen – auch im Kreis); Ausschlüsse aus scanRegeln.ts; was
// sich nicht lesen lässt, wird gemeldet statt still übergangen, damit der Abgleich es nicht als
// „fehlt“ wertet. Gelesen wird nur das Verzeichnis und die Größe/Zeiten – kein Dateiinhalt.

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

/**
 * Liest `wurzel` rekursiv ein und meldet gefundene Bilder in Stapeln. Wirft, wenn die Wurzel
 * selbst nicht lesbar ist (der Aufrufer wertet das als „nicht erreichbar“). `abgebrochen` wird
 * zwischen den Einträgen abgefragt.
 */
export async function scanne(
  wurzel: string,
  onStapel: (dateien: GefundeneDatei[]) => void,
  {
    stapelGroesse = 250,
    abgebrochen = () => false
  }: { stapelGroesse?: number; abgebrochen?: () => boolean } = {}
): Promise<ScanErgebnis> {
  let stapel: GefundeneDatei[] = []
  let gefunden = 0
  const unlesbar: string[] = []
  const offen: string[] = [''] // relative Ordner, „“ = Wurzel

  const abgeben = (): void => {
    if (stapel.length) onStapel(stapel)
    stapel = []
  }

  while (offen.length) {
    if (abgebrochen()) throw Object.assign(new Error('abgebrochen'), { code: 'ABGEBROCHEN' })
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
        if (abgebrochen()) throw Object.assign(new Error('abgebrochen'), { code: 'ABGEBROCHEN' })
        const kind = rel ? `${rel}/${e.name}` : e.name
        // Symlinks/Junctions nie verfolgen (Windows meldet Junctions als symbolische Links)
        if (e.isSymbolicLink()) continue
        if (e.isDirectory()) {
          if (!ordnerAusgeschlossen(e.name)) offen.push(kind)
          continue
        }
        if (!e.isFile() || !dateiAufnehmen(e.name)) continue
        try {
          const st = await lstat(join(wurzel, kind))
          stapel.push({
            rel: kind,
            name: e.name,
            size: st.size,
            mtime: Math.trunc(st.mtimeMs),
            btime: st.birthtimeMs > 0 ? Math.trunc(st.birthtimeMs) : null
          })
          gefunden++
          if (stapel.length >= stapelGroesse) abgeben()
        } catch (err) {
          // gesperrt oder ohne Rechte: nicht als „fehlt“ werten lassen
          if (!WEG.has(code(err))) unlesbar.push(kind)
        }
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
