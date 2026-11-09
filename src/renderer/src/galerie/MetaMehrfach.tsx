// Ansicht „Metadaten bearbeiten“ (Phase 3.3; Entwurf „Metadaten bearbeiten“, entschieden 9.11.2026):
// viele Bilder auf einmal. Links die gewählten Bilder – fest, solange die Ansicht offen ist – mit dem
// Ergebnis je Datei; rechts die Felder mit ‹verschieden› (leer lassen behält die Werte), Stichwörter
// als Chips (gestrichelt mit n/N = nur in einem Teil). Gelesen wird frisch aus den Dateien
// (`meta.readMany`), geschrieben je Datei nur, was sich dort ändert (`meta.writeMany`; Rechnung in
// `lib/mehrfachFormular.ts`). Fortschritt und Bericht kommen vom main; „Rückgängig“ nimmt den ganzen
// Auftrag in einem Schritt zurück. Texte aus den Metadaten nur als Text, nie als HTML.
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  ShieldCheck,
  Star,
  X
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode
} from 'react'
import { Button } from '@renderer/components/ui/button'
import { api } from '@renderer/lib/api'
import { bilderText, datumText, zahl } from '@renderer/lib/format'
import { auftragAnhalten, auftragStarten, useAuftrag } from '@renderer/lib/metaAuftrag'
import {
  aenderungAus,
  chipsAus,
  feldZuruecksetzen,
  formAus,
  geaenderteFelder,
  stichwortDazu,
  stichwortWeg,
  type Feld,
  type MehrfachForm
} from '@renderer/lib/mehrfachFormular'
import { cn } from '@renderer/lib/utils'
import { farblabelText } from '@shared/bildFilter'
import {
  BESCHREIBUNG_MAX,
  COPYRIGHT_MAX,
  FARBLABELS,
  ORT_MAX,
  TITEL_MAX,
  URHEBER_MAX,
  type Farblabel
} from '@shared/metaFields'
import type {
  AuftragArt,
  AuftragStart,
  DateiErgebnis,
  MehrfachAenderung,
  MehrfachWerte,
  TextFeld
} from '@shared/metaMehrfach'
import type { ImageInfo } from '@shared/types'
import { Vorschaubild } from './Vorschaubild'

const FELD =
  'w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70'

const TITEL: Record<TextFeld, string> = {
  titel: 'Titel',
  beschreibung: 'Beschreibung',
  ort: 'Ort',
  region: 'Bundesland, Region',
  land: 'Land',
  ortsteil: 'Ortsteil, Stelle',
  urheber: 'Urheber',
  copyright: 'Copyright'
}
const MAX: Record<TextFeld, number> = {
  titel: TITEL_MAX,
  beschreibung: BESCHREIBUNG_MAX,
  ort: ORT_MAX,
  region: ORT_MAX,
  land: ORT_MAX,
  ortsteil: ORT_MAX,
  urheber: URHEBER_MAX,
  copyright: COPYRIGHT_MAX
}
/** „leer lassen behält die …“ */
const MEHRZAHL: Record<TextFeld, string> = {
  titel: 'Titel',
  beschreibung: 'Beschreibungen',
  ort: 'Orte',
  region: 'Regionen',
  land: 'Länder',
  ortsteil: 'Ortsteile',
  urheber: 'Urheber',
  copyright: 'Angaben'
}
const LABEL_FARBE: Record<Farblabel, string> = {
  Red: 'bg-label-red',
  Yellow: 'bg-label-yellow',
  Green: 'bg-label-green',
  Blue: 'bg-label-blue',
  Purple: 'bg-label-purple'
}
/** Höhe einer Zeile in der Liste links (Karte und Abstand; der Status darf zwei Zeilen haben) */
const KARTE = 100

const dateienText = (n: number): string => `${zahl.format(n)} ${n === 1 ? 'Datei' : 'Dateien'}`
const sterneText = (n: number): string => (n === 1 ? '1 Stern' : `${n} Sterne`)

/** Ergebnis eines Schreib- oder Rückgängig-Auftrags samt „erneut versuchen“ */
interface Bericht {
  art: Exclude<AuftragArt, 'lesen'>
  dateien: ReadonlyMap<number, DateiErgebnis>
  journal: number[]
  abgebrochen: boolean
  /** so viele Dateien sollten bearbeitet werden */
  gesamt: number
}

type Ton = 'ok' | 'warnung' | 'fehler' | 'leise'
const TON: Record<Ton, string> = {
  ok: 'text-success',
  warnung: 'text-warning',
  fehler: 'text-danger',
  leise: 'text-muted-foreground'
}

/** Was unter einer Datei steht */
function statusText(
  d: DateiErgebnis | undefined,
  art: AuftragArt
): { text: string; ton: Ton } | null {
  if (!d || d.status === 'gelesen') return null
  if (d.status === 'geschrieben') {
    if (art === 'rueckgaengig') return { text: 'Zurückgenommen · geprüft', ton: 'ok' }
    const s =
      d.sicherung === 'neu'
        ? 'Sicherung angelegt'
        : d.sicherung === 'keine'
          ? 'ohne Sicherung (privat)'
          : 'Sicherung vorhanden'
    return { text: `Geschrieben · ${s} · geprüft`, ton: 'ok' }
  }
  if (d.status === 'unveraendert')
    return { text: 'Hatte die Werte schon – nicht geschrieben', ton: 'leise' }
  return {
    text: d.grund ?? 'Nicht geschrieben.',
    ton: d.status === 'fehler' ? 'fehler' : 'warnung'
  }
}

function Geaendert({
  titel,
  onVerwerfen
}: {
  titel: string
  onVerwerfen: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onVerwerfen}
      aria-label={`Änderung an „${titel}“ verwerfen`}
      title="Änderung verwerfen"
      className="inline-flex h-[18px] items-center gap-1 rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      geändert
      <X className="size-3" aria-hidden />
    </button>
  )
}

function Kopf({
  titel,
  htmlFor,
  id,
  geaendert,
  onVerwerfen,
  children
}: {
  titel: string
  htmlFor?: string
  id?: string
  geaendert: boolean
  onVerwerfen: () => void
  children?: ReactNode
}): JSX.Element {
  return (
    <div className="flex min-h-[22px] items-center gap-2">
      {htmlFor ? (
        <label htmlFor={htmlFor} className="text-sm font-semibold">
          {titel}
        </label>
      ) : (
        <span id={id} className="text-sm font-semibold">
          {titel}
        </span>
      )}
      {geaendert && <Geaendert titel={titel} onVerwerfen={onVerwerfen} />}
      {children}
    </div>
  )
}

interface FeldProps {
  werte: MehrfachWerte
  form: MehrfachForm
  aendern: (f: (alt: MehrfachForm) => MehrfachForm) => void
  geaendert: ReadonlySet<Feld>
  verwerfen: (feld: Feld) => void
}

function TextEingabe({
  feld,
  zeilen,
  werte,
  form,
  aendern,
  geaendert,
  verwerfen
}: FeldProps & { feld: TextFeld; zeilen?: boolean }): JSX.Element {
  const id = useId()
  const g = werte[feld]
  const text = form.texte[feld]
  const weg = !g.gleich && !text.trim() && form.entfernen.includes(feld)
  const platzhalter = g.gleich
    ? ''
    : weg
      ? 'wird bei allen entfernt'
      : `‹verschieden› – leer lassen behält die ${MEHRZAHL[feld]}`
  const setzen = (t: string): void => aendern((f) => ({ ...f, texte: { ...f.texte, [feld]: t } }))
  return (
    <div className="space-y-1">
      <Kopf
        titel={TITEL[feld]}
        htmlFor={id}
        geaendert={geaendert.has(feld)}
        onVerwerfen={() => verwerfen(feld)}
      >
        {!g.gleich && !weg && !text.trim() && (
          <button
            type="button"
            aria-label={`${TITEL[feld]} bei allen entfernen`}
            onClick={() => aendern((f) => ({ ...f, entfernen: [...f.entfernen, feld] }))}
            className="ml-auto rounded-sm text-xs text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            Bei allen entfernen
          </button>
        )}
      </Kopf>
      {zeilen ? (
        <textarea
          id={id}
          rows={2}
          value={text}
          maxLength={MAX[feld]}
          placeholder={platzhalter}
          onChange={(e) => setzen(e.target.value)}
          className={cn(FELD, 'resize-y')}
        />
      ) : (
        <input
          id={id}
          value={text}
          maxLength={MAX[feld]}
          placeholder={platzhalter}
          onChange={(e) => setzen(e.target.value)}
          className={FELD}
        />
      )}
    </div>
  )
}

function Stichwoerter({
  werte,
  form,
  aendern,
  geaendert,
  verwerfen,
  entwurf,
  onEntwurf
}: FeldProps & { entwurf: string; onEntwurf: (t: string) => void }): JSX.Element {
  const id = useId()
  const chips = chipsAus(werte, form)
  function uebernehmen(): void {
    if (entwurf.trim()) aendern((f) => stichwortDazu(werte, f, entwurf))
    onEntwurf('')
  }
  function taste(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter' || e.key === ',' || e.key === ';') {
      e.preventDefault()
      uebernehmen()
    }
  }
  const klein =
    'flex size-5 shrink-0 items-center justify-center rounded-full outline-none hover:bg-background/60 focus-visible:ring-2 focus-visible:ring-ring'
  return (
    <section aria-labelledby={id} className="space-y-2">
      <Kopf
        titel="Stichwörter"
        id={id}
        geaendert={geaendert.has('stichwoerter')}
        onVerwerfen={() => verwerfen('stichwoerter')}
      />
      {chips.length > 0 && (
        <ul aria-label="Stichwörter" className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <li
              key={c.wort.toLowerCase()}
              data-anzahl={`${c.anzahl}/${werte.anzahl}`}
              className={cn(
                'inline-flex h-7 max-w-full items-center gap-1 rounded-full border border-border-strong pl-3 pr-1 text-sm',
                c.alle ? 'bg-muted' : 'border-dashed'
              )}
            >
              <span className="truncate">{c.wort}</span>
              {!c.alle && (
                <span className="text-[11px] text-muted-foreground">
                  {c.anzahl}/{werte.anzahl}
                </span>
              )}
              {!c.alle && (
                <button
                  type="button"
                  aria-label={`„${c.wort}“ bei allen hinzufügen`}
                  title="Bei allen hinzufügen"
                  onClick={() => aendern((f) => stichwortDazu(werte, f, c.wort))}
                  className={klein}
                >
                  <Plus className="size-3" aria-hidden />
                </button>
              )}
              <button
                type="button"
                aria-label={`„${c.wort}“ bei allen entfernen`}
                title="Bei allen entfernen"
                onClick={() => aendern((f) => stichwortWeg(werte, f, c.wort))}
                className={klein}
              >
                <X className="size-3" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        aria-label="Stichwort für alle hinzufügen"
        placeholder="Stichwort für alle hinzufügen …"
        maxLength={100}
        value={entwurf}
        onChange={(e) => onEntwurf(e.target.value)}
        onKeyDown={taste}
        onBlur={uebernehmen}
        className={cn(FELD, 'max-w-sm')}
      />
      <p className="text-xs text-muted-foreground">
        Gestrichelt = nur in einem Teil der Bilder. Hinzufügen und Entfernen gelten für alle{' '}
        {zahl.format(werte.anzahl)}, die übrigen Stichwörter bleiben.
      </p>
    </section>
  )
}

function Bewertung({ werte, form, aendern, geaendert, verwerfen }: FeldProps): JSX.Element {
  const id = useId()
  const g = werte.bewertung
  const aktiv = form.bewertung ?? (g.gleich ? g.wert : null)
  const text =
    form.bewertung === 0
      ? 'Bewertung wird bei allen entfernt'
      : form.bewertung !== null
        ? `alle ${sterneText(form.bewertung)}`
        : !g.gleich
          ? '‹verschieden› (0–5 Sterne)'
          : g.wert
            ? `alle ${sterneText(g.wert)}`
            : 'ohne Bewertung'
  return (
    <div className="space-y-1">
      <Kopf
        titel="Bewertung"
        id={id}
        geaendert={geaendert.has('bewertung')}
        onVerwerfen={() => verwerfen('bewertung')}
      />
      <div role="group" aria-labelledby={id} className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            aria-label={`Alle auf ${sterneText(n)}`}
            aria-pressed={aktiv === n}
            title={aktiv === n ? 'Bewertung bei allen entfernen' : undefined}
            onClick={() =>
              aendern((f) => {
                const neu = aktiv === n ? 0 : n
                return { ...f, bewertung: g.gleich && g.wert === neu ? null : neu }
              })
            }
            className="rounded-sm p-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Star
              className={cn(
                'size-5',
                aktiv !== null && n <= aktiv ? 'fill-warning text-warning' : 'text-muted-foreground'
              )}
              aria-hidden
            />
          </button>
        ))}
        <span className="ml-2 text-sm text-muted-foreground">{text}</span>
      </div>
    </div>
  )
}

function Farblabels({ werte, form, aendern, geaendert, verwerfen }: FeldProps): JSX.Element {
  const id = useId()
  const g = werte.farblabel
  const aktiv = form.farblabel !== undefined ? form.farblabel : g.gleich ? g.wert : undefined
  const text =
    form.farblabel === null
      ? 'wird bei allen entfernt'
      : aktiv === undefined
        ? '‹verschieden›'
        : aktiv === null
          ? 'kein Farblabel'
          : farblabelText(aktiv)
  const knoepfe: [Farblabel | null, string][] = [
    [null, 'Kein Farblabel'],
    ...FARBLABELS.map((l): [Farblabel, string] => [l, farblabelText(l)])
  ]
  return (
    <div className="space-y-1">
      <Kopf
        titel="Farblabel"
        id={id}
        geaendert={geaendert.has('farblabel')}
        onVerwerfen={() => verwerfen('farblabel')}
      />
      <div role="group" aria-labelledby={id} className="flex h-9 items-center gap-2">
        {knoepfe.map(([l, name]) => (
          <button
            key={name}
            type="button"
            aria-label={name}
            title={name}
            aria-pressed={aktiv === l}
            onClick={() =>
              aendern((f) => ({ ...f, farblabel: g.gleich && g.wert === l ? undefined : l }))
            }
            className={cn(
              'size-6 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              l ? LABEL_FARBE[l] : 'border-2 border-dashed border-muted-foreground',
              aktiv === l && 'ring-2 ring-primary-line ring-offset-2 ring-offset-background'
            )}
          />
        ))}
        <span className="text-sm text-muted-foreground">{text}</span>
      </div>
    </div>
  )
}

function Aufnahme({ werte, form, aendern, geaendert, verwerfen }: FeldProps): JSX.Element {
  const id = useId()
  const a = werte.aufnahme
  const text = a.gleich
    ? a.wert
      ? datumText(a.wert)
      : 'ohne Datum'
    : `‹verschieden› · ${a.von ? datumText(a.von) : '?'} – ${a.bis ? datumText(a.bis) : '?'}` +
      (a.ohne ? ` · ${zahl.format(a.ohne)} ohne Datum` : '')
  return (
    <div className="space-y-1.5 rounded-lg border bg-leiste p-3">
      <Kopf
        titel="Aufnahmedatum"
        htmlFor={id}
        geaendert={geaendert.has('aufnahme')}
        onVerwerfen={() => verwerfen('aufnahme')}
      />
      <p className="text-sm text-foreground-2">{text}</p>
      <input
        id={id}
        type="datetime-local"
        step={1}
        value={form.aufnahme}
        onChange={(e) => aendern((f) => ({ ...f, aufnahme: e.target.value }))}
        className={FELD}
      />
      <p className="text-xs text-muted-foreground">
        {a.gleich
          ? 'Eine neue Zeit gilt für alle, die Zeitzone bleibt je Datei.'
          : 'Leer lassen behält die Zeiten. Eine Zeit hier gilt für alle.'}
      </p>
    </div>
  )
}

function StandortFeld({ werte, form, aendern, geaendert, verwerfen }: FeldProps): JSX.Element {
  const id = useId()
  const s = werte.standort
  return (
    <div className="space-y-1.5 rounded-lg border bg-leiste p-3">
      <Kopf
        titel="Standort (Breite, Länge)"
        htmlFor={form.standortWeg ? undefined : id}
        id={form.standortWeg ? id : undefined}
        geaendert={geaendert.has('standort')}
        onVerwerfen={() => verwerfen('standort')}
      />
      <p className="text-sm text-foreground-2">
        {form.standortWeg
          ? 'Standort wird bei allen entfernt (alle GPS-Felder)'
          : `${zahl.format(s.mit)} von ${zahl.format(werte.anzahl)} mit Standort` +
            (s.gleich && s.wert ? ' · überall derselbe' : '')}
      </p>
      {!form.standortWeg && (
        <input
          id={id}
          value={form.standort}
          placeholder={
            s.gleich ? 'z. B. 42.65, 18.09' : '‹verschieden› – leer lassen behält die Standorte'
          }
          onChange={(e) => aendern((f) => ({ ...f, standort: e.target.value }))}
          className={FELD}
        />
      )}
      {form.standortWeg ? (
        <Button
          variant="outline"
          size="sm"
          className="h-7"
          onClick={() => aendern((f) => ({ ...f, standortWeg: false }))}
        >
          Standort behalten
        </Button>
      ) : (
        s.mit > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="h-7"
            onClick={() => aendern((f) => ({ ...f, standortWeg: true }))}
          >
            Standort entfernen
          </Button>
        )
      )}
    </div>
  )
}

function BerichtKasten({
  b,
  gesperrt,
  onNochmal,
  onRueckgaengig
}: {
  b: Bericht
  gesperrt: boolean
  onNochmal: () => void
  onRueckgaengig: () => void
}): JSX.Element {
  const liste = [...b.dateien.values()]
  const mit = (s: DateiErgebnis['status']): DateiErgebnis[] => liste.filter((d) => d.status === s)
  const geschrieben = mit('geschrieben').length
  const gleich = mit('unveraendert').length
  const konflikte = mit('konflikt')
  const nicht = [...mit('abgelehnt'), ...mit('fehler')]
  const rueck = b.art === 'rueckgaengig'
  const probleme = konflikte.length + nicht.length > 0 || b.abgebrochen
  const namen = (l: DateiErgebnis[]): string =>
    l.length <= 3
      ? `${l.map((d) => d.name ?? 'Eine Datei').join(', ')} ${l.length === 1 ? 'wurde' : 'wurden'}`
      : `${zahl.format(l.length)} Dateien wurden`
  return (
    <div
      role="status"
      className={cn(
        'space-y-2 rounded-lg border p-3 text-sm',
        probleme ? 'border-warning bg-warning/10' : 'border-success bg-success/10'
      )}
    >
      <p className="flex items-center gap-2 font-semibold">
        <Check className="size-4 text-success" aria-hidden />
        {!geschrieben
          ? rueck
            ? 'Nichts zurückgenommen'
            : 'Nichts geschrieben'
          : rueck
            ? `Rückgängig gemacht: ${dateienText(geschrieben)}`
            : `${dateienText(geschrieben)} geschrieben und geprüft`}
      </p>
      {b.abgebrochen && (
        <p>
          Abgebrochen – {zahl.format(liste.length)} von {zahl.format(b.gesamt)} bearbeitet, die
          übrigen sind unverändert.
        </p>
      )}
      {gleich > 0 && (
        <p className="text-muted-foreground">
          {gleich === 1 ? '1 Datei hatte' : `${zahl.format(gleich)} Dateien hatten`} die Werte
          schon.
        </p>
      )}
      {konflikte.length > 0 && (
        <p className="flex items-start gap-2 text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {rueck
            ? `${namen(konflikte)} seither geändert – nicht zurückgenommen.`
            : `${namen(konflikte)} inzwischen von einem anderen Programm geändert – nicht überschrieben.`}
        </p>
      )}
      {nicht.length > 0 && (
        <p className="flex items-start gap-2 text-danger">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {nicht.length === 1 ? '1 Datei' : `${zahl.format(nicht.length)} Dateien`} nicht{' '}
          {rueck ? 'zurückgenommen' : 'geschrieben'} – die Gründe stehen links.
        </p>
      )}
      {!rueck && (konflikte.length > 0 || b.journal.length > 0) && (
        <div className="flex flex-wrap gap-2">
          {konflikte.length > 0 && (
            <Button variant="outline" size="sm" disabled={gesperrt} onClick={onNochmal}>
              Neu lesen und erneut versuchen
            </Button>
          )}
          {b.journal.length > 0 && (
            <Button variant="outline" size="sm" disabled={gesperrt} onClick={onRueckgaengig}>
              <RotateCcw className="size-3.5" aria-hidden />
              Rückgängig
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

function Bildliste({
  ids,
  details,
  status
}: {
  ids: readonly number[]
  details: {
    get: (id: number) => ImageInfo | undefined
    anfordern: (ids: readonly number[]) => void
  }
  status: (id: number) => { text: string; ton: Ton } | null
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const virt = useVirtualizer({
    count: ids.length,
    getScrollElement: () => ref.current,
    estimateSize: () => KARTE,
    overscan: 6
  })
  const items = virt.getVirtualItems()
  const von = items[0]?.index ?? 0
  const bis = (items.at(-1)?.index ?? -1) + 1
  useEffect(() => {
    details.anfordern(ids.slice(von, bis))
  }, [ids, von, bis, details])
  return (
    <div ref={ref} className="min-h-0 flex-1 overflow-auto px-3 pt-3">
      <ul
        aria-label="Ausgewählte Bilder"
        className="relative w-full"
        style={{ height: virt.getTotalSize() }}
      >
        {items.map((it) => {
          const id = ids[it.index]
          const b = details.get(id)
          const st = status(id)
          const info = b
            ? `${datumText(b.takenAt)}${b.takenSource.startsWith('datei-') ? ' (Datei)' : ''} · ${
                b.rating ? '★'.repeat(b.rating) : 'ohne Bewertung'
              }`
            : ''
          return (
            <li
              key={id}
              data-id={id}
              className="absolute inset-x-0 flex items-center gap-3 rounded-lg border bg-card p-2"
              style={{ top: it.start, height: KARTE - 8 }}
            >
              <Vorschaubild
                key={b?.mtime}
                bild={b}
                passend="cover"
                groesse={72}
                hoehe={54}
                className="shrink-0 rounded-md"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold" title={b?.name}>
                  {b?.name ?? ' '}
                </p>
                <p className="truncate text-xs text-muted-foreground">{info}</p>
                {st && (
                  <p
                    className={cn('line-clamp-2 text-xs leading-snug', TON[st.ton])}
                    title={st.text}
                  >
                    {st.text}
                  </p>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function MetaMehrfach({
  ids,
  details,
  onSchliessen
}: {
  /** die gewählten Bilder beim Öffnen, in der Reihenfolge der Galerie – bleiben fest */
  ids: number[]
  details: {
    get: (id: number) => ImageInfo | undefined
    anfordern: (ids: readonly number[]) => void
  }
  onSchliessen: () => void
}): JSX.Element {
  const [werte, setWerte] = useState<MehrfachWerte | null>(null)
  const [form, setForm] = useState<MehrfachForm | null>(null)
  const [entwurf, setEntwurf] = useState('')
  /** Dateien, die nicht in die Werte einflossen (Grund aus dem Lesen) */
  const [nicht, setNicht] = useState<ReadonlyMap<number, DateiErgebnis>>(new Map())
  const [bericht, setBericht] = useState<Bericht | null>(null)
  const [hinweis, setHinweis] = useState<string | null>(null)
  const [ladung, setLadung] = useState(0)
  /** das letzte Lesen brachte keine Werte (Auftrag ging nicht, abgebrochen) */
  const [lesefehler, setLesefehler] = useState(false)
  const auftrag = useAuftrag()
  /** diese Ansicht als Inhaberin ihrer Aufträge – das Ende einer früher geöffneten gehört nicht ihr */
  const ich = useRef({})
  const meiner = auftrag?.inhaber === ich.current ? auftrag : null
  const laeuft = meiner !== null && meiner.ende === null
  const wurzel = useRef<HTMLDivElement>(null)
  const erstesFeld = useRef<HTMLDivElement>(null)
  /** die zuletzt geschriebene Änderung (für „erneut versuchen“) */
  const letzte = useRef<{ aenderung: MehrfachAenderung; ids: number[] } | null>(null)
  /** läuft gerade „erneut versuchen“: sein Ergebnis kommt zum vorigen Bericht dazu */
  const nochmalVon = useRef<Bericht | null>(null)

  // frisch lesen – beim Öffnen und nach jedem Auftrag (StrictMode ruft Effekte doppelt auf)
  const gestartet = useRef(-1)
  useEffect(() => {
    if (gestartet.current === ladung) return
    gestartet.current = ladung
    setLesefehler(false)
    void auftragStarten(
      'ansicht',
      'lesen',
      ids.length,
      'Liest',
      () => api.meta.readMany(ids),
      ich.current
    ).then((r) => {
      if (!('grund' in r)) return
      setHinweis(r.grund)
      setLesefehler(true)
    })
  }, [ids, ladung])

  // Ansicht zu: ein laufendes Lesen anhalten (erst nach dem probeweisen Abbau von StrictMode)
  const offen = useRef(true)
  useEffect(() => {
    offen.current = true
    wurzel.current?.focus()
    const inhaber = ich.current
    return () => {
      offen.current = false
      setTimeout(() => {
        if (!offen.current) auftragAnhalten({ inhaber, art: 'lesen' })
      }, 0)
    }
  }, [])

  // Ende eines Auftrags übernehmen (je Auftrag einmal)
  const erledigt = useRef<number | null>(null)
  useEffect(() => {
    if (!meiner?.ende || meiner.auftrag === null || erledigt.current === meiner.auftrag) return
    erledigt.current = meiner.auftrag
    const e = meiner.ende
    if (meiner.art === 'lesen') {
      if (!e.werte || e.abgebrochen) {
        setLesefehler(true)
        return
      }
      setWerte(e.werte)
      setForm(formAus(e.werte))
      setEntwurf('')
      setNicht(new Map(e.dateien.map((d) => [d.id, d])))
      return
    }
    const neu = new Map(e.dateien.map((d) => [d.id, d]))
    const vorher = nochmalVon.current
    nochmalVon.current = null
    setBericht({
      art: meiner.art,
      dateien: vorher ? new Map([...vorher.dateien, ...neu]) : neu,
      journal: vorher ? [...vorher.journal, ...e.journal] : e.journal,
      abgebrochen: e.abgebrochen,
      gesamt: vorher ? vorher.gesamt : meiner.gesamt
    })
    // die Werte haben sich geändert: neu lesen (das Formular zeigt danach den neuen Stand)
    setLadung((n) => n + 1)
  }, [meiner])

  // das erste Feld, sobald das Formular erscheint
  useEffect(() => {
    if (form) erstesFeld.current?.querySelector<HTMLElement>('input, textarea')?.focus()
    // nur beim ersten Erscheinen, nicht bei jeder Eingabe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!form])

  const mitEntwurf = useMemo(
    () => (form && werte && entwurf.trim() ? stichwortDazu(werte, form, entwurf) : form),
    [form, werte, entwurf]
  )
  const aenderung = werte && mitEntwurf ? aenderungAus(werte, mitEntwurf) : {}
  const ungueltig = typeof aenderung === 'string' ? aenderung : null
  const felder = typeof aenderung === 'string' ? new Set<Feld>() : geaenderteFelder(aenderung)
  const anzahl = felder.size
  /** Was geschrieben wird: die Dateien, die in die Werte einflossen */
  const schreibIds = useMemo(() => ids.filter((id) => !nicht.has(id)), [ids, nicht])

  const aendern = useCallback((f: (alt: MehrfachForm) => MehrfachForm) => {
    setForm((alt) => (alt ? f(alt) : alt))
    setBericht(null)
    setHinweis(null)
  }, [])
  const verwerfen = useCallback(
    (feld: Feld) => {
      if (!werte) return
      if (feld === 'stichwoerter') setEntwurf('')
      setForm((alt) => (alt ? feldZuruecksetzen(werte, alt, feld) : alt))
    },
    [werte]
  )

  async function starten(
    art: Exclude<AuftragArt, 'lesen'>,
    n: number,
    start: () => Promise<AuftragStart>
  ): Promise<boolean> {
    setHinweis(null)
    const r = await auftragStarten(
      'ansicht',
      art,
      n,
      art === 'schreiben' ? 'Schreibt' : 'Nimmt zurück',
      start,
      ich.current
    )
    if ('grund' in r) setHinweis(r.grund)
    return 'auftrag' in r
  }

  async function schreiben(): Promise<void> {
    if (typeof aenderung === 'string' || !anzahl || laeuft || !schreibIds.length) return
    const a = aenderung
    const ziel = schreibIds
    nochmalVon.current = null
    // vor dem Start: Ein kurzer Auftrag kann schon zu Ende sein, wenn die Antwort ankommt
    const vorher = letzte.current
    letzte.current = { aenderung: a, ids: ziel }
    if (!(await starten('schreiben', ziel.length, () => api.meta.writeMany(ziel, a)))) {
      letzte.current = vorher
    }
  }

  async function nochmal(): Promise<void> {
    const b = bericht
    const l = letzte.current
    if (!b || !l || laeuft) return
    const konflikte = [...b.dateien.values()]
      .filter((d) => d.status === 'konflikt')
      .map((d) => d.id)
    if (!konflikte.length) return
    nochmalVon.current = b
    const ok = await starten('schreiben', konflikte.length, () =>
      api.meta.writeMany(konflikte, l.aenderung, { nochmal: true })
    )
    if (!ok) nochmalVon.current = null
  }

  async function rueckgaengig(): Promise<void> {
    const b = bericht
    if (!b?.journal.length || laeuft) return
    nochmalVon.current = null
    await starten('rueckgaengig', b.journal.length, () => api.meta.undoMany(b.journal))
  }

  /** Schließen nur ohne laufenden Auftrag und ohne Ungeschriebenes (Abbrechen verwirft) */
  function zurueck(verwerfen: boolean): void {
    if (laeuft) {
      setHinweis('Bitte warten, bis der Auftrag fertig ist, oder ihn abbrechen.')
      return
    }
    if ((anzahl || entwurf.trim()) && !verwerfen) {
      setHinweis('Bitte erst schreiben oder abbrechen.')
      return
    }
    onSchliessen()
  }

  const status = useCallback(
    (id: number) => {
      if (meiner && meiner.art !== 'lesen') {
        const d = meiner.dateien.get(id)
        if (d) return statusText(d, meiner.art)
      }
      const d = bericht?.dateien.get(id)
      if (d && bericht) return statusText(d, bericht.art)
      if (bericht?.abgebrochen && letzte.current?.ids.includes(id)) {
        return { text: 'Nicht bearbeitet – abgebrochen', ton: 'leise' as const }
      }
      return statusText(nicht.get(id), 'lesen')
    },
    [meiner, bericht, nicht]
  )

  const props: FeldProps | null =
    werte && form ? { werte, form, aendern, geaendert: felder, verwerfen } : null
  const nichtBeschreibbar = nicht.size
  const laufText =
    meiner?.art === 'lesen'
      ? 'Liest die Dateien …'
      : meiner?.art === 'rueckgaengig'
        ? 'Nimmt zurück …'
        : 'Schreibt …'
  const anteil = meiner && meiner.gesamt ? Math.round((meiner.fertig / meiner.gesamt) * 100) : 0

  return (
    <div
      ref={wurzel}
      role="dialog"
      aria-modal="true"
      aria-label="Metadaten bearbeiten"
      tabIndex={-1}
      className="fixed inset-0 z-40 flex flex-col bg-background outline-none"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          zurueck(false)
        }
      }}
    >
      <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b bg-leiste px-2 py-1.5">
        <button
          type="button"
          onClick={() => zurueck(false)}
          aria-label="Zurück zur Galerie"
          className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Galerie
        </button>
        <span className="h-5 w-px bg-border" aria-hidden />
        <h2 className="text-sm font-semibold">Metadaten bearbeiten</h2>
        <span className="text-xs text-muted-foreground">
          {bilderText(ids.length)} ausgewählt
          {nichtBeschreibbar > 0 &&
            ` · ${zahl.format(nichtBeschreibbar)} ${nichtBeschreibbar === 1 ? 'lässt' : 'lassen'} sich nicht beschreiben`}
        </span>
        {/* ließ sich eine Datei nicht lesen, weil sie sich änderte: neu lesen (nur ohne Eingaben) */}
        {[...nicht.values()].some((d) => d.status === 'konflikt' || d.status === 'fehler') &&
          !laeuft &&
          !anzahl &&
          !entwurf.trim() && (
            <button
              type="button"
              onClick={() => setLadung((n) => n + 1)}
              className="rounded-sm text-xs text-primary-line underline outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Neu lesen
            </button>
          )}
      </div>
      {hinweis && (
        <p role="alert" className="border-b bg-warning/10 px-4 py-1.5 text-xs text-warning">
          {hinweis}
        </p>
      )}
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-80 shrink-0 flex-col border-r bg-leiste">
          <Bildliste ids={ids} details={details} status={status} />
          <div className="m-3 space-y-1 rounded-lg border p-3 text-xs">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck className="size-4 text-success" aria-hidden />
              So wird geschrieben
            </p>
            <ul className="space-y-0.5 text-muted-foreground">
              <li>Nur geänderte Felder – je Datei nur, was dort anders ist.</li>
              <li>
                Vorher eine Sicherung jeder Datei (im Ordner „privat“ keine), danach Nachlesen und
                Vergleichen.
              </li>
              <li>Pixeldaten bleiben unverändert.</li>
              <li>„Rückgängig“ nimmt den ganzen Auftrag zurück.</li>
            </ul>
          </div>
        </aside>
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-auto">
            <div className="mx-auto max-w-3xl space-y-5 p-6">
              {bericht && (
                <BerichtKasten
                  b={bericht}
                  gesperrt={laeuft}
                  onNochmal={() => void nochmal()}
                  onRueckgaengig={() => void rueckgaengig()}
                />
              )}
              {!props && !lesefehler && (
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  Liest die Dateien …
                </p>
              )}
              {!props && lesefehler && !laeuft && (
                <div className="space-y-2 text-sm text-muted-foreground">
                  <p>Die Dateien ließen sich nicht lesen.</p>
                  <Button variant="outline" size="sm" onClick={() => setLadung((n) => n + 1)}>
                    Neu lesen
                  </Button>
                </div>
              )}
              {props && werte?.anzahl === 0 && (
                <p className="text-sm text-muted-foreground">
                  Keine der ausgewählten Dateien lässt sich beschreiben – die Gründe stehen links.
                </p>
              )}
              {props && werte && werte.anzahl > 0 && (
                <fieldset
                  disabled={laeuft}
                  className="min-w-0 space-y-5 disabled:opacity-70"
                  aria-label="Felder"
                >
                  <div ref={erstesFeld}>
                    <TextEingabe feld="titel" {...props} />
                  </div>
                  <TextEingabe feld="beschreibung" zeilen {...props} />
                  <Stichwoerter {...props} entwurf={entwurf} onEntwurf={setEntwurf} />
                  <div className="flex flex-wrap gap-x-10 gap-y-4">
                    <Bewertung {...props} />
                    <Farblabels {...props} />
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Aufnahme {...props} />
                    <StandortFeld {...props} />
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <TextEingabe feld="ort" {...props} />
                    <TextEingabe feld="region" {...props} />
                    <TextEingabe feld="land" {...props} />
                    <TextEingabe feld="ortsteil" {...props} />
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <TextEingabe feld="urheber" {...props} />
                    <TextEingabe feld="copyright" {...props} />
                  </div>
                </fieldset>
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-3 border-t px-6 py-3">
            {laeuft ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                <span className="text-sm">
                  {laufText} {zahl.format(meiner?.fertig ?? 0)} von{' '}
                  {zahl.format(meiner?.gesamt ?? 0)}
                </span>
                <span className="h-1.5 w-40 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <span className="block h-full bg-primary" style={{ width: `${anteil}%` }} />
                </span>
                <span className="flex-1" />
                {meiner?.art !== 'lesen' && (
                  <Button variant="outline" size="sm" onClick={() => auftragAnhalten()}>
                    Abbrechen
                  </Button>
                )}
              </>
            ) : (
              <>
                <span
                  className={cn('text-sm', ungueltig ? 'text-danger' : 'text-muted-foreground')}
                >
                  {ungueltig ??
                    (anzahl
                      ? `${anzahl} ${anzahl === 1 ? 'Feld' : 'Felder'} geändert`
                      : 'Noch nichts geändert')}
                </span>
                <span className="flex-1" />
                <Button variant="outline" onClick={() => zurueck(true)}>
                  {anzahl || entwurf.trim() ? 'Abbrechen' : 'Schließen'}
                </Button>
                <Button
                  disabled={!anzahl || !!ungueltig || !schreibIds.length || !werte?.anzahl}
                  onClick={() => void schreiben()}
                >
                  <Save className="size-4" aria-hidden />
                  {anzahl
                    ? `In ${dateienText(schreibIds.length)} schreiben`
                    : 'Nichts zu schreiben'}
                </Button>
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
