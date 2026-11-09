// Mehrfachauswahl (Phase 3.3) – rein, getestet in metaMehrfach.test.ts. Eine Änderung für viele
// Dateien sagt, was der Nutzer will (Felder setzen, Stichwörter dazu/weg), nie, was am Ende in jeder
// Datei steht: Erst der main bildet je Datei aus ihren frisch gelesenen Werten die Änderung
// (`aenderungFuer`) – nur, was sich dort wirklich ändert. So wird nie die Liste einer Datei auf die
// anderen kopiert, und eine Datei, die die Werte schon hat, bleibt unberührt (keine Sicherung, kein
// neues Änderungsdatum). Stichwörter vergleichen ohne Groß/Klein wie beim Lesen (`stichwoerterAus`).
// ExifTools `+=`/`-=` taugt dafür nicht (gemessen mit 13.59): `-=` achtet auf Groß/Klein (ein
// „meer“ bliebe in der Datei und käme beim Zusammenführen zurück), `+=` legt Doppelte an, und die
// XP-Stichwörter sind gar keine Liste.

import {
  pruefeFeld,
  pruefeStichwoerter,
  type Aufnahmezeit,
  type Farblabel,
  type MetaAenderung,
  type MetaWerte,
  type Standort
} from './metaFields'

/** Höchstens so viele Bilder je Auftrag (wie meta.write) */
export const MEHRFACH_MAX = 10_000

/** Was der Nutzer für alle gewählten Bilder ändert; ein Feld, das fehlt, bleibt je Datei, wie es ist. */
export interface MehrfachAenderung {
  bewertung?: number
  farblabel?: Farblabel | null
  titel?: string | null
  beschreibung?: string | null
  /** dieselbe Zeit für alle; die Zeitzone bleibt je Datei (wie im Panel) */
  aufnahme?: { lokal: string } | null
  standort?: Standort | null
  ort?: string | null
  region?: string | null
  land?: string | null
  ortsteil?: string | null
  urheber?: string | null
  copyright?: string | null
  /** kommen in jede Datei, die sie noch nicht hat (ohne Groß/Klein verglichen) */
  stichwoerterDazu?: string[]
  /** gehen aus jeder Datei weg, auch in anderer Schreibweise */
  stichwoerterWeg?: string[]
}

export const TEXT_FELDER = [
  'titel',
  'beschreibung',
  'ort',
  'region',
  'land',
  'ortsteil',
  'urheber',
  'copyright'
] as const
export type TextFeld = (typeof TEXT_FELDER)[number]

const klein = (s: string): string => s.toLowerCase()

/** Änderung aus dem Renderer prüfen; null = ungültig (unbekanntes Feld, Grenzen, leer, Widerspruch). */
export function pruefeMehrfachAenderung(v: unknown): MehrfachAenderung | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const e = v as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(e)) {
    const w = e[k]
    if (w === undefined) continue
    if (k === 'stichwoerterDazu' || k === 'stichwoerterWeg') {
      const l = pruefeStichwoerter(w)
      if (!l?.length) return null
      out[k] = l
    } else if (k === 'aufnahme') {
      // nur die lokale Zeit – die Zone kommt je Datei aus ihren Werten
      if (w === null) out.aufnahme = null
      else {
        if (typeof w !== 'object' || Array.isArray(w)) return null
        if (Object.keys(w).some((x) => x !== 'lokal')) return null
        const a = pruefeFeld('aufnahme', { lokal: (w as { lokal?: unknown }).lokal, offset: null })
        if (!a) return null
        out.aufnahme = { lokal: (a as Aufnahmezeit).lokal }
      }
    } else if (k === 'stichwoerter') {
      return null // ganze Listen gibt es nur für ein Bild – hier hieße das: auf alle kopieren
    } else {
      const g = pruefeFeld(k, w)
      if (g === undefined) return null
      out[k] = g
    }
  }
  const dazu = (out.stichwoerterDazu as string[] | undefined) ?? []
  const weg = new Set(((out.stichwoerterWeg as string[] | undefined) ?? []).map(klein))
  if (dazu.some((w) => weg.has(klein(w)))) return null
  return Object.keys(out).length ? (out as MehrfachAenderung) : null
}

/** Neue Stichwortliste einer Datei: Entferntes (ohne Groß/Klein) raus, Fehlendes hinten dran. */
export function stichwoerterNeu(
  alt: readonly string[],
  dazu: readonly string[] = [],
  weg: readonly string[] = []
): string[] {
  const raus = new Set(weg.map(klein))
  const out = alt.filter((w) => !raus.has(klein(w)))
  const da = new Set(out.map(klein))
  for (const w of dazu) {
    if (da.has(klein(w))) continue
    da.add(klein(w))
    out.push(w)
  }
  return out
}

const ortGleich = (a: Standort | null, b: Standort | null): boolean =>
  a === b ||
  (a !== null &&
    b !== null &&
    Math.abs(a.breite - b.breite) < 1e-6 &&
    Math.abs(a.laenge - b.laenge) < 1e-6)

/**
 * Die Änderung für eine Datei mit diesen (frisch gelesenen) Werten: nur Felder, die sich dort
 * ändern. null = die Datei hat schon alles so. Die Stichwortliste kann über die erlaubte Zahl
 * wachsen – das prüft der main danach wie jede Änderung (`pruefeMetaAenderung`).
 */
export function aenderungFuer(w: MetaWerte, m: MehrfachAenderung): MetaAenderung | null {
  const a: MetaAenderung = {}
  if (m.bewertung !== undefined && m.bewertung !== w.bewertung) a.bewertung = m.bewertung
  if (m.farblabel !== undefined && m.farblabel !== w.farblabel) a.farblabel = m.farblabel
  for (const k of TEXT_FELDER) {
    const neu = m[k]
    if (neu !== undefined && neu !== w[k]) a[k] = neu
  }
  if (m.aufnahme === null) {
    if (w.aufnahme !== null) a.aufnahme = null
  } else if (m.aufnahme !== undefined && m.aufnahme.lokal !== w.aufnahme?.lokal) {
    a.aufnahme = { lokal: m.aufnahme.lokal, offset: w.aufnahme?.offset ?? null }
  }
  if (m.standort !== undefined && !ortGleich(m.standort, w.standort)) a.standort = m.standort
  if (m.stichwoerterDazu?.length || m.stichwoerterWeg?.length) {
    const neu = stichwoerterNeu(w.stichwoerter, m.stichwoerterDazu, m.stichwoerterWeg)
    if (JSON.stringify(neu) !== JSON.stringify(w.stichwoerter)) a.stichwoerter = neu
  }
  return Object.keys(a).length ? a : null
}

// ── Gemischte Werte ───────────────────────────────────────────────────────────────────────────

/** Ein Feld über alle Dateien: in allen derselbe Wert, oder verschieden (‹verschieden›) */
export type Gemischt<T> = { gleich: true; wert: T } | { gleich: false }

/** Was die Ansicht „Metadaten bearbeiten“ über die gewählten (beschreibbaren) Dateien zeigt */
export interface MehrfachWerte {
  /** so viele Dateien flossen ein */
  anzahl: number
  bewertung: Gemischt<number>
  farblabel: Gemischt<string | null>
  titel: Gemischt<string | null>
  beschreibung: Gemischt<string | null>
  ort: Gemischt<string | null>
  region: Gemischt<string | null>
  land: Gemischt<string | null>
  ortsteil: Gemischt<string | null>
  urheber: Gemischt<string | null>
  copyright: Gemischt<string | null>
  /** jedes Stichwort mit der Zahl der Dateien, die es haben – die häufigsten zuerst */
  stichwoerter: { wort: string; anzahl: number }[]
  /** lokale Zeit; dazu die Spanne und wie viele kein Datum haben */
  aufnahme: Gemischt<string | null> & { von: string | null; bis: string | null; ohne: number }
  /** dazu, wie viele einen Standort haben */
  standort: Gemischt<Standort | null> & { mit: number }
}

function gemischt<T>(werte: readonly T[], gleich: (a: T, b: T) => boolean): Gemischt<T> {
  if (!werte.length) return { gleich: false }
  const [erster] = werte
  return werte.every((w) => gleich(w, erster)) ? { gleich: true, wert: erster } : { gleich: false }
}
const genau = <T>(a: T, b: T): boolean => a === b

/** Die gemischten Werte vieler Dateien (je Datei, was `werteAus` las). */
export function zusammenfassen(dateien: readonly MetaWerte[]): MehrfachWerte {
  const feld = <K extends keyof MetaWerte>(k: K): MetaWerte[K][] => dateien.map((d) => d[k])
  const worte = new Map<string, { wort: string; anzahl: number; rang: number }>()
  for (const d of dateien) {
    const gesehen = new Set<string>()
    for (const w of d.stichwoerter) {
      const s = klein(w)
      if (gesehen.has(s)) continue
      gesehen.add(s)
      const e = worte.get(s)
      if (e) e.anzahl++
      else worte.set(s, { wort: w, anzahl: 1, rang: worte.size })
    }
  }
  const zeiten = dateien.flatMap((d) => (d.aufnahme ? [d.aufnahme.lokal] : [])).sort()
  const texte = Object.fromEntries(TEXT_FELDER.map((k) => [k, gemischt(feld(k), genau)])) as Record<
    TextFeld,
    Gemischt<string | null>
  >
  return {
    anzahl: dateien.length,
    bewertung: gemischt(feld('bewertung'), genau),
    farblabel: gemischt(feld('farblabel'), genau),
    ...texte,
    stichwoerter: [...worte.values()]
      .sort((a, b) => b.anzahl - a.anzahl || a.rang - b.rang)
      .map(({ wort, anzahl }) => ({ wort, anzahl })),
    aufnahme: {
      ...gemischt(
        dateien.map((d) => d.aufnahme?.lokal ?? null),
        genau
      ),
      von: zeiten[0] ?? null,
      bis: zeiten.at(-1) ?? null,
      ohne: dateien.length - zeiten.length
    },
    standort: {
      ...gemischt(feld('standort'), ortGleich),
      mit: dateien.filter((d) => d.standort !== null).length
    }
  }
}

// ── Aufträge (Fortschritt, Bericht) ───────────────────────────────────────────────────────────

export type AuftragArt = 'lesen' | 'schreiben' | 'rueckgaengig'

/** Was mit einer Datei geschah */
export type DateiStatus =
  /** lesen: floss in die gemischten Werte ein */
  | 'gelesen'
  /** schreiben, rückgängig: steht in der Datei, nachgeprüft */
  | 'geschrieben'
  /** hatte die Werte schon – nicht angefasst */
  | 'unveraendert'
  /** inzwischen außerhalb geändert – übersprungen */
  | 'konflikt'
  /** darf nicht geschrieben werden (nur lesen, Format, defekt) */
  | 'abgelehnt'
  /** ging nicht (gesperrt, fehlt, Dienst) – die Datei ist unverändert */
  | 'fehler'

export interface DateiErgebnis {
  id: number
  status: DateiStatus
  /** Name und Grund für den Nutzer, wenn es nicht ging */
  name?: string
  grund?: string
  /** geschrieben: Sicherung in diesem Auftrag angelegt, schon vorhanden oder keine (privat) */
  sicherung?: 'neu' | 'vorhanden' | 'keine'
}

/** Ende eines Auftrags (letzte Meldung) */
export interface AuftragEnde {
  /** angehalten: was danach kam, ist unberührt und fehlt in `dateien` */
  abgebrochen: boolean
  /** alle bearbeiteten Dateien */
  dateien: DateiErgebnis[]
  /** schreiben, rückgängig: Journal-Zeilen – „Rückgängig“ nimmt sie in einem Schritt zurück */
  journal: number[]
  /** lesen: die gemischten Werte der lesbaren, beschreibbaren Dateien */
  werte?: MehrfachWerte
}

/** Fortschritt eines Auftrags (Ereignis aus dem main, gedrosselt) */
export interface AuftragStand {
  auftrag: number
  art: AuftragArt
  /** bearbeitete Dateien */
  fertig: number
  gesamt: number
  /** neue Ergebnisse seit der vorigen Meldung (beim Lesen nur die, die nicht einflossen) */
  dateien: DateiErgebnis[]
  ende?: AuftragEnde
}

/** Antwort auf den Start: Kennung des Auftrags, ein Grund, warum nicht, oder „Rückfrage verneint“ */
export type AuftragStart = { auftrag: number } | { grund: string } | { abgebrochen: true }

/** Optionen beim Schreiben */
export interface SchreibOptionen {
  /** vorher im main fragen („3 Sterne für 12 Bilder schreiben?“) – Schnellbewertung im Raster */
  rueckfrage?: boolean
  /** „Neu lesen und erneut versuchen“: erst die Dateien im Index abgleichen, dann schreiben */
  nochmal?: boolean
}

export function pruefeSchreibOptionen(v: unknown): SchreibOptionen | null {
  if (v === undefined) return {}
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const out: SchreibOptionen = {}
  for (const [k, w] of Object.entries(v)) {
    if ((k !== 'rueckfrage' && k !== 'nochmal') || typeof w !== 'boolean') return null
    out[k] = w
  }
  return out
}

const BILDER = (n: number): string => (n === 1 ? '1 Bild' : `${n.toLocaleString('de-DE')} Bilder`)
const BILDERN = (n: number): string => (n === 1 ? '1 Bild' : `${n.toLocaleString('de-DE')} Bildern`)
const FARBEN: Record<Farblabel, string> = {
  Red: 'Rot',
  Yellow: 'Gelb',
  Green: 'Grün',
  Blue: 'Blau',
  Purple: 'Lila'
}

/** Rückfrage vor einer Schnellbewertung vieler Bilder (im main, mit der Zahl der Bilder) */
export function rueckfrageText(m: MehrfachAenderung, n: number): string {
  const felder = Object.keys(m)
  if (felder.length === 1 && m.bewertung !== undefined) {
    if (m.bewertung === 0) return `Bewertung bei ${BILDERN(n)} entfernen?`
    const s = m.bewertung === 1 ? '1 Stern' : `${m.bewertung} Sterne`
    return `${s} für ${BILDER(n)} schreiben?`
  }
  if (felder.length === 1 && m.farblabel !== undefined) {
    if (m.farblabel === null) return `Farblabel bei ${BILDERN(n)} entfernen?`
    return `Farblabel ${FARBEN[m.farblabel]} für ${BILDER(n)} schreiben?`
  }
  return `Änderungen in ${BILDER(n)} schreiben?`
}
