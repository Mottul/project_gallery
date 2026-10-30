// Bearbeiten-Panel (Phase 3.2), Rechnung ohne Oberfläche – rein, getestet in metaFormular.test.ts:
// Werte der Datei ins Formular, Eingaben prüfen, und die Änderung bilden. Sie enthält nur, was sich
// wirklich geändert hat: Was der Nutzer nicht anfasst, bleibt in der Datei, wie es ist.

import type { Farblabel, MetaAenderung, MetaWerte, Standort } from '@shared/metaFields'

export interface FormWerte {
  bewertung: number
  /** leer = kein Label */
  farblabel: string
  titel: string
  beschreibung: string
  stichwoerter: string[]
  /** wie im Feld `datetime-local`; leer = kein Datum */
  aufnahme: string
  /** „Breite, Länge“; leer = kein Standort */
  standort: string
  ort: string
  region: string
  land: string
  ortsteil: string
  urheber: string
  copyright: string
}

export const standortText = (s: Standort | null): string =>
  s ? `${Number(s.breite.toFixed(6))}, ${Number(s.laenge.toFixed(6))}` : ''

export function formAus(w: MetaWerte): FormWerte {
  return {
    bewertung: w.bewertung,
    farblabel: w.farblabel ?? '',
    titel: w.titel ?? '',
    beschreibung: w.beschreibung ?? '',
    stichwoerter: w.stichwoerter,
    aufnahme: w.aufnahme?.lokal ?? '',
    standort: standortText(w.standort),
    ort: w.ort ?? '',
    region: w.region ?? '',
    land: w.land ?? '',
    ortsteil: w.ortsteil ?? '',
    urheber: w.urheber ?? '',
    copyright: w.copyright ?? ''
  }
}

const ZAHL = String.raw`-?\d+(?:[.,]\d+)?`
const ZWEI_ZAHLEN = new RegExp(String.raw`^(${ZAHL})\s*[;,\s]\s*(${ZAHL})$`)

/** „42.65, 18.09“ oder „42,65 18,09“; null = leer, undefined = keine gültige Angabe. */
export function standortLesen(text: string): Standort | null | undefined {
  const t = text.trim()
  if (!t) return null
  const m = ZWEI_ZAHLEN.exec(t)
  if (!m) return undefined
  const breite = Number(m[1].replace(',', '.'))
  const laenge = Number(m[2].replace(',', '.'))
  if (Math.abs(breite) > 90 || Math.abs(laenge) > 180 || (breite === 0 && laenge === 0)) {
    return undefined
  }
  return { breite, laenge }
}

/** `datetime-local` lässt volle Minuten ohne Sekunden */
const mitSekunden = (t: string): string => (t.length === 16 ? `${t}:00` : t)

/** Die Änderung gegenüber der Datei; ein Text, wenn eine Eingabe nicht geht. */
export function aenderungAus(alt: MetaWerte, neu: FormWerte): MetaAenderung | string {
  const a: MetaAenderung = {}
  if (neu.bewertung !== alt.bewertung) a.bewertung = neu.bewertung
  if (neu.farblabel !== (alt.farblabel ?? '')) a.farblabel = (neu.farblabel || null) as Farblabel
  const texte = [
    'titel',
    'beschreibung',
    'ort',
    'region',
    'land',
    'ortsteil',
    'urheber',
    'copyright'
  ] as const
  for (const k of texte) {
    const t = neu[k].trim() || null
    if (t !== alt[k]) a[k] = t
  }
  if (JSON.stringify(neu.stichwoerter) !== JSON.stringify(alt.stichwoerter)) {
    a.stichwoerter = neu.stichwoerter
  }
  const zeit = mitSekunden(neu.aufnahme)
  if (zeit !== (alt.aufnahme?.lokal ?? '')) {
    a.aufnahme = zeit ? { lokal: zeit, offset: alt.aufnahme?.offset ?? null } : null
  }
  if (neu.standort.trim() !== standortText(alt.standort)) {
    const s = standortLesen(neu.standort)
    if (s === undefined) return 'Standort bitte als „Breite, Länge“ angeben, z. B. 42.65, 18.09.'
    a.standort = s
  }
  return a
}
