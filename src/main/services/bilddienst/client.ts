// Bilddienst aus Sicht des main: startet den Prozess bei Bedarf (utilityProcess), schickt
// Aufträge mit Kennung und reicht die Antworten weiter. Stirbt der Dienst, scheitern seine
// laufenden Aufträge mit einer klaren Meldung, und der nächste Auftrag startet ihn neu. Kommt zu
// einem Auftrag zu lange nichts (hängendes Netzlaufwerk), wird der Dienst beendet – ein Scan, der
// in einem Systemaufruf feststeckt, lässt sich nicht anders abbrechen. Änderungen in überwachten
// Ordnern kommen ohne Auftrag (onAenderung); stirbt der Dienst, sind seine Wächter weg – das meldet
// onEnde, damit die Bibliothek sie neu anlegt.

import { utilityProcess, type UtilityProcess } from 'electron'
import { join } from 'node:path'
import { vorschauEinrichtung } from '../cache/vorschauCache'
import { exiftoolPfad } from '../exiftool/binPath'
import type { GefundeneDatei } from '../library/repo'
import { logLine } from '../log'
import type { Meldung } from './beobachter'
import {
  ARG_EXIFTOOL,
  vorschauParallel,
  type AnDienst,
  type MetaDatei,
  type MetaErgebnis,
  type AnzeigeDatei,
  type AnzeigeErgebnis,
  type VomDienst,
  type VorschauDatei,
  type VorschauErgebnis
} from './protokoll'

/** So lange darf ein Auftrag ohne jede Nachricht bleiben (ein Stapel kommt sonst alle paar ms). */
const STILLE_MS = 60_000

export interface ScanAuftrag {
  /** Ende des Scans: gefunden und nicht lesbare Pfade; scheitert mit `code` am Fehler */
  fertig: Promise<{ gefunden: number; unlesbar: string[] }>
  abbrechen(): void
}

interface Laufend {
  onStapel?: (dateien: GefundeneDatei[]) => void
  resolve: (r: unknown) => void
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
  /** Änderungen in einem überwachten Ordner (Kennung im Index) */
  onAenderung: ((ordner: number, meldung: Meldung) => void) | null = null
  /** Der Dienst ist unerwartet beendet (Absturz, Zeitlimit) – seine Wächter sind weg */
  onEnde: (() => void) | null = null

  private prozess(): UtilityProcess {
    if (this.kind) return this.kind
    const kind = utilityProcess.fork(
      join(__dirname, 'bilddienst.js'),
      [ARG_EXIFTOOL + (exiftoolPfad() ?? '')],
      {
        serviceName: 'Galeria Bilddienst',
        stdio: 'pipe',
        // libuv-Threads: einer je paralleles Bild plus zwei für Dateizugriffe (Labor) – sonst
        // verhungerte der Scan neben sharp
        env: { ...process.env, UV_THREADPOOL_SIZE: String(vorschauParallel() + 2) }
      }
    )
    kind.stdout?.on('data', (d) => logLine('[bilddienst]', String(d).trimEnd()))
    kind.stderr?.on('data', (d) => logLine('[bilddienst!]', String(d).trimEnd()))
    kind.on('message', (n: VomDienst) => this.eingang(n))
    // als erste Nachricht: Schlüssel und Ablage des Vorschau-Caches (nie als Argument – die
    // Befehlszeile eines Prozesses kann jedes Programm des Benutzers lesen)
    const e = vorschauEinrichtung()
    kind.postMessage({
      typ: 'einrichten',
      schluessel: e.schluessel,
      cacheOrdner: e.cacheOrdner,
      ffmpeg: e.ffmpeg
    } satisfies AnDienst)
    kind.on('exit', (code) => {
      if (this.kind !== kind) return
      this.kind = null
      if (this.laufend.size) logLine('[bilddienst] beendet, Code', code)
      this.alleAbbrechen(fehler('DIENST_BEENDET', `Bilddienst beendet (Code ${code})`))
      this.onEnde?.()
    })
    this.kind = kind
    return kind
  }

  private wache(auftrag: number): NodeJS.Timeout {
    return setTimeout(() => {
      logLine('[bilddienst] Auftrag', auftrag, `ohne Antwort seit ${STILLE_MS / 1000} s – Neustart`)
      const l = this.laufend.get(auftrag)
      this.laufend.delete(auftrag)
      l?.reject(fehler('ZEITLIMIT', 'Der Bilddienst antwortet nicht (Zeitlimit)'))
      this.kind?.kill()
    }, STILLE_MS)
  }

  /** Eingegangen, noch nicht verarbeitet (in Reihenfolge) */
  private readonly warten: VomDienst[] = []
  private verarbeitet = false

  /**
   * Nachrichten einzeln verarbeiten und dazwischen an die Ereignisschleife abgeben: Kommen die
   * Stapel eines Scans schneller, als der Index sie schreibt, stauen sie sich – am Stück
   * abgearbeitet hielten sie den main sekundenlang an (gemessen mit 50.000 Bildern: bis 6,8 s,
   * Fenster und IPC standen). Die Reihenfolge bleibt (Stapel vor „fertig“).
   */
  private eingang(n: VomDienst): void {
    this.warten.push(n)
    if (this.verarbeitet) return
    this.verarbeitet = true
    const weiter = (): void => {
      const naechste = this.warten.shift()
      if (naechste) this.nachricht(naechste)
      if (this.warten.length) setImmediate(weiter)
      else this.verarbeitet = false
    }
    setImmediate(weiter)
  }

  private nachricht(n: VomDienst): void {
    if (n.typ === 'log') {
      logLine('[bilddienst]', n.text)
      return
    }
    if (n.typ === 'aenderung') {
      this.onAenderung?.(n.ordner, n.meldung)
      return
    }
    const l = this.laufend.get(n.auftrag)
    if (!l) return // abgebrochen oder schon beendet
    clearTimeout(l.waechter)
    if (n.typ === 'stapel') {
      l.waechter = this.wache(n.auftrag)
      l.onStapel?.(n.dateien)
      return
    }
    this.laufend.delete(n.auftrag)
    if (n.typ === 'fertig') l.resolve({ gefunden: n.gefunden, unlesbar: n.unlesbar })
    else if (n.typ === 'meta-ergebnis' || n.typ === 'vorschau-ergebnis') l.resolve(n.ergebnisse)
    else if (n.typ === 'anzeige-ergebnis') l.resolve(n.ergebnis)
    else if (n.typ === 'beobachtet') l.resolve({ netz: n.netz })
    else l.reject(fehler(n.code, n.meldung))
  }

  private alleAbbrechen(err: Error): void {
    for (const l of this.laufend.values()) {
      clearTimeout(l.waechter)
      l.reject(err)
    }
    this.laufend.clear()
  }

  /** Auftrag schicken; die Antwort kommt über nachricht(). */
  private auftrag<T>(
    bauen: (auftrag: number) => AnDienst,
    onStapel?: (dateien: GefundeneDatei[]) => void
  ): { auftrag: number; antwort: Promise<T> } {
    const auftrag = this.naechster++
    const antwort = new Promise<T>((resolve, reject) => {
      this.laufend.set(auftrag, {
        onStapel,
        resolve: resolve as (r: unknown) => void,
        reject,
        waechter: this.wache(auftrag)
      })
    })
    this.prozess().postMessage(bauen(auftrag))
    return { auftrag, antwort }
  }

  /**
   * Ordner einlesen; `onStapel` bekommt die gefundenen Dateien in Stapeln (in Reihenfolge).
   * Mit `teil` nur diese (relativ, „/“) – Teil-Scan nach dem Überwachen.
   */
  scan(
    wurzel: string,
    onStapel: (dateien: GefundeneDatei[]) => void,
    teil?: { pfade: string[]; dateien: string[] }
  ): ScanAuftrag {
    const { auftrag, antwort } = this.auftrag<{ gefunden: number; unlesbar: string[] }>(
      (a) =>
        teil
          ? { typ: 'teilscan', auftrag: a, wurzel, ...teil }
          : { typ: 'scan', auftrag: a, wurzel },
      onStapel
    )
    return {
      fertig: antwort,
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

  /** Ordner überwachen (Änderungen kommen über onAenderung); netz = nicht überwacht. */
  beobachten(ordner: number, wurzel: string): Promise<{ netz: boolean }> {
    return this.auftrag<{ netz: boolean }>((a) => ({
      typ: 'beobachten',
      auftrag: a,
      ordner,
      wurzel
    })).antwort
  }

  nichtBeobachten(ordner: number): void {
    this.kind?.postMessage({ typ: 'nicht-beobachten', ordner } satisfies AnDienst)
  }

  /** Grundfelder (rohe ExifTool-Tags) vieler Dateien lesen. */
  meta(dateien: MetaDatei[]): Promise<MetaErgebnis[]> {
    return this.auftrag<MetaErgebnis[]>((a) => ({ typ: 'meta', auftrag: a, dateien })).antwort
  }

  /** Vorschaubilder erzeugen (je Datei ein Ergebnis, auch bei Fehlern – dann mit Code). */
  vorschau(dateien: VorschauDatei[]): Promise<VorschauErgebnis[]> {
    return this.auftrag<VorschauErgebnis[]>((a) => ({ typ: 'vorschau', auftrag: a, dateien }))
      .antwort
  }

  /** Bildschirmgroße Fassung für den Betrachter (TIFF); Fehler kommen als Code zurück. */
  anzeige(datei: AnzeigeDatei): Promise<AnzeigeErgebnis> {
    return this.auftrag<AnzeigeErgebnis>((a) => ({ typ: 'anzeige', auftrag: a, datei })).antwort
  }

  /** Beim Beenden der App: laufende Aufträge abbrechen, ExifTool sauber beenden, Prozess beenden. */
  beenden(): void {
    this.alleAbbrechen(fehler('ABGEBROCHEN', 'App wird beendet'))
    const kind = this.kind
    this.kind = null
    if (!kind) return
    try {
      kind.postMessage({ typ: 'beenden' } satisfies AnDienst)
    } catch {
      /* schon weg */
    }
    setTimeout(() => kind.kill(), 1000).unref()
  }
}

export const bilddienst = new Bilddienst()
