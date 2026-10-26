// ExifTool im -stay_open-Betrieb – läuft im Bilddienst (eigener Prozess), nie im main.
// Muster aus dem Labor (scripts/labor/exiftool-durchsatz.mjs): je Befehl „-execute<n>“, Ende an
// „{ready<n>}“; Argumente und Pfade über stdin (UTF-8, `-charset filename=utf8` – Umlaute und
// Emoji, ein Name wie „-rf.jpg“ wird so nie zur Option, weil Pfade absolut sind). Ein Befehl hat
// ein Zeitlimit; hängt ExifTool an einer präparierten Datei, wird der Prozess beendet und der
// nächste Befehl startet einen neuen (Skill metadaten-schreiben, „Aufrufe“).

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

export interface ExifToolAntwort {
  ausgabe: string
  /** stderr während des Befehls (z. B. „File not found“) */
  meldungen: string
}

/** Ein ExifTool-Prozess; Befehle laufen nacheinander. */
export class ExifToolProzess {
  private p: ChildProcessWithoutNullStreams | null = null
  private puffer = ''
  private fehlerPuffer = ''
  private nr = 0
  private warte: {
    nr: number
    resolve: (a: ExifToolAntwort) => void
    reject: (e: Error) => void
    timer: NodeJS.Timeout
  } | null = null
  private kette: Promise<unknown> = Promise.resolve()

  constructor(private readonly bin: string) {}

  private starten(): ChildProcessWithoutNullStreams {
    if (this.p) return this.p
    const p = spawn(
      this.bin,
      ['-stay_open', 'True', '-@', '-', '-common_args', '-charset', 'filename=utf8'],
      {
        windowsHide: true
      }
    )
    p.stdout.setEncoding('utf8')
    p.stderr.setEncoding('utf8')
    // Ereignisse eines abgelösten Prozesses (nach Zeitlimit beendet) zählen nicht mehr – sonst
    // träfe sein spätes „exit“ den Befehl, der schon im neuen Prozess läuft (Labortest)
    p.stdout.on('data', (d: string) => {
      if (this.p !== p) return
      this.puffer += d
      this.pruefeFertig()
    })
    p.stderr.on('data', (d: string) => {
      if (this.p === p) this.fehlerPuffer += d
    })
    p.on('error', (err) => {
      if (this.p !== p) return
      this.p = null
      this.abbrechen(err)
    })
    p.on('exit', (code) => {
      if (this.p !== p) return
      this.p = null
      this.abbrechen(new Error(`ExifTool beendet (Code ${code})`))
    })
    this.p = p
    return p
  }

  /** Prozess ablösen und beenden (Zeitlimit): der nächste Befehl startet einen neuen. */
  private abloesen(): void {
    const p = this.p
    this.p = null
    this.puffer = ''
    this.fehlerPuffer = ''
    p?.kill()
  }

  private pruefeFertig(): void {
    const w = this.warte
    if (!w) return
    const marke = `{ready${w.nr}}`
    const i = this.puffer.indexOf(marke)
    if (i < 0) return
    const ausgabe = this.puffer.slice(0, i)
    this.puffer = this.puffer.slice(i + marke.length).replace(/^\r?\n/, '')
    const meldungen = this.fehlerPuffer.trim()
    this.fehlerPuffer = ''
    clearTimeout(w.timer)
    this.warte = null
    w.resolve({ ausgabe, meldungen })
  }

  private abbrechen(err: Error): void {
    const w = this.warte
    if (!w) return
    clearTimeout(w.timer)
    this.warte = null
    this.puffer = ''
    this.fehlerPuffer = ''
    w.reject(err)
  }

  /** Einen Befehl ausführen (Argumente je Zeile; keine Zeilenumbrüche in Werten). */
  ausfuehren(args: readonly string[], zeitlimitMs = 30_000): Promise<ExifToolAntwort> {
    const lauf = this.kette.then(
      () =>
        new Promise<ExifToolAntwort>((resolve, reject) => {
          if (args.some((a) => /[\r\n]/.test(a))) {
            reject(new Error('Zeilenumbruch in einem ExifTool-Argument'))
            return
          }
          const p = this.starten()
          const nr = ++this.nr
          const timer = setTimeout(() => {
            this.abbrechen(
              Object.assign(new Error('ExifTool antwortet nicht (Zeitlimit)'), {
                code: 'ZEITLIMIT'
              })
            )
            this.abloesen()
          }, zeitlimitMs)
          this.warte = { nr, resolve, reject, timer }
          p.stdin.write([...args, `-execute${nr}`].join('\n') + '\n')
        })
    )
    this.kette = lauf.catch(() => {})
    return lauf
  }

  /** Sauber beenden (stay_open False), notfalls hart. */
  beenden(): void {
    const p = this.p
    this.p = null
    if (!p) return
    try {
      p.stdin.write('-stay_open\nFalse\n')
      p.stdin.end()
    } catch {
      /* schon zu */
    }
    setTimeout(() => p.kill(), 2000).unref()
  }
}

/** Mehrere ExifTool-Prozesse; verteilt Befehle auf den, der als Nächstes frei ist. */
export class ExifToolPool {
  private readonly prozesse: ExifToolProzess[]
  private naechster = 0

  constructor(bin: string, anzahl: number) {
    this.prozesse = Array.from({ length: Math.max(1, anzahl) }, () => new ExifToolProzess(bin))
  }

  get groesse(): number {
    return this.prozesse.length
  }

  ausfuehren(args: readonly string[], zeitlimitMs?: number): Promise<ExifToolAntwort> {
    const p = this.prozesse[this.naechster++ % this.prozesse.length]
    return p.ausfuehren(args, zeitlimitMs)
  }

  beenden(): void {
    for (const p of this.prozesse) p.beenden()
  }
}

/** Pfad zum Vergleichen mit dem SourceFile von ExifTool („/“, NFC; Windows ohne Groß/Klein). */
export function pfadVergleich(pfad: string, windows = process.platform === 'win32'): string {
  const p = pfad.normalize('NFC').replace(/\\/g, '/')
  return windows ? p.toLowerCase() : p
}

/**
 * Tags vieler Dateien lesen (-json -n -G0). Ergebnis je übergebenem Pfad; null = ExifTool hat
 * die Datei nicht geliefert (nicht gefunden, nicht lesbar). Verteilt auf den Pool in Teilen.
 */
export async function leseTags(
  pool: ExifToolPool,
  pfade: readonly string[],
  tags: readonly string[],
  teilGroesse = 50
): Promise<Map<string, Record<string, unknown> | null>> {
  const ergebnis = new Map<string, Record<string, unknown> | null>(pfade.map((p) => [p, null]))
  const nachVergleich = new Map(pfade.map((p) => [pfadVergleich(p), p]))
  const teile: string[][] = []
  for (let i = 0; i < pfade.length; i += teilGroesse) teile.push(pfade.slice(i, i + teilGroesse))
  await Promise.all(
    teile.map(async (teil) => {
      let a: ExifToolAntwort
      try {
        a = await pool.ausfuehren(['-json', '-n', '-G0', ...tags, ...teil])
      } catch {
        return // Zeitlimit oder Absturz: dieser Teil gilt als nicht gelesen, der Rest zählt
      }
      let liste: unknown
      try {
        liste = JSON.parse(a.ausgabe || '[]')
      } catch {
        return // kaputte Ausgabe: der ganze Teil gilt als nicht gelesen
      }
      if (!Array.isArray(liste)) return
      for (const eintrag of liste) {
        if (!eintrag || typeof eintrag !== 'object') continue
        const quelle = (eintrag as Record<string, unknown>).SourceFile
        const pfad =
          typeof quelle === 'string' ? nachVergleich.get(pfadVergleich(quelle)) : undefined
        if (pfad) ergebnis.set(pfad, eintrag as Record<string, unknown>)
      }
    })
  )
  return ergebnis
}
