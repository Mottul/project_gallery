// Bilddienst aus Sicht des main: startet den Prozess bei Bedarf (utilityProcess), schickt
// Aufträge mit Kennung und reicht die Antworten weiter. Stirbt der Dienst, scheitern seine
// laufenden Aufträge mit einer klaren Meldung, und der nächste Auftrag startet ihn neu. Kommt zu
// einem Auftrag zu lange nichts (hängendes Netzlaufwerk), wird der Dienst beendet – ein Scan, der
// in einem Systemaufruf feststeckt, lässt sich nicht anders abbrechen.

import { utilityProcess, type UtilityProcess } from 'electron'
import { join } from 'node:path'
import type { GefundeneDatei } from '../library/repo'
import { logLine } from '../log'
import type { AnDienst, VomDienst } from './protokoll'

/** So lange darf ein Auftrag ohne jede Nachricht bleiben (ein Stapel kommt sonst alle paar ms). */
const STILLE_MS = 60_000

export interface ScanAuftrag {
  /** Ende des Scans: gefunden und nicht lesbare Pfade; scheitert mit `code` am Fehler */
  fertig: Promise<{ gefunden: number; unlesbar: string[] }>
  abbrechen(): void
}

interface Laufend {
  onStapel: (dateien: GefundeneDatei[]) => void
  resolve: (r: { gefunden: number; unlesbar: string[] }) => void
  reject: (err: Error) => void
  waechter: NodeJS.Timeout
}

function fehler(code: string, meldung: string): Error {
  return Object.assign(new Error(meldung), { code })
}

class Bilddienst {
  private kind: UtilityProcess | null = null
  private naechster = 1
  private readonly laufend = new Map<number, Laufend>()

  private prozess(): UtilityProcess {
    if (this.kind) return this.kind
    const kind = utilityProcess.fork(join(__dirname, 'bilddienst.js'), [], {
      serviceName: 'Galeria Bilddienst',
      stdio: 'pipe'
    })
    kind.stdout?.on('data', (d) => logLine('[bilddienst]', String(d).trimEnd()))
    kind.stderr?.on('data', (d) => logLine('[bilddienst!]', String(d).trimEnd()))
    kind.on('message', (n: VomDienst) => this.nachricht(n))
    kind.on('exit', (code) => {
      if (this.kind !== kind) return
      this.kind = null
      if (this.laufend.size) logLine('[bilddienst] beendet, Code', code)
      this.alleAbbrechen(fehler('DIENST_BEENDET', `Bilddienst beendet (Code ${code})`))
    })
    this.kind = kind
    return kind
  }

  private senden(n: AnDienst): void {
    this.prozess().postMessage(n)
  }

  private wache(auftrag: number): NodeJS.Timeout {
    return setTimeout(() => {
      logLine('[bilddienst] Auftrag', auftrag, `ohne Antwort seit ${STILLE_MS / 1000} s – Neustart`)
      const l = this.laufend.get(auftrag)
      this.laufend.delete(auftrag)
      l?.reject(fehler('ZEITLIMIT', 'Der Ordner antwortet nicht (Zeitlimit)'))
      this.kind?.kill()
    }, STILLE_MS)
  }

  private nachricht(n: VomDienst): void {
    if (n.typ === 'log') {
      logLine('[bilddienst]', n.text)
      return
    }
    const l = this.laufend.get(n.auftrag)
    if (!l) return // abgebrochen oder schon beendet
    clearTimeout(l.waechter)
    if (n.typ === 'stapel') {
      l.waechter = this.wache(n.auftrag)
      l.onStapel(n.dateien)
      return
    }
    this.laufend.delete(n.auftrag)
    if (n.typ === 'fertig') l.resolve({ gefunden: n.gefunden, unlesbar: n.unlesbar })
    else l.reject(fehler(n.code, n.meldung))
  }

  private alleAbbrechen(err: Error): void {
    for (const l of this.laufend.values()) {
      clearTimeout(l.waechter)
      l.reject(err)
    }
    this.laufend.clear()
  }

  /** Ordner einlesen; `onStapel` bekommt die gefundenen Dateien in Stapeln (in Reihenfolge). */
  scan(wurzel: string, onStapel: (dateien: GefundeneDatei[]) => void): ScanAuftrag {
    const auftrag = this.naechster++
    const fertig = new Promise<{ gefunden: number; unlesbar: string[] }>((resolve, reject) => {
      this.laufend.set(auftrag, { onStapel, resolve, reject, waechter: this.wache(auftrag) })
    })
    this.senden({ typ: 'scan', auftrag, wurzel })
    return {
      fertig,
      abbrechen: () => {
        const l = this.laufend.get(auftrag)
        if (!l) return
        clearTimeout(l.waechter)
        this.laufend.delete(auftrag)
        l.reject(fehler('ABGEBROCHEN', 'abgebrochen'))
        this.kind?.postMessage({ typ: 'abbrechen', auftrag } satisfies AnDienst)
      }
    }
  }

  /** Beim Beenden der App: laufende Aufträge abbrechen, Prozess beenden. */
  beenden(): void {
    this.alleAbbrechen(fehler('ABGEBROCHEN', 'App wird beendet'))
    const kind = this.kind
    this.kind = null
    kind?.kill()
  }
}

export const bilddienst = new Bilddienst()
