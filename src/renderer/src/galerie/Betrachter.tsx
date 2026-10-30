// Betrachter (docs/PLAN.md, „Betrachter“; Entwurf „Betrachter“): Großansicht über bild:// (Kennung,
// nie Pfad) mit dem Vorschaubild als Platzhalter, Anpassen / 100 % / Regler / Mausrad-Zoom am
// Mauszeiger (sanft), Verschieben, Vor/Zurück (Pfeiltasten), Filmstreifen (virtualisiert), Diashow
// mit Intervall, Vollbild (F11), Info, Papierkorb (Entf – Rückfrage im main).
//
// Kein Moment ohne Bild (Rückmeldung zu 1.5: die Diashow „blitzte“): Das gezeigte Bild bleibt
// stehen, bis das nächste geladen und dekodiert ist; erst dann tauschen beide in einem Zug. Die
// Nachbarn werden vorgeladen und dekodiert (Puffer unten) – Chromium nimmt das vorgeladene Bild für
// dieselbe Adresse wieder, trotz no-store (gemessen, e2e/betrachter.mjs). Die Diashow schaltet erst
// weiter, wenn das nächste Bild bereit ist.
//
// Diashow-Effekte (Phase 2.5): Überblenden und Ken Burns als Web-Animationen auf den Ebenen, nur
// solange die Diashow läuft. Das alte Bild bleibt dafür als eigene Ebene (`vorher`) stehen und fährt
// seine Bahn zu Ende. Der gleiche Schlüssel hält dabei dasselbe <img> – samt laufender Animation.
//
// Schnellbewertung (Phase 3.1; entschieden 30.10.2026): Tasten 0–5 und 6–9 schreiben sofort in die
// Datei, „Rückgängig“ (auch Strg+Z) nimmt es zurück. Das Bearbeiten-Panel (3.2, Taste E) liest aus
// der Datei; solange es Ungespeichertes hält, lässt der Betrachter nicht weiterblättern. Drehen
// kommt mit 3.4.
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Info,
  Loader2,
  Maximize,
  Minimize,
  Pause,
  Play,
  Trash2
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent
} from 'react'
import { api } from '@renderer/lib/api'
import {
  diashowAendern,
  DIASHOW_INTERVALLE,
  UEBERBLENDEN_MS,
  useDiashowWahl,
  useWenigBewegung
} from '@renderer/lib/diashow'
import { zahl } from '@renderer/lib/format'
import { cn, errorText } from '@renderer/lib/utils'
import { ZOOM_SCHRITT, begrenzen, radFaktor } from '@renderer/lib/zoom'
import { bildUrl } from '@shared/bild'
import { farblabelText } from '@shared/bildFilter'
import { kenBurnsBahn, kenBurnsFrames, type KenBurnsBahn } from '@shared/kenBurns'
import {
  schreibbar,
  type Farblabel,
  type MetaAenderung,
  type SchreibBericht
} from '@shared/metaFields'
import type { ImageInfo } from '@shared/types'
import { useLibrary } from '@renderer/lib/library'
import { DiashowMenue } from './DiashowMenue'
import { InfoPanel } from './InfoPanel'
import { MetaFormular } from './MetaFormular'
import { Vorschaubild } from './Vorschaubild'
import { Zoomleiste } from './Zoomleiste'

const FILM = 72
/** Rand über und unter den Bildern im Filmstreifen (Platz für den Rahmen des gewählten) */
const FILM_RAND = 8
/** So lange wartet die Diashow höchstens auf das nächste Bild, dann blättert sie trotzdem */
const DIASHOW_WARTEN_MS = 10_000
/** Erst nach dieser Zeit erscheint beim Laden eines Bildes ein Hinweis */
const LADEN_HINWEIS_MS = 300

/** sanft = in die neue Stufe gleiten (nicht beim Verschieben und nicht beim Bildwechsel) */
type Zoom =
  | { art: 'anpassen'; sanft?: boolean }
  | { art: 'frei'; s: number; x: number; y: number; sanft?: boolean }

/** So lange bleibt der Hinweis mit „Rückgängig“ stehen */
const RUECKMELDUNG_MS = 8000
const LABEL_TASTEN = new Map<string, Farblabel>([
  ['6', 'Red'],
  ['7', 'Yellow'],
  ['8', 'Green'],
  ['9', 'Blue']
])

const sterneText = (n: number): string =>
  n === 0 ? 'Bewertung entfernt' : `${n} ${n === 1 ? 'Stern' : 'Sterne'} gespeichert`

/** Das gezeigte Original: geladen und dekodiert */
interface Gezeigt {
  id: number
  mtime: number
  name: string
  w: number
  h: number
}

const schluessel = (b: { id: number; mtime: number }): string => `${b.id}:${b.mtime}`

/** Das <img> eines Bildes auf der Bühne */
const ebene = (buehne: HTMLElement | null, k: string): HTMLImageElement | null =>
  buehne?.querySelector<HTMLImageElement>(`img[data-ebene="${k}"]`) ?? null

/**
 * Vorgeladene, dekodierte Originale der Nachbarn. Das Image-Objekt bleibt hier, solange der
 * Nachbar gebraucht wird – so findet Chromium das Bild für dieselbe Adresse im Speicher.
 */
class Bildpuffer {
  private eintraege = new Map<string, { img: HTMLImageElement; bereit: Promise<boolean> }>()

  /** Lädt und dekodiert die Bilder; alle anderen gibt der Puffer frei. */
  behalten(bilder: readonly ImageInfo[]): void {
    const keys = new Set(bilder.map(schluessel))
    for (const k of this.eintraege.keys()) if (!keys.has(k)) this.eintraege.delete(k)
    for (const b of bilder) this.holen(b)
  }

  /** true, sobald das Bild dekodiert ist; false, wenn es nicht geht (defekt, geändert). */
  bereit(b: ImageInfo): Promise<boolean> {
    return this.holen(b).bereit
  }

  leeren(): void {
    this.eintraege.clear()
  }

  private holen(b: ImageInfo): { img: HTMLImageElement; bereit: Promise<boolean> } {
    const k = schluessel(b)
    let e = this.eintraege.get(k)
    if (!e) {
      const img = new Image()
      img.decoding = 'async'
      img.src = bildUrl(b.id, b.mtime)
      e = {
        img,
        bereit: img.decode().then(
          () => true,
          () => false
        )
      }
      this.eintraege.set(k, e)
    }
    return e
  }
}

function Filmstreifen({
  ids,
  index,
  details,
  onWahl
}: {
  ids: number[]
  index: number
  details: {
    get: (id: number) => ImageInfo | undefined
    anfordern: (ids: readonly number[]) => void
  }
  onWahl: (i: number) => void
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const virt = useVirtualizer({
    horizontal: true,
    count: ids.length,
    getScrollElement: () => ref.current,
    estimateSize: () => FILM + 6,
    overscan: 6
  })
  useEffect(() => {
    virt.scrollToIndex(index, { align: 'center' })
  }, [virt, index])
  const items = virt.getVirtualItems()
  const von = items[0]?.index ?? 0
  const bis = (items.at(-1)?.index ?? -1) + 1
  useEffect(() => {
    details.anfordern(ids.slice(von, bis))
  }, [ids, von, bis, details])
  // Höhe aus dem Inhalt: Der Scrollbalken kommt unten dazu, statt die Bilder anzuschneiden
  return (
    <div
      ref={ref}
      role="listbox"
      aria-label="Filmstreifen"
      className="shrink-0 overflow-x-auto overflow-y-hidden border-t bg-leiste"
    >
      <div
        className="relative"
        style={{ width: virt.getTotalSize(), height: FILM + 2 * FILM_RAND }}
      >
        {items.map((it) => {
          const id = ids[it.index]
          const b = details.get(id)
          const aktuell = it.index === index
          return (
            <button
              key={id}
              type="button"
              role="option"
              aria-selected={aktuell}
              aria-label={b?.name ?? 'Bild'}
              onClick={() => onWahl(it.index)}
              className="absolute rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
              style={{ left: it.start + 3, top: FILM_RAND, width: FILM, height: FILM }}
            >
              <Vorschaubild
                key={b?.mtime}
                bild={b}
                groesse={FILM}
                passend="cover"
                className={cn(
                  'rounded-md',
                  aktuell
                    ? 'ring-[3px] ring-primary-line'
                    : 'opacity-70 transition-opacity hover:opacity-100'
                )}
              />
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function Betrachter({
  ids,
  start,
  details,
  onSchliessen
}: {
  ids: number[]
  start: number
  details: {
    get: (id: number) => ImageInfo | undefined
    anfordern: (ids: readonly number[]) => void
    setzen: (infos: readonly ImageInfo[]) => void
  }
  /** mit der zuletzt gezeigten Kennung (die Galerie wählt sie und scrollt dorthin) */
  onSchliessen: (id: number | null) => void
}): JSX.Element {
  const [index, setIndex] = useState(Math.min(start, ids.length - 1))
  const idRef = useRef<number | null>(ids[start] ?? null)
  const [zoom, setZoom] = useState<Zoom>({ art: 'anpassen' })
  const [gezeigt, setGezeigt] = useState<Gezeigt | null>(null)
  const [buehne, setBuehne] = useState({ w: 0, h: 0 })
  const [fehler, setFehler] = useState(false)
  const [laedtLange, setLaedtLange] = useState(false)
  const [info, setInfo] = useState(false)
  const [diashow, setDiashow] = useState(false)
  const wahl = useDiashowWahl()
  const { intervall } = wahl
  const wenigBewegung = useWenigBewegung()
  /** Das Bild, das gerade ausgeblendet wird; liegt unter dem gezeigten */
  const [vorher, setVorher] = useState<Gezeigt | null>(null)
  const [vollbild, setVollbild] = useState(false)
  const [hinweis, setHinweis] = useState<string | null>(null)
  /** Gerade gespeichert: Text und was „Rückgängig“ zurücknimmt */
  const [rueck, setRueck] = useState<{ text: string; journal: number[] } | null>(null)
  const [bearbeiten, setBearbeiten] = useState(false)
  const bearbeitenRef = useRef(bearbeiten)
  bearbeitenRef.current = bearbeiten
  /** Das Panel hält Ungespeichertes */
  const ungespeichert = useRef(false)
  const lib = useLibrary()
  const wurzel = useRef<HTMLDivElement>(null)
  const buehneRef = useRef<HTMLDivElement>(null)
  const puffer = useRef(new Bildpuffer())
  useEffect(() => {
    const p = puffer.current
    return () => p.leeren()
  }, [])

  const id = ids[index]
  const bild = id === undefined ? undefined : details.get(id)
  /** Das Bild, das gezeigt werden soll; bis es dekodiert ist, bleibt `gezeigt` stehen */
  const ziel = bild ? schluessel(bild) : null
  const zielRef = useRef(ziel)
  zielRef.current = ziel
  const gezeigtRef = useRef(gezeigt)
  gezeigtRef.current = gezeigt
  const ueberblenden = diashow && wahl.uebergang === 'ueberblenden' && !wenigBewegung
  const ueberblendenRef = useRef(ueberblenden)
  ueberblendenRef.current = ueberblenden
  const gk = gezeigt ? schluessel(gezeigt) : null
  const bereit = ziel !== null && ziel === gk

  // Liste geändert (Papierkorb, Abgleich): beim selben Bild bleiben, sonst an derselben Stelle
  useEffect(() => {
    const i = idRef.current === null ? -1 : ids.indexOf(idRef.current)
    if (i >= 0) setIndex(i)
    else if (ids.length) setIndex((alt) => Math.min(alt, ids.length - 1))
    else onSchliessen(null)
  }, [ids, onSchliessen])
  useEffect(() => {
    idRef.current = id ?? null
  }, [id])
  useEffect(() => {
    setFehler(false)
  }, [ziel])

  // Lädt das neue Bild länger, zeigt eine kleine Anzeige (das alte bleibt solange stehen)
  useEffect(() => {
    setLaedtLange(false)
    if (bereit || fehler || ziel === null) return
    const t = setTimeout(() => setLaedtLange(true), LADEN_HINWEIS_MS)
    return () => clearTimeout(t)
  }, [ziel, bereit, fehler])

  /** Das neue Original ist geladen: dekodieren, dann in einem Zug gegen das alte tauschen. */
  const geladen = useCallback(async (img: HTMLImageElement, b: ImageInfo): Promise<void> => {
    await img.decode().catch(() => {})
    if (zielRef.current !== schluessel(b)) return // inzwischen weitergeblättert
    setVorher(ueberblendenRef.current ? gezeigtRef.current : null)
    // dasselbe Bild in neuer Fassung (gerade bewertet): Der Ausschnitt bleibt
    if (gezeigtRef.current?.id !== b.id) setZoom({ art: 'anpassen' })
    setGezeigt({
      id: b.id,
      mtime: b.mtime,
      name: b.name,
      w: img.naturalWidth,
      h: img.naturalHeight
    })
  }, [])

  // Details für das Bild und seine Nachbarn; die Nachbarn (die Diashow auch über das Ende hinaus)
  // vorladen und dekodieren
  useEffect(() => {
    details.anfordern(ids.slice(Math.max(0, index - 2), index + 3))
    const nachbarn = [index + 1 < ids.length ? index + 1 : 0, index - 1]
      .filter((i) => i >= 0 && i !== index)
      .map((i) => details.get(ids[i]))
      .filter((b): b is ImageInfo => b !== undefined)
    puffer.current.behalten(bild ? [bild, ...nachbarn] : nachbarn)
  }, [ids, index, details, bild])

  useEffect(() => {
    const el = buehneRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setBuehne({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /** Ungespeichertes im Panel: nicht weg, sondern sagen, was zu tun ist. */
  const gesperrt = useCallback((): boolean => {
    if (ungespeichert.current) setHinweis('Bitte erst in die Datei schreiben oder abbrechen.')
    return ungespeichert.current
  }, [])
  const schliessen = useCallback(() => {
    if (!gesperrt()) onSchliessen(idRef.current)
  }, [gesperrt, onSchliessen])

  const gehe = useCallback(
    (i: number) => {
      if (!gesperrt()) setIndex(Math.max(0, Math.min(ids.length - 1, i)))
    },
    [ids.length, gesperrt]
  )

  // Diashow: steht das Bild (oder ließ es sich nicht zeigen), nach dem Intervall weiter – aber erst,
  // wenn das nächste dekodiert ist (höchstens DIASHOW_WARTEN_MS); am Ende von vorn. Liste und
  // Details über Refs: Kommen Details nach, soll das nicht den Takt neu starten.
  const listeRef = useRef({ ids, details })
  listeRef.current = { ids, details }
  useEffect(() => {
    if (!diashow || !(bereit || fehler)) return
    let vorbei = false
    const t = setTimeout(() => {
      const { ids, details } = listeRef.current
      const n = index + 1 < ids.length ? index + 1 : 0
      const b = details.get(ids[n])
      const warten = b
        ? Promise.race([puffer.current.bereit(b), schlafen(DIASHOW_WARTEN_MS)])
        : Promise.resolve()
      // nach dem Warten mit der dann gültigen Liste (Papierkorb, Abgleich)
      void warten.then(() => {
        if (!vorbei) setIndex((i) => (i + 1 < listeRef.current.ids.length ? i + 1 : 0))
      })
    }, intervall * 1000)
    return () => {
      vorbei = true
      clearTimeout(t)
    }
  }, [diashow, intervall, bereit, fehler, index])

  useEffect(() => {
    const aendern = (): void => setVollbild(document.fullscreenElement !== null)
    document.addEventListener('fullscreenchange', aendern)
    return () => document.removeEventListener('fullscreenchange', aendern)
  }, [])
  const vollbildUmschalten = useCallback((): void => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void wurzel.current?.requestFullscreen()
  }, [])

  /** Maßstab, mit dem ein Bild ganz auf die Bühne passt */
  const fit = useCallback(
    (g: Gezeigt): number =>
      buehne.w && buehne.h ? Math.min(1, buehne.w / g.w, buehne.h / g.h) : 1,
    [buehne.w, buehne.h]
  )
  const passend = gezeigt ? fit(gezeigt) : 1
  const skala = zoom.art === 'anpassen' ? passend : zoom.s
  const verschoben = zoom.art === 'frei' ? { x: zoom.x, y: zoom.y } : { x: 0, y: 0 }

  // Überblenden: Das neue kommt linear herein; das alte bleibt die erste Hälfte voll stehen, sonst
  // schiene dazwischen die Bühne durch (beide halb durchsichtig), und geht dann, statt am Ende an
  // den Rändern wegzuspringen, wo es über das neue hinausragt.
  useLayoutEffect(() => {
    if (!vorher || !gk) return
    const dauer = { duration: UEBERBLENDEN_MS, easing: 'linear' }
    ebene(buehneRef.current, gk)?.animate([{ opacity: 0 }, { opacity: 1 }], dauer)
    ebene(buehneRef.current, schluessel(vorher))?.animate(
      [
        { opacity: 1, offset: 0 },
        { opacity: 1, offset: 0.5 },
        { opacity: 0, offset: 1 }
      ],
      { ...dauer, fill: 'forwards' }
    )
    const t = setTimeout(() => setVorher(null), UEBERBLENDEN_MS)
    return () => clearTimeout(t)
  }, [vorher, gk])

  // Ken Burns: läuft, bis das Bild ganz ausgeblendet ist, und hält sonst am Ende an. Wer selbst
  // zoomt, hält ihn an – die Bewegung darf nicht gegen den Nutzer arbeiten.
  const kenBurns = diashow && wahl.kenBurns === 'auto' && !wenigBewegung && zoom.art === 'anpassen'
  const kb = useRef<{ key: string; bahn: KenBurnsBahn; anim: Animation } | null>(null)
  const indexRef = useRef(index)
  indexRef.current = index
  useLayoutEffect(() => {
    const el = gk ? ebene(buehneRef.current, gk) : null
    if (!kenBurns || !el || !gezeigt || !gk || !buehne.w || !buehne.h) return
    if (kb.current?.key === gk) {
      // Bühne geändert (Vollbild, Info): dieselbe Bahn im neuen Maßstab, die Zeit läuft weiter
      const wirkung = kb.current.anim.effect as KeyframeEffect
      wirkung.setKeyframes(kenBurnsFrames(kb.current.bahn, gezeigt, passend))
      return
    }
    const bahn = kenBurnsBahn(indexRef.current, wahl.staerke, gezeigt, buehne)
    const anim = el.animate(kenBurnsFrames(bahn, gezeigt, passend), {
      duration: intervall * 1000 + UEBERBLENDEN_MS,
      easing: 'linear',
      fill: 'forwards'
    })
    kb.current = { key: gk, bahn, anim }
  }, [kenBurns, gk, gezeigt, passend, buehne, wahl.staerke, intervall])

  // Angehalten: vom aktuellen Stand sanft zurück in die normale Lage
  useLayoutEffect(() => {
    const k = kb.current
    if (kenBurns || !k) return
    kb.current = null
    const el = ebene(buehneRef.current, k.key)
    const von = el && getComputedStyle(el).transform
    k.anim.cancel()
    if (el && von) {
      const nach = getComputedStyle(el).transform
      el.animate([{ transform: von }, { transform: nach }], { duration: 150, easing: 'ease-out' })
    }
  }, [kenBurns])

  /** Zoomen um den Punkt (px, py) relativ zur Bühnenmitte – er bleibt unter dem Mauszeiger. */
  const zoomen = useCallback(
    (faktor: number, px = 0, py = 0) => {
      const s = begrenzen(skala * faktor, passend)
      const k = s / skala
      setZoom({
        art: 'frei',
        s,
        x: px - (px - verschoben.x) * k,
        y: py - (py - verschoben.y) * k,
        sanft: true
      })
    },
    [passend, skala, verschoben.x, verschoben.y]
  )

  // Mausrad-Zoom (nicht passiv – sonst ließe sich das Scrollen nicht abfangen); stufenlos nach dem
  // Ausschlag, damit das Touchpad nicht springt
  const zoomenRef = useRef(zoomen)
  zoomenRef.current = zoomen
  useEffect(() => {
    const el = buehneRef.current
    if (!el) return
    const rad = (e: WheelEvent): void => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      zoomenRef.current(
        radFaktor(e.deltaY, e.deltaMode),
        e.clientX - r.left - r.width / 2,
        e.clientY - r.top - r.height / 2
      )
    }
    el.addEventListener('wheel', rad, { passive: false })
    return () => el.removeEventListener('wheel', rad)
  }, [])

  function ziehen(e: ReactMouseEvent): void {
    if (e.button !== 0 || zoom.art !== 'frei') return
    e.preventDefault()
    const start = { x: e.clientX - zoom.x, y: e.clientY - zoom.y, s: zoom.s }
    const bewegen = (ev: MouseEvent): void =>
      setZoom({ art: 'frei', s: start.s, x: ev.clientX - start.x, y: ev.clientY - start.y })
    const ende = (): void => {
      window.removeEventListener('mousemove', bewegen)
      window.removeEventListener('mouseup', ende)
    }
    window.addEventListener('mousemove', bewegen)
    window.addEventListener('mouseup', ende)
  }

  const papierkorb = useCallback(async (): Promise<void> => {
    if (id === undefined || gesperrt()) return
    setDiashow(false)
    try {
      const r = await api.library.trash([id])
      if (r.refused) setHinweis(r.refused)
      else if (r.failed)
        setHinweis('Konnte nicht in den Papierkorb verschoben werden – nichts gelöscht.')
      else setHinweis(null)
    } catch (err) {
      setHinweis(errorText(err))
    }
  }, [id, gesperrt])

  const aendern = useCallback(async (a: MetaAenderung, text: string): Promise<void> => {
    const kennung = idRef.current
    if (kennung === null) return
    try {
      const r = await api.meta.write([kennung], a)
      listeRef.current.details.setzen(r.geschrieben)
      const f = r.fehler[0]
      setHinweis(f ? f.grund : null)
      setRueck(f ? null : { text, journal: r.journal })
    } catch (err) {
      setHinweis(errorText(err))
      setRueck(null)
    }
  }, [])

  const rueckgaengig = useCallback(async (journal: number[]): Promise<void> => {
    setRueck(null)
    try {
      const r = await api.meta.undo(journal)
      listeRef.current.details.setzen(r.geschrieben)
      setHinweis(r.fehler[0]?.grund ?? null)
    } catch (err) {
      setHinweis(errorText(err))
    }
  }, [])

  useEffect(() => {
    if (!rueck) return
    const t = setTimeout(() => setRueck(null), RUECKMELDUNG_MS)
    return () => clearTimeout(t)
  }, [rueck])

  /** Warum sich das Bild nicht bearbeiten lässt; null = es geht */
  const bearbeitenGesperrt = !bild
    ? 'Das Bild wird noch geladen.'
    : lib?.folders.find((f) => f.id === bild.folderId)?.mode === 'nur-lesen'
      ? 'Der Ordner steht auf „nur lesen“.'
      : bild.format === null
        ? 'Die Metadaten werden noch gelesen.'
        : !schreibbar(bild.format)
          ? `In ${bild.format.toUpperCase()}-Dateien lässt sich nichts schreiben.`
          : null
  const bearbeitungOeffnen = useCallback(() => {
    if (bearbeitenGesperrt) {
      setHinweis(bearbeitenGesperrt)
      return
    }
    setDiashow(false)
    setHinweis(null)
    setBearbeiten(true)
  }, [bearbeitenGesperrt])

  const gespeichert = useCallback((r: SchreibBericht<ImageInfo>) => {
    ungespeichert.current = false
    listeRef.current.details.setzen(r.geschrieben)
    setBearbeiten(false)
    setInfo(true)
    setHinweis(null)
    setRueck({ text: 'In die Datei geschrieben', journal: r.journal })
  }, [])
  const geaendert = useCallback((ja: boolean) => {
    ungespeichert.current = ja
    if (!ja) setHinweis(null)
  }, [])
  const abbrechen = useCallback(() => {
    ungespeichert.current = false
    setBearbeiten(false)
  }, [])

  // Tasten (nur solange der Betrachter offen ist; nicht in Auswahl und Regler)
  useEffect(() => {
    const taste = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'SELECT' || tag === 'INPUT' || tag === 'TEXTAREA') return
      // im Panel gelten die Tasten des Panels; blättern geht weiter
      if (bearbeitenRef.current && !['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) {
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (rueck) void rueckgaengig(rueck.journal)
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (/^[0-5]$/.test(e.key)) {
        e.preventDefault()
        const n = Number(e.key)
        void aendern({ bewertung: n }, sterneText(n))
        return
      }
      const label = LABEL_TASTEN.get(e.key)
      if (label) {
        e.preventDefault()
        // dieselbe Taste noch einmal nimmt das Label wieder weg
        const weg = bild?.colorLabel === label
        void aendern(
          { farblabel: weg ? null : label },
          weg ? 'Farblabel entfernt' : `Farblabel ${farblabelText(label)} gespeichert`
        )
        return
      }
      const weiter: Record<string, () => void> = {
        ArrowRight: () => gehe(index + 1),
        ArrowLeft: () => gehe(index - 1),
        Home: () => gehe(0),
        End: () => gehe(ids.length - 1),
        '+': () => zoomen(ZOOM_SCHRITT),
        '-': () => zoomen(1 / ZOOM_SCHRITT),
        ' ': () => setDiashow((d) => !d),
        i: () => setInfo((v) => !v),
        e: () => bearbeitungOeffnen(),
        F11: vollbildUmschalten,
        Delete: () => void papierkorb(),
        Escape: () => {
          if (!document.fullscreenElement) schliessen()
        }
      }
      const f = Object.hasOwn(weiter, e.key) ? weiter[e.key] : undefined
      if (!f) return
      e.preventDefault()
      f()
    }
    window.addEventListener('keydown', taste)
    return () => window.removeEventListener('keydown', taste)
  }, [
    gehe,
    index,
    ids.length,
    zoomen,
    vollbildUmschalten,
    papierkorb,
    schliessen,
    aendern,
    rueckgaengig,
    rueck,
    bild?.colorLabel,
    bearbeitungOeffnen
  ])

  const knopf =
    'inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40'

  // Ebenen der Bühne: das gezeigte Original und – unsichtbar, bis es dekodiert ist – das neue.
  // Gleicher Schlüssel = gleiches <img>: Beim Tausch wird das neue nur sichtbar, nicht neu geladen.
  const alt = gezeigt && !fehler ? gezeigt : null
  const neu = bild && !bereit && !fehler ? bild : null

  return (
    <div
      ref={wurzel}
      role="dialog"
      aria-modal="true"
      aria-label="Betrachter"
      className="fixed inset-0 z-40 flex flex-col bg-background"
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b bg-leiste px-2">
        <button
          type="button"
          className={knopf}
          onClick={schliessen}
          aria-label="Zurück zur Galerie"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Galerie
        </button>
        <div className="min-w-0 flex-1 px-2">
          <h2 className="truncate text-sm font-semibold">{bild?.name ?? ''}</h2>
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <span aria-label="Position">
              {zahl.format(index + 1)} / {zahl.format(ids.length)}
            </span>
            {!!bild?.rating && (
              <span className="text-warning" aria-label={`${bild.rating} von 5 Sternen`}>
                {'★'.repeat(bild.rating)}
              </span>
            )}
            {bild?.colorLabel && <span>{farblabelText(bild.colorLabel)}</span>}
          </p>
        </div>
        <Zoomleiste
          skala={skala}
          passend={passend}
          angepasst={zoom.art === 'anpassen'}
          knopf={knopf}
          onZoom={(s) => zoomen(s / skala)}
          onFaktor={(f) => zoomen(f)}
          onAnpassen={() => setZoom({ art: 'anpassen', sanft: true })}
        />
        <div className="flex items-center gap-1 border-l pl-2">
          <button
            type="button"
            className={knopf}
            aria-pressed={diashow}
            disabled={bearbeiten}
            onClick={() => setDiashow((d) => !d)}
          >
            {diashow ? (
              <Pause className="size-4" aria-hidden />
            ) : (
              <Play className="size-4" aria-hidden />
            )}
            Diashow
          </button>
          <select
            aria-label="Intervall der Diashow"
            value={intervall}
            onChange={(e) => diashowAendern({ intervall: Number(e.target.value) })}
            className="h-8 rounded-md border border-border bg-background px-1 text-xs"
          >
            {DIASHOW_INTERVALLE.map((s) => (
              <option key={s} value={s}>
                {s} s
              </option>
            ))}
          </select>
          <DiashowMenue knopf={knopf} />
          <button
            type="button"
            className={knopf}
            aria-label={vollbild ? 'Vollbild beenden' : 'Vollbild'}
            onClick={vollbildUmschalten}
          >
            {vollbild ? (
              <Minimize className="size-4" aria-hidden />
            ) : (
              <Maximize className="size-4" aria-hidden />
            )}
          </button>
          <button
            type="button"
            className={knopf}
            aria-pressed={info}
            onClick={() => setInfo((v) => !v)}
          >
            <Info className="size-4" aria-hidden />
            Info
          </button>
          <button
            type="button"
            className={cn(knopf, 'text-danger')}
            onClick={() => void papierkorb()}
            disabled={id === undefined}
          >
            <Trash2 className="size-4" aria-hidden />
            Papierkorb
          </button>
        </div>
      </div>

      {hinweis && (
        <p role="alert" className="border-b bg-warning/10 px-4 py-1.5 text-xs text-warning">
          {hinweis}
        </p>
      )}

      <div className="flex min-h-0 flex-1">
        <div
          ref={buehneRef}
          className={cn(
            'relative min-w-0 flex-1 overflow-hidden bg-buehne',
            zoom.art === 'frei' && 'cursor-grab active:cursor-grabbing'
          )}
          onMouseDown={ziehen}
          onDoubleClick={() =>
            setZoom(
              zoom.art === 'anpassen'
                ? { art: 'frei', s: 1, x: 0, y: 0, sanft: true }
                : { art: 'anpassen', sanft: true }
            )
          }
        >
          {/* Platzhalter: das Vorschaubild, bis das erste Original da ist (oder statt eines
              Originals, das sich nicht zeigen lässt) */}
          {bild && (fehler || !gezeigt) && (
            <Vorschaubild
              key={`v${schluessel(bild)}`}
              bild={bild}
              stufe={768}
              className="absolute inset-0 size-full bg-transparent"
            />
          )}
          {[
            vorher && schluessel(vorher) !== gk && (
              <img
                key={schluessel(vorher)}
                data-ebene={schluessel(vorher)}
                src={bildUrl(vorher.id, vorher.mtime)}
                alt=""
                aria-hidden
                draggable={false}
                className="absolute left-1/2 top-1/2 max-w-none select-none"
                style={{
                  width: vorher.w,
                  height: vorher.h,
                  transform: `translate(-50%, -50%) scale(${fit(vorher)})`
                }}
              />
            ),
            alt && (
              <img
                key={schluessel(alt)}
                data-ebene={schluessel(alt)}
                src={bildUrl(alt.id, alt.mtime)}
                alt={alt.name}
                draggable={false}
                className={cn(
                  'absolute left-1/2 top-1/2 max-w-none select-none',
                  zoom.sanft &&
                    'transition-transform duration-150 ease-out motion-reduce:transition-none'
                )}
                style={{
                  width: alt.w,
                  height: alt.h,
                  transform: `translate(-50%, -50%) translate(${verschoben.x}px, ${verschoben.y}px) scale(${skala})`
                }}
              />
            ),
            neu && (
              <img
                key={schluessel(neu)}
                src={bildUrl(neu.id, neu.mtime)}
                alt={neu.name}
                draggable={false}
                onLoad={(e) => void geladen(e.currentTarget, neu)}
                onError={() => setFehler(true)}
                className="invisible absolute left-1/2 top-1/2 max-w-none select-none"
              />
            )
          ]}
          {fehler && (
            <p className="absolute inset-x-0 bottom-6 mx-auto w-fit rounded-md bg-background/90 px-3 py-2 text-sm">
              Dieses Bild lässt sich gerade nicht anzeigen – geändert, verschoben oder defekt.
            </p>
          )}
          {rueck && (
            <div
              role="status"
              className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-3 whitespace-nowrap rounded-md bg-background/90 px-3 py-1.5 text-sm shadow-lg"
            >
              <span>{rueck.text}</span>
              <button
                type="button"
                className="rounded-sm font-medium text-primary-line underline outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => void rueckgaengig(rueck.journal)}
              >
                Rückgängig
              </button>
            </div>
          )}
          {laedtLange && (
            <span className="absolute right-3 top-3 flex items-center gap-1.5 rounded-md bg-background/80 px-2 py-1 text-xs">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              Lädt …
            </span>
          )}
          <button
            type="button"
            aria-label="Vorheriges Bild"
            disabled={index <= 0}
            onClick={() => gehe(index - 1)}
            className="absolute left-2 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-background/70 outline-none hover:bg-background focus-visible:ring-2 focus-visible:ring-ring disabled:invisible"
          >
            <ChevronLeft className="size-5" aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Nächstes Bild"
            disabled={index >= ids.length - 1}
            onClick={() => gehe(index + 1)}
            className="absolute right-2 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-background/70 outline-none hover:bg-background focus-visible:ring-2 focus-visible:ring-ring disabled:invisible"
          >
            <ChevronRight className="size-5" aria-hidden />
          </button>
        </div>
        {bearbeiten && bild ? (
          <MetaFormular
            key={bild.id}
            bild={bild}
            onGespeichert={gespeichert}
            onAbbrechen={abbrechen}
            onGeaendert={geaendert}
          />
        ) : (
          info &&
          bild && (
            <InfoPanel
              bild={bild}
              gesperrt={bearbeitenGesperrt}
              onBearbeiten={bearbeitungOeffnen}
            />
          )
        )}
      </div>

      <Filmstreifen ids={ids} index={index} details={details} onWahl={gehe} />
    </div>
  )
}

const schlafen = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
