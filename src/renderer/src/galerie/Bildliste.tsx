// Vorläufige Tabelle der ersten Bilder in der gewählten Reihenfolge – bis das virtualisierte
// Raster mit Liste/Details kommt (1.4). Zeigt nur, was der Index liefert; keine Pfade.
import type { Bildliste as Liste } from '@renderer/lib/bildliste'
import type { ImageInfo } from '@shared/types'

const zahl = new Intl.NumberFormat('de-DE')
const dezimal = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 })

/** „1,2 MB“ – Dateigröße in Byte, KB, MB, GB (1024er-Schritte wie im Windows-Explorer) */
export function groesseText(bytes: number): string {
  const einheiten = ['Byte', 'KB', 'MB', 'GB', 'TB']
  let v = bytes
  let i = 0
  while (v >= 1024 && i < einheiten.length - 1) {
    v /= 1024
    i++
  }
  return `${i === 0 ? zahl.format(v) : dezimal.format(v)} ${einheiten[i]}`
}

/** „14.07.2024 18:30“ aus der lokalen Aufnahmezeit – ohne Umrechnung in eine Zeitzone */
export function datumText(lokal: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(lokal)
  return m ? `${m[3]}.${m[2]}.${m[1]} ${m[4]}:${m[5]}` : lokal
}

function Aufnahme({ bild }: { bild: ImageInfo }): JSX.Element {
  const ausDatei = bild.takenSource.startsWith('datei-')
  return (
    <span title={ausDatei ? 'Datum aus der Datei, nicht aus der Kamera' : undefined}>
      {datumText(bild.takenAt)}
      {ausDatei && <span className="text-muted-foreground"> (Datei)</span>}
    </span>
  )
}

export function Bildliste({ liste }: { liste: Liste }): JSX.Element {
  if (liste.fehler) {
    return <p className="p-4 text-sm text-danger">Liste nicht verfügbar: {liste.fehler}</p>
  }
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full border-collapse text-sm" aria-label="Bilder">
        <thead className="sticky top-0 bg-background text-left text-xs text-muted-foreground">
          <tr className="border-b">
            <th className="px-4 py-1.5 font-medium">Name</th>
            <th className="px-2 py-1.5 font-medium">Aufnahme</th>
            <th className="px-2 py-1.5 font-medium">Maße</th>
            <th className="px-2 py-1.5 text-right font-medium">Größe</th>
            <th className="px-4 py-1.5 font-medium">Format</th>
          </tr>
        </thead>
        <tbody>
          {liste.bilder.map((b) => (
            <tr key={b.id} data-id={b.id} className="border-b border-border/50 hover:bg-muted/40">
              <td className="max-w-80 truncate px-4 py-1" title={b.name}>
                {b.name}
              </td>
              <td className="whitespace-nowrap px-2 py-1">
                <Aufnahme bild={b} />
              </td>
              <td className="whitespace-nowrap px-2 py-1">
                {b.width && b.height ? `${zahl.format(b.width)} × ${zahl.format(b.height)}` : '–'}
              </td>
              <td className="whitespace-nowrap px-2 py-1 text-right">{groesseText(b.size)}</td>
              <td className="px-4 py-1 uppercase">{b.format ?? b.ext}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {liste.ids.length > liste.bilder.length && (
        <p className="px-4 py-2 text-xs text-muted-foreground">
          Die ersten {zahl.format(liste.bilder.length)} von {zahl.format(liste.ids.length)} – die
          vollständige Ansicht mit Kacheln folgt.
        </p>
      )}
    </div>
  )
}
