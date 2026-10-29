// Anzeige-Formate der Galerie (deutsch): Anzahlen, Dateigrößen, Aufnahmezeit.

export const zahl = new Intl.NumberFormat('de-DE')
const dezimal = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 })

/** „1 Bild“ / „12.345 Bilder“ */
export function bilderText(n: number): string {
  return `${zahl.format(n)} ${n === 1 ? 'Bild' : 'Bilder'}`
}

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

/** „14.07.2024“ (Kacheln: nur der Tag) */
export function tagText(lokal: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(lokal)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : lokal
}

// ── Aufnahmedaten (Info-Panel, 2.1) ──────────────────────────────────────────────────────────

const grad = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 4, maximumFractionDigits: 4 })

/** „1/250 s“ unter einer Sekunde, sonst „2 s“ bzw. „1,5 s“ */
export function belichtungText(sekunden: number): string {
  if (sekunden < 1) {
    const kehr = 1 / sekunden
    // 1/3 s, 1/250 s; krumme Werte (0,3 s) als Dezimalzahl
    return Math.abs(kehr - Math.round(kehr)) < 0.05 * kehr
      ? `1/${zahl.format(Math.round(kehr))} s`
      : `${dezimal.format(sekunden)} s`
  }
  return `${dezimal.format(sekunden)} s`
}

/** „f/8“, „f/2,8“ */
export function blendeText(f: number): string {
  return `f/${dezimal.format(f)}`
}

/** „35 mm“, „4,3 mm“ */
export function brennweiteText(mm: number): string {
  return `${dezimal.format(mm)} mm`
}

/** „42,6507° N, 18,0944° O“ – Süd/West aus dem Vorzeichen */
export function gpsText(lat: number, lon: number): string {
  return (
    `${grad.format(Math.abs(lat))}° ${lat < 0 ? 'S' : 'N'}, ` +
    `${grad.format(Math.abs(lon))}° ${lon < 0 ? 'W' : 'O'}`
  )
}

/** „12,5“ – Zahl mit höchstens einer Nachkommastelle */
export function dezimalText(n: number): string {
  return dezimal.format(n)
}
