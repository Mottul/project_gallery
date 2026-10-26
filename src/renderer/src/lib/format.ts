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
