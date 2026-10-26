// thumb://id/<kennung>/<stufe> – Vorschaubilder für den Renderer (Schicht C: der Renderer kennt
// nur Kennungen, nie Pfade). Die Adresse wird streng geprüft (shared/vorschau.ts), die Kennung im
// Index nachgeschlagen; geliefert wird nur aus dem verschlüsselten Cache bzw. – Ordner „privat“ –
// aus dem Arbeitsspeicher. Keine Datei des Nutzers wird hier gelesen. Muster: foto:// der
// Mottulbox (project_mega/src/main/ipc/fotos.handlers.ts).

import { protocol } from 'electron'
import { leseThumbUrl, THUMB_PROTOKOLL } from '@shared/vorschau'
import { inhaltstyp } from '../cache/vorschauCache'
import { vorschauHolen } from '../library/vorschauen'
import { logLine } from '../log'

/** Vor `app.whenReady()`: thumb als sicheres Standard-Protokoll (für <img> in der App-Seite). */
export function thumbSchemaAnmelden(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: THUMB_PROTOKOLL, privileges: { standard: true, secure: true } }
  ])
}

const antwort = (status: number): Response => new Response(null, { status })

/** Nach `ready`: Anfragen an thumb:// bedienen (Standard-Sitzung). */
export function thumbProtokollBedienen(): void {
  protocol.handle(THUMB_PROTOKOLL, async (request) => {
    if (request.method !== 'GET') return antwort(405)
    const a = leseThumbUrl(request.url)
    if (!a) return antwort(400)
    try {
      const bild = await vorschauHolen(a.id, a.stufe)
      if (!bild) return antwort(404)
      // bekanntes Bild ohne Vorschau (defekt …): 204 statt 404 – die Seite zeigt den Platzhalter,
      // und es entsteht kein Konsolenfehler für einen erwarteten Fall
      if (bild === 'keins') return antwort(204)
      return new Response(bild, {
        status: 200,
        headers: {
          'Content-Type': inhaltstyp(bild),
          'Content-Length': String(bild.byteLength),
          'X-Content-Type-Options': 'nosniff',
          // nie in einen Cache auf der Platte (Schicht D: Vorschaubilder nur verschlüsselt)
          'Cache-Control': 'no-store'
        }
      })
    } catch (err) {
      // nur Kennung und Code ins Log, keine Pfade
      logLine('[thumb://] Fehler bei', a.id, (err as NodeJS.ErrnoException).code ?? String(err))
      return antwort(500)
    }
  })
}
