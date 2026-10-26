// bild://id/<kennung> – das Bild für den Betrachter (Schicht C: der Renderer kennt nur Kennungen).
// Adresse streng geprüft (shared/bild.ts), Datei geprüft (library/anzeige.ts); das Original als
// Datenstrom, auf Wunsch nur ein Bereich (Range – Videos spulen damit, Phase 6), sonst eine
// Umrechnung. Nie in einen Cache auf der Platte (no-store).

import { protocol } from 'electron'
import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { BILD_PROTOKOLL, leseBildUrl, leseRange } from '@shared/bild'
import { inhaltstyp } from '../cache/vorschauCache'
import { bildFuerBetrachter } from '../library/library'
import { logLine } from '../log'

const antwort = (status: number, headers?: Record<string, string>): Response =>
  new Response(null, { status, headers })

const KOPF = { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' }

export function bildProtokollBedienen(): void {
  protocol.handle(BILD_PROTOKOLL, async (request) => {
    if (request.method !== 'GET') return antwort(405)
    const a = leseBildUrl(request.url)
    if (!a) return antwort(400)
    try {
      const b = await bildFuerBetrachter(a.id)
      if (b.art === 'status') return antwort(b.status)
      if (b.art === 'daten') {
        return new Response(b.daten, {
          status: 200,
          headers: {
            ...KOPF,
            'Content-Type': inhaltstyp(b.daten),
            'Content-Length': String(b.daten.byteLength)
          }
        })
      }
      const bereich = leseRange(request.headers.get('range'), b.size)
      if (bereich === 'ungueltig') return antwort(416, { 'Content-Range': `bytes */${b.size}` })
      const [von, bis] = bereich ?? [0, b.size - 1]
      const strom =
        b.size === 0
          ? null
          : (Readable.toWeb(createReadStream(b.pfad, { start: von, end: bis })) as ReadableStream)
      return new Response(strom, {
        status: bereich ? 206 : 200,
        headers: {
          ...KOPF,
          'Content-Type': b.typ,
          'Content-Length': String(b.size === 0 ? 0 : bis - von + 1),
          'Accept-Ranges': 'bytes',
          ...(bereich ? { 'Content-Range': `bytes ${von}-${bis}/${b.size}` } : {})
        }
      })
    } catch (err) {
      logLine('[bild://] Fehler bei', a.id, (err as NodeJS.ErrnoException).code ?? String(err))
      return antwort(500)
    }
  })
}
