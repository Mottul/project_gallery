// Nächster Ort zu GPS-Koordinaten, offline (Phase 2.2) – rein, getestet in geo.test.ts. Die Orte
// kommen aus resources/geo/orte.tsv.gz (GeoNames cities1000 mit deutschen Namen,
// scripts/orte-bauen.mjs); geladen und gefragt wird im Bilddienst.
//
// Regel (Labor 29.10.2026): der nächste Ort im Umkreis von 50 km – es sei denn, der Punkt liegt
// im Umkreis einer mindestens zehnmal größeren Stadt (Radius wächst mit der Wurzel der
// Einwohnerzahl, Paris ≈ 7 km): dann diese Stadt. Ohne die Regel hieße ein Foto am Eiffelturm
// „Paris 16 Passy“ (GeoNames führt die Arrondissements als eigene Orte), ein Dorf neben einer
// Großstadt bleibt dagegen das Dorf.

export interface Ort {
  name: string
  lat: number
  lon: number
  /** ISO-3166-Ländercode (zwei Buchstaben) */
  land: string
  einw: number
}

/** Weiter weg zählt kein Ort mehr (Foto auf See, in der Wildnis) */
export const MAX_KM = 50
/** So viel größer muss eine Stadt sein, um den nächsten Ort zu überstimmen */
const GROESSER = 10
/** Radius einer Stadt in km je √Einwohner (Paris 2,1 Mio. ≈ 7 km, 100.000 ≈ 1,6 km) */
const RADIUS_JE_WURZEL = 0.005

const RAD = Math.PI / 180

/** Entfernung zweier Punkte in km (Haversine, Erdradius 6371 km). */
export function entfernungKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number }
): number {
  const dLat = (b.lat - a.lat) * RAD
  const dLon = (b.lon - a.lon) * RAD
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Zeilen der Ortsdatei („Name\tBreite\tLänge\tLand\tEinwohner“); Unbrauchbares fällt weg. */
export function orteParsen(text: string): Ort[] {
  const out: Ort[] = []
  for (const z of text.split('\n')) {
    const f = z.split('\t')
    if (f.length < 5) continue
    const lat = Number(f[1])
    const lon = Number(f[2])
    if (!f[0] || !(Math.abs(lat) <= 90) || !(Math.abs(lon) <= 180)) continue
    if (!/^[A-Z]{2}$/.test(f[3])) continue
    out.push({ name: f[0], lat, lon, land: f[3], einw: Math.max(0, Number(f[4]) || 0) })
  }
  return out
}

const zelle = (lat: number, lon: number): number =>
  (Math.floor(lat) + 90) * 360 + ((Math.floor(lon) + 540) % 360)

/** Orte in einem Raster aus 1°-Zellen: gefragt werden nur die Zellen um den Punkt. */
export class OrtsIndex {
  private readonly zellen = new Map<number, Ort[]>()

  constructor(orte: readonly Ort[]) {
    for (const o of orte) {
      const k = zelle(o.lat, o.lon)
      const liste = this.zellen.get(k)
      if (liste) liste.push(o)
      else this.zellen.set(k, [o])
    }
  }

  /** Nächster Ort nach der Regel oben; null = keiner im Umkreis von MAX_KM. */
  naechster(lat: number, lon: number): Ort | null {
    if (!(Math.abs(lat) <= 90) || !(Math.abs(lon) <= 180)) return null
    const p = { lat, lon }
    const dLat = Math.ceil(MAX_KM / 111)
    const cos = Math.cos(lat * RAD)
    const dLon = cos < 0.01 ? 180 : Math.min(180, Math.ceil(MAX_KM / (111 * cos)))
    const kandidaten: { o: Ort; km: number }[] = []
    // über die Datumsgrenze hinweg (zelle() rechnet die Länge um); jede Zelle nur einmal
    const besucht = new Set<number>()
    for (let i = Math.floor(lat) - dLat; i <= Math.floor(lat) + dLat; i++) {
      if (i < -90 || i > 89) continue
      for (let j = Math.floor(lon) - dLon; j <= Math.floor(lon) + dLon; j++) {
        const k = zelle(i, j)
        if (besucht.has(k)) continue
        besucht.add(k)
        for (const o of this.zellen.get(k) ?? []) {
          const km = entfernungKm(p, o)
          if (km <= MAX_KM) kandidaten.push({ o, km })
        }
      }
    }
    if (!kandidaten.length) return null
    let naechster = kandidaten[0]
    for (const k of kandidaten) if (k.km < naechster.km) naechster = k
    let stadt: { o: Ort; km: number } | null = null
    for (const k of kandidaten) {
      if (k.o.einw < GROESSER * Math.max(1, naechster.o.einw)) continue
      if (k.km > RADIUS_JE_WURZEL * Math.sqrt(k.o.einw)) continue
      if (!stadt || k.o.einw > stadt.o.einw) stadt = k
    }
    return (stadt ?? naechster).o
  }
}

let laender: Intl.DisplayNames | null = null

/** Ländername auf Deutsch aus dem ISO-Code („HR“ → „Kroatien“); unbekannt = der Code. */
export function landName(code: string): string {
  try {
    laender ??= new Intl.DisplayNames(['de'], { type: 'region' })
    return laender.of(code.toUpperCase()) ?? code
  } catch {
    return code
  }
}
