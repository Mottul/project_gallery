// Bearbeiten-Panel (Phase 3.2; Entwurf „Metadaten bearbeiten“): alle Felder eines Bildes, gelesen
// frisch aus der Datei, nicht aus dem Index. Gespeichert wird nur mit dem Knopf und nur, was sich
// geändert hat (`lib/metaFormular.ts`). Texte aus den Metadaten nur als Text, nie als HTML.
import { Loader2, Star, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Button } from '@renderer/components/ui/button'
import { api } from '@renderer/lib/api'
import { aenderungAus, formAus, type FormWerte } from '@renderer/lib/metaFormular'
import { cn, errorText } from '@renderer/lib/utils'
import { farblabelText } from '@shared/bildFilter'
import {
  BESCHREIBUNG_MAX,
  COPYRIGHT_MAX,
  FARBLABELS,
  ORT_MAX,
  TITEL_MAX,
  URHEBER_MAX,
  type MetaWerte,
  type SchreibBericht
} from '@shared/metaFields'
import type { ImageInfo } from '@shared/types'

const FELD =
  'w-full rounded-md border border-border bg-background px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70'

function Feld({ titel, children }: { titel: string; children: ReactNode }): JSX.Element {
  return (
    <label className="block space-y-0.5">
      <span className="text-xs text-muted-foreground">{titel}</span>
      {children}
    </label>
  )
}

function Sterne({ wert, onChange }: { wert: number; onChange: (n: number) => void }): JSX.Element {
  return (
    <div role="group" aria-label="Bewertung" className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          aria-label={n === 1 ? '1 Stern' : `${n} Sterne`}
          aria-pressed={wert === n}
          title={wert === n ? 'Bewertung entfernen' : undefined}
          onClick={() => onChange(wert === n ? 0 : n)}
          className="rounded-sm p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Star
            className={cn(
              'size-4',
              n <= wert ? 'fill-warning text-warning' : 'text-muted-foreground'
            )}
            aria-hidden
          />
        </button>
      ))}
    </div>
  )
}

/** Stichwörter als Marken: Enter, Komma oder Semikolon übernimmt, das Kreuz nimmt heraus. */
function Stichwoerter({
  werte,
  onChange,
  entwurf,
  onEntwurf
}: {
  werte: string[]
  onChange: (l: string[]) => void
  /** noch nicht übernommener Text – Speichern nimmt ihn mit */
  entwurf: string
  onEntwurf: (t: string) => void
}): JSX.Element {
  function uebernehmen(): void {
    const t = entwurf.trim()
    if (t && !werte.some((w) => w.toLowerCase() === t.toLowerCase())) onChange([...werte, t])
    onEntwurf('')
  }
  function taste(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter' || e.key === ',' || e.key === ';') {
      e.preventDefault()
      uebernehmen()
    } else if (e.key === 'Backspace' && !entwurf && werte.length) {
      onChange(werte.slice(0, -1))
    }
  }
  return (
    <div className="space-y-1">
      <span className="text-xs text-muted-foreground">Stichwörter</span>
      {werte.length > 0 && (
        <ul aria-label="Stichwörter" className="flex flex-wrap gap-1">
          {werte.map((w) => (
            <li
              key={w}
              className="inline-flex max-w-full items-center gap-1 rounded-sm bg-muted px-1.5 py-0.5 text-xs"
            >
              <span className="truncate">{w}</span>
              <button
                type="button"
                aria-label={`Stichwort „${w}“ entfernen`}
                onClick={() => onChange(werte.filter((x) => x !== w))}
                className="shrink-0 rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-3" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        aria-label="Stichwort hinzufügen"
        placeholder="Stichwort hinzufügen …"
        maxLength={100}
        value={entwurf}
        onChange={(e) => onEntwurf(e.target.value)}
        onKeyDown={taste}
        onBlur={uebernehmen}
        className={FELD}
      />
    </div>
  )
}

export function MetaFormular({
  bild,
  onGespeichert,
  onAbbrechen,
  onGeaendert
}: {
  bild: ImageInfo
  onGespeichert: (r: SchreibBericht<ImageInfo>) => void
  onAbbrechen: () => void
  /** Gibt es Ungespeichertes? Der Betrachter lässt dann nicht weiterblättern. */
  onGeaendert: (ungespeichert: boolean) => void
}): JSX.Element {
  const [werte, setWerte] = useState<MetaWerte | null>(null)
  const [form, setForm] = useState<FormWerte | null>(null)
  const [fehler, setFehler] = useState<string | null>(null)
  const [speichert, setSpeichert] = useState(false)
  const [entwurf, setEntwurf] = useState('')
  const erstes = useRef<HTMLInputElement>(null)
  /** Stand der Datei im Index und der, aus dem das Formular gelesen hat */
  const fassung = `${bild.size}:${bild.mtime}`
  const fassungRef = useRef(fassung)
  fassungRef.current = fassung
  const [gelesen, setGelesen] = useState<string | null>(null)
  const [ladung, setLadung] = useState(0)

  useEffect(() => {
    let vorbei = false
    const f = fassungRef.current
    api.meta.read(bild.id).then(
      (r) => {
        if (vorbei) return
        if ('grund' in r) setFehler(r.grund)
        else {
          setWerte(r.werte)
          setForm(formAus(r.werte))
          setEntwurf('')
          setGelesen(f)
          setFehler(null)
        }
      },
      (err) => vorbei || setFehler(errorText(err))
    )
    return () => {
      vorbei = true
    }
  }, [bild.id, ladung])

  const mitEntwurf = useMemo(() => {
    const t = entwurf.trim()
    if (!form || !t || form.stichwoerter.some((w) => w.toLowerCase() === t.toLowerCase())) {
      return form
    }
    return { ...form, stichwoerter: [...form.stichwoerter, t] }
  }, [form, entwurf])
  const aenderung = werte && mitEntwurf ? aenderungAus(werte, mitEntwurf) : {}
  const ungueltig = typeof aenderung === 'string' ? aenderung : null
  const geaendert = typeof aenderung === 'string' || Object.keys(aenderung).length > 0

  // Die Datei hat sich von außen geändert: ohne Eingaben einfach neu lesen, sonst fragen – nie
  // still über Getipptes oder eine fremde Fassung hinweg
  const konflikt = gelesen !== null && gelesen !== fassung
  useEffect(() => {
    if (konflikt && !geaendert) setLadung((n) => n + 1)
  }, [konflikt, geaendert])

  useEffect(() => {
    onGeaendert(geaendert)
  }, [geaendert, onGeaendert])
  useEffect(() => () => onGeaendert(false), [onGeaendert])
  useEffect(() => {
    if (form) erstes.current?.focus()
    // nur beim ersten Erscheinen des Formulars, nicht bei jeder Eingabe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!form])

  const setze = <K extends keyof FormWerte>(k: K, v: FormWerte[K]): void =>
    setForm((f) => f && { ...f, [k]: v })

  async function speichern(): Promise<void> {
    if (typeof aenderung === 'string' || !geaendert || speichert || konflikt) return
    setSpeichert(true)
    setFehler(null)
    try {
      const r = await api.meta.write([bild.id], aenderung)
      if (r.fehler.length) setFehler(r.fehler[0].grund)
      else onGespeichert(r)
    } catch (err) {
      setFehler(errorText(err))
    } finally {
      setSpeichert(false)
    }
  }

  const feld = (
    titel: string,
    k: 'ort' | 'region' | 'land' | 'ortsteil' | 'urheber' | 'copyright',
    max: number
  ): JSX.Element => (
    <Feld titel={titel}>
      <input
        value={form?.[k] ?? ''}
        maxLength={max}
        onChange={(e) => setze(k, e.target.value)}
        className={FELD}
      />
    </Feld>
  )

  return (
    <aside
      aria-label="Metadaten bearbeiten"
      className="flex w-80 shrink-0 flex-col border-l bg-leiste"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !geaendert) {
          e.stopPropagation()
          onAbbrechen()
        }
      }}
    >
      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
        <h3 className="break-words text-sm font-semibold">{bild.name} bearbeiten</h3>
        {!form && !fehler && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            Liest die Datei …
          </p>
        )}
        {form && (
          <>
            <Feld titel="Titel">
              <input
                ref={erstes}
                value={form.titel}
                maxLength={TITEL_MAX}
                onChange={(e) => setze('titel', e.target.value)}
                className={FELD}
              />
            </Feld>
            <Feld titel="Beschreibung">
              <textarea
                rows={3}
                value={form.beschreibung}
                maxLength={BESCHREIBUNG_MAX}
                onChange={(e) => setze('beschreibung', e.target.value)}
                className={cn(FELD, 'resize-y')}
              />
            </Feld>
            <Stichwoerter
              werte={form.stichwoerter}
              onChange={(l) => setze('stichwoerter', l)}
              entwurf={entwurf}
              onEntwurf={setEntwurf}
            />
            <div className="space-y-0.5">
              <span className="text-xs text-muted-foreground">Bewertung</span>
              <Sterne wert={form.bewertung} onChange={(n) => setze('bewertung', n)} />
            </div>
            <Feld titel="Farblabel">
              <select
                value={form.farblabel}
                onChange={(e) => setze('farblabel', e.target.value)}
                className={FELD}
              >
                <option value="">Keins</option>
                {[...new Set([...FARBLABELS, ...(form.farblabel ? [form.farblabel] : [])])].map(
                  (l) => (
                    <option key={l} value={l}>
                      {farblabelText(l)}
                    </option>
                  )
                )}
              </select>
            </Feld>
            <Feld titel="Aufnahme">
              <input
                type="datetime-local"
                step={1}
                value={form.aufnahme}
                onChange={(e) => setze('aufnahme', e.target.value)}
                className={FELD}
              />
            </Feld>
            <Feld titel="Standort (Breite, Länge)">
              <input
                value={form.standort}
                placeholder="z. B. 42.65, 18.09"
                onChange={(e) => setze('standort', e.target.value)}
                className={FELD}
              />
            </Feld>
            {form.standort && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2"
                onClick={() => setze('standort', '')}
              >
                Standort entfernen
              </Button>
            )}
            {feld('Ort', 'ort', ORT_MAX)}
            {feld('Bundesland, Region', 'region', ORT_MAX)}
            {feld('Land', 'land', ORT_MAX)}
            {feld('Ortsteil, Stelle', 'ortsteil', ORT_MAX)}
            {feld('Urheber', 'urheber', URHEBER_MAX)}
            {feld('Copyright', 'copyright', COPYRIGHT_MAX)}
          </>
        )}
      </div>
      <div className="shrink-0 space-y-2 border-t p-3">
        {(fehler || ungueltig) && (
          <p role="alert" className="text-xs text-danger">
            {fehler ?? ungueltig}
          </p>
        )}
        {konflikt && geaendert && (
          <div role="alert" className="space-y-1.5 text-xs text-warning">
            <p>Die Datei wurde inzwischen von außen geändert.</p>
            <div className="flex flex-wrap gap-1">
              <Button
                variant="outline"
                size="sm"
                className="h-6 px-2"
                onClick={() => setLadung((n) => n + 1)}
              >
                Neu laden
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2"
                onClick={() => setGelesen(fassung)}
              >
                Eingaben behalten
              </Button>
            </div>
          </div>
        )}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            disabled={!form || !geaendert || !!ungueltig || speichert || konflikt}
            onClick={() => void speichern()}
          >
            {speichert && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            In die Datei schreiben
          </Button>
          <Button variant="ghost" size="sm" onClick={onAbbrechen}>
            Abbrechen
          </Button>
        </div>
      </div>
    </aside>
  )
}
