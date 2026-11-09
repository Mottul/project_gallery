// Ansicht „Metadaten bearbeiten“ (Phase 3.3), Rechnung ohne Oberfläche – rein, getestet in
// mehrfachFormular.test.ts: aus den gemischten Werten das Formular, aus dem Formular die Änderung für
// alle. Sie enthält nur, was der Nutzer angefasst hat: Ein Feld mit ‹verschieden›, das leer bleibt,
// behält in jeder Datei ihren Wert. Stichwörter werden nie als Liste geschickt, nur als dazu/weg.

import type { Farblabel } from '@shared/metaFields'
import {
  TEXT_FELDER,
  type MehrfachAenderung,
  type MehrfachWerte,
  type TextFeld
} from '@shared/metaMehrfach'
import { standortLesen, standortText } from './metaFormular'

export interface MehrfachForm {
  /** Eingaben; bei gleichem Wert in allen Dateien mit ihm vorbelegt, sonst leer (‹verschieden›) */
  texte: Record<TextFeld, string>
  /** „bei allen entfernen“ für Felder mit verschiedenen Werten */
  entfernen: TextFeld[]
  /** null = unberührt; 0 entfernt die Bewertung */
  bewertung: number | null
  /** undefined = unberührt; null entfernt das Label */
  farblabel: Farblabel | null | undefined
  /** Stichwörter für alle bzw. bei allen weg */
  dazu: string[]
  weg: string[]
  /** wie im Feld datetime-local; bei gleichem Datum vorbelegt */
  aufnahme: string
  /** „Breite, Länge“; bei gleichem Standort vorbelegt */
  standort: string
  standortWeg: boolean
}

/** Felder, wie die Ansicht sie zählt und als „geändert“ markiert */
export type Feld = TextFeld | 'bewertung' | 'farblabel' | 'stichwoerter' | 'aufnahme' | 'standort'

const klein = (s: string): string => s.toLowerCase()

export function formAus(w: MehrfachWerte): MehrfachForm {
  const texte = Object.fromEntries(
    TEXT_FELDER.map((k) => {
      const g = w[k]
      return [k, g.gleich ? (g.wert ?? '') : '']
    })
  ) as Record<TextFeld, string>
  return {
    texte,
    entfernen: [],
    bewertung: null,
    farblabel: undefined,
    dazu: [],
    weg: [],
    aufnahme: w.aufnahme.gleich ? (w.aufnahme.wert ?? '') : '',
    standort: w.standort.gleich ? standortText(w.standort.wert) : '',
    standortWeg: false
  }
}

/** `datetime-local` lässt volle Minuten ohne Sekunden */
const mitSekunden = (t: string): string => (t.length === 16 ? `${t}:00` : t)

export const STANDORT_HINWEIS = 'Standort bitte als „Breite, Länge“ angeben, z. B. 42.65, 18.09.'

/** Die Änderung für alle gewählten Bilder; ein Text, wenn eine Eingabe nicht geht. */
export function aenderungAus(w: MehrfachWerte, f: MehrfachForm): MehrfachAenderung | string {
  const a: MehrfachAenderung = {}
  for (const k of TEXT_FELDER) {
    const t = f.texte[k].trim()
    const g = w[k]
    if (g.gleich) {
      if (t !== (g.wert ?? '')) a[k] = t || null
    } else if (t) a[k] = t
    else if (f.entfernen.includes(k)) a[k] = null
  }
  if (f.bewertung !== null) a.bewertung = f.bewertung
  if (f.farblabel !== undefined) a.farblabel = f.farblabel
  const zeit = mitSekunden(f.aufnahme)
  if (w.aufnahme.gleich) {
    if (zeit !== (w.aufnahme.wert ?? '')) a.aufnahme = zeit ? { lokal: zeit } : null
  } else if (zeit) a.aufnahme = { lokal: zeit }
  if (f.standortWeg) a.standort = null
  else {
    const t = f.standort.trim()
    if (t !== (w.standort.gleich ? standortText(w.standort.wert) : '')) {
      const s = standortLesen(t)
      if (s === undefined) return STANDORT_HINWEIS
      a.standort = s
    }
  }
  if (f.dazu.length) a.stichwoerterDazu = f.dazu
  if (f.weg.length) a.stichwoerterWeg = f.weg
  return a
}

/** Welche Felder die Änderung anfasst (Stichwörter dazu und weg zählen als eines) */
export function geaenderteFelder(a: MehrfachAenderung): Set<Feld> {
  const out = new Set<Feld>()
  for (const k of Object.keys(a)) {
    out.add(k === 'stichwoerterDazu' || k === 'stichwoerterWeg' ? 'stichwoerter' : (k as Feld))
  }
  return out
}

/** Ein Feld zurück auf den gelesenen Stand */
export function feldZuruecksetzen(w: MehrfachWerte, f: MehrfachForm, feld: Feld): MehrfachForm {
  const start = formAus(w)
  if ((TEXT_FELDER as readonly string[]).includes(feld)) {
    const k = feld as TextFeld
    return {
      ...f,
      texte: { ...f.texte, [k]: start.texte[k] },
      entfernen: f.entfernen.filter((x) => x !== k)
    }
  }
  if (feld === 'bewertung') return { ...f, bewertung: null }
  if (feld === 'farblabel') return { ...f, farblabel: undefined }
  if (feld === 'stichwoerter') return { ...f, dazu: [], weg: [] }
  if (feld === 'aufnahme') return { ...f, aufnahme: start.aufnahme }
  return { ...f, standort: start.standort, standortWeg: false }
}

export interface Chip {
  wort: string
  /** so viele Dateien haben es nach dem Schreiben (bei „dazu“ alle) */
  anzahl: number
  /** in allen Dateien – sonst gestrichelt mit n/N */
  alle: boolean
}

/** Die Stichwort-Chips: gelesene ohne die entfernten, dazu die neuen; „dazu“ gilt für alle. */
export function chipsAus(w: MehrfachWerte, f: MehrfachForm): Chip[] {
  const weg = new Set(f.weg.map(klein))
  const dazu = new Set(f.dazu.map(klein))
  const out: Chip[] = w.stichwoerter
    .filter((s) => !weg.has(klein(s.wort)))
    .map((s) => {
      const anzahl = dazu.has(klein(s.wort)) ? w.anzahl : s.anzahl
      return { wort: s.wort, anzahl, alle: anzahl >= w.anzahl }
    })
  const da = new Set(out.map((c) => klein(c.wort)))
  for (const d of f.dazu) {
    if (!da.has(klein(d))) out.push({ wort: d, anzahl: w.anzahl, alle: true })
  }
  return out
}

/** Stichwort bei allen entfernen (Kreuz am Chip). */
export function stichwortWeg(w: MehrfachWerte, f: MehrfachForm, wort: string): MehrfachForm {
  const k = klein(wort)
  const dazu = f.dazu.filter((d) => klein(d) !== k)
  const gelesen = w.stichwoerter.some((s) => klein(s.wort) === k)
  const weg = gelesen && !f.weg.some((x) => klein(x) === k) ? [...f.weg, wort] : f.weg
  return { ...f, dazu, weg }
}

/** Stichwort bei allen setzen (Eingabe oder „+“ an einem Chip, den nur ein Teil hat). */
export function stichwortDazu(w: MehrfachWerte, f: MehrfachForm, roh: string): MehrfachForm {
  const wort = roh.trim()
  if (!wort || wort.includes(';')) return f
  const k = klein(wort)
  const weg = f.weg.filter((x) => klein(x) !== k)
  const gelesen = w.stichwoerter.find((s) => klein(s.wort) === k)
  // hatten es schon alle, genügt es, das Entfernen zurückzunehmen
  if ((gelesen && gelesen.anzahl >= w.anzahl) || f.dazu.some((d) => klein(d) === k)) {
    return { ...f, weg }
  }
  return { ...f, weg, dazu: [...f.dazu, gelesen?.wort ?? wort] }
}
