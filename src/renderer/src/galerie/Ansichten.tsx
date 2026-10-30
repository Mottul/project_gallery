// Gespeicherte Ansichten (Phase 2.4b; entschieden 30.10.2026): Abschnitt in der Seitenleiste unter
// den Ordnern, gespeichert wird über die Filterleiste. Namen kommen vom Nutzer und erscheinen nur
// als Text; die Rückfrage vor dem Löschen stellt der main.
import { Bookmark, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Button } from '@renderer/components/ui/button'
import { useAnsicht, useKnoten } from '@renderer/lib/ansicht'
import { api } from '@renderer/lib/api'
import { filterChips, useBildFilter } from '@renderer/lib/filter'
import {
  ansichtOeffnen,
  ansichtSpeichern,
  useGespeicherteAnsichten,
  useZuletztGeoeffnet
} from '@renderer/lib/gespeichert'
import { useLibrary } from '@renderer/lib/library'
import { cn, errorText } from '@renderer/lib/utils'
import {
  ANSICHT_NAME_MAX,
  ANSICHTEN_MAX,
  nameSchluessel,
  pruefeAnsichtName,
  standGleich,
  type GespeicherteAnsicht
} from '@shared/gespeicherteAnsicht'
import { AUSWAHL } from './Sortierwahl'

/** Hinweis am Eintrag: wo die Ansicht gilt und was sie filtert. */
function beschreibung(a: GespeicherteAnsicht, ordnerName: string | undefined): string {
  const wo = a.knoten ? ((a.knoten.pfad.split('/').pop() || ordnerName) ?? '') : 'Alle Bilder'
  const was = filterChips(a.filter).map((c) => c.text)
  return [wo, ...was, ...(a.filter.suche ? [`„${a.filter.suche}“`] : [])].join(' · ')
}

export function GespeicherteAnsichten(): JSX.Element {
  const liste = useGespeicherteAnsichten()
  const lib = useLibrary()
  const knoten = useKnoten()
  const ansicht = useAnsicht()
  const filter = useBildFilter()
  const [fehler, setFehler] = useState<string | null>(null)
  const jetzt = { ...ansicht, knoten, filter }
  return (
    <section aria-label="Gespeicherte Ansichten" className="shrink-0 border-t">
      <h2 className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Ansichten
      </h2>
      {fehler && (
        <p role="alert" className="px-3 pb-1 text-xs text-danger">
          {fehler}
        </p>
      )}
      {liste.length === 0 ? (
        <p className="px-3 pb-2 text-xs text-muted-foreground">
          Noch keine – speichern lässt sich eine Ansicht in der Filterleiste.
        </p>
      ) : (
        <ul className="max-h-40 space-y-0.5 overflow-auto px-2 pb-2">
          {liste.map((a) => {
            const gewaehlt = standGleich(a, jetzt)
            const ordner = lib?.folders.find((f) => f.id === a.knoten?.ordner)
            return (
              <li
                key={a.id}
                className={cn(
                  'group flex items-center gap-1 rounded-md pr-1 hover:bg-muted/60',
                  gewaehlt && 'bg-muted'
                )}
              >
                <button
                  type="button"
                  aria-current={gewaehlt ? 'true' : undefined}
                  title={beschreibung(a, ordner?.name)}
                  onClick={() => ansichtOeffnen(a)}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Bookmark className="size-4 shrink-0 text-primary-line" aria-hidden />
                  <span className="truncate">{a.name}</span>
                </button>
                <button
                  type="button"
                  aria-label={`Ansicht „${a.name}“ löschen`}
                  title="Löschen"
                  onClick={() => {
                    setFehler(null)
                    api.library.deleteView(a.id).catch((err) => setFehler(errorText(err)))
                  }}
                  className="flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-0 outline-none hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/** Knopf in der Filterleiste; klappt an Ort und Stelle zum Namensfeld auf. */
export function AnsichtSpeichern(): JSX.Element {
  const liste = useGespeicherteAnsichten()
  const zuletzt = useZuletztGeoeffnet()
  const [offen, setOffen] = useState(false)
  const [name, setName] = useState('')
  const [fehler, setFehler] = useState<string | null>(null)
  const feld = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (offen) feld.current?.select()
  }, [offen])

  const sauber = pruefeAnsichtName(name)
  const vorhanden =
    sauber !== null && liste.some((a) => nameSchluessel(a.name) === nameSchluessel(sauber))

  async function speichern(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (sauber === null) return
    setFehler(null)
    try {
      const r = await ansichtSpeichern(sauber, vorhanden)
      if (r.status === 'gespeichert') setOffen(false)
      else if (r.status === 'voll') setFehler(`Mehr als ${ANSICHTEN_MAX} Ansichten gehen nicht.`)
      else setFehler('Diesen Namen gibt es schon.')
    } catch (err) {
      setFehler(errorText(err))
    }
  }

  if (!offen) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="h-6 gap-1 px-2"
        onClick={() => {
          setName(zuletzt)
          setFehler(null)
          setOffen(true)
        }}
      >
        <Bookmark className="size-3.5" aria-hidden />
        Ansicht speichern
      </Button>
    )
  }
  return (
    <form onSubmit={(e) => void speichern(e)} className="flex items-center gap-1.5">
      <input
        ref={feld}
        aria-label="Name der Ansicht"
        placeholder="Name der Ansicht"
        maxLength={ANSICHT_NAME_MAX}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            setOffen(false)
          }
        }}
        className={cn(AUSWAHL, 'w-44')}
      />
      <Button type="submit" size="sm" className="h-6 px-2" disabled={sauber === null}>
        {vorhanden ? 'Ersetzen' : 'Speichern'}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-6 px-2"
        onClick={() => setOffen(false)}
      >
        Abbrechen
      </Button>
      {vorhanden && <span className="text-xs text-muted-foreground">Gibt es schon</span>}
      {fehler && (
        <span role="alert" className="text-xs text-danger">
          {fehler}
        </span>
      )}
    </form>
  )
}
