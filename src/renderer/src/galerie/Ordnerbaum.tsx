// Seitenleiste (docs/PLAN.md, Entwurf „Galerie – Kacheln“): „Alle Bilder“, darunter die
// Bibliotheksordner als Baum mit Unterordnern und Anzahl (samt allem darunter), Zustand und Modus
// an jedem Bibliotheksordner, Hinzufügen, Hinweis „Geschützt“. Ein Klick wählt, was die Galerie
// zeigt; „Videos“, „Ohne Datum“ und Ähnliches kommen mit Phase 2.
import {
  AlertTriangle,
  ChevronRight,
  Folder,
  FolderLock,
  FolderOpen,
  FolderPlus,
  FolderX,
  Images,
  Loader2,
  ShieldCheck,
  ShieldOff,
  X
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { Alert } from '@renderer/components/ui/alert'
import { knotenWaehlen, useKnoten, type Knoten } from '@renderer/lib/ansicht'
import { useVerzeichnisse } from '@renderer/lib/bildliste'
import { bilderText, zahl } from '@renderer/lib/format'
import {
  hinweisSchliessen,
  ordnerHinzufuegen,
  useHinzufuegenStatus,
  useLibrary
} from '@renderer/lib/library'
import { cn } from '@renderer/lib/utils'
import { baueBaum, type Zweig } from '@shared/ordnerBaum'
import type { LibraryFolder } from '@shared/types'
import { MODUS_TEXT, OrdnerMenue } from './OrdnerMenue'

function Symbol({ ordner }: { ordner: LibraryFolder }): JSX.Element {
  const k = 'size-4 shrink-0'
  if (ordner.status === 'nicht-erreichbar')
    return <FolderX className={cn(k, 'text-warning')} aria-hidden />
  if (ordner.status === 'liest')
    return <Loader2 className={cn(k, 'animate-spin text-primary-line')} aria-hidden />
  if (ordner.mode === 'nur-lesen')
    return <FolderLock className={cn(k, 'text-muted-foreground')} aria-hidden />
  if (ordner.mode === 'privat')
    return <ShieldOff className={cn(k, 'text-muted-foreground')} aria-hidden />
  return <Folder className={cn(k, 'text-primary-line')} aria-hidden />
}

/** Zweite Zeile: Zustand (liest, nicht erreichbar), fehlende Dateien, Modus, periodischer Abgleich. */
function Zustand({ ordner }: { ordner: LibraryFolder }): JSX.Element | null {
  const teile: JSX.Element[] = []
  if (ordner.status === 'liest') {
    teile.push(<span key="liest">liest … {zahl.format(ordner.found)}</span>)
  } else if (ordner.status === 'nicht-erreichbar') {
    teile.push(
      <span key="weg" className="text-warning">
        nicht erreichbar
      </span>
    )
  }
  if (ordner.missing > 0) {
    teile.push(
      <span key="fehlt" className="inline-flex items-center gap-1 text-warning">
        <AlertTriangle className="size-3" aria-hidden />
        {zahl.format(ordner.missing)} {ordner.missing === 1 ? 'fehlt' : 'fehlen'}
      </span>
    )
  }
  if (ordner.mode !== 'normal')
    teile.push(<span key="modus">{MODUS_TEXT[ordner.mode].toLowerCase()}</span>)
  // Netzlaufwerk (oder Überwachen nicht möglich): Änderungen kommen nicht sofort
  if (ordner.watch === 'periodisch' && ordner.status === 'bereit')
    teile.push(
      <span
        key="periodisch"
        title="Netzlaufwerk oder ohne Überwachung – Änderungen erscheinen spätestens nach 5 Minuten oder beim Wechsel in die App"
      >
        Abgleich alle 5 min
      </span>
    )
  if (!teile.length) return null
  return (
    <p className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
      {teile.map((t, i) => (
        <span key={i} className="inline-flex items-center gap-2">
          {i > 0 && <span aria-hidden>·</span>}
          {t}
        </span>
      ))}
    </p>
  )
}

const gleich = (a: Knoten, b: Knoten): boolean =>
  a === b || (!!a && !!b && a.ordner === b.ordner && a.pfad === b.pfad)

function Unterordner({
  folderId,
  zweig,
  ebene,
  offen,
  umschalten
}: {
  folderId: number
  zweig: Zweig
  ebene: number
  offen: ReadonlySet<string>
  umschalten: (key: string) => void
}): JSX.Element {
  const knoten = useKnoten()
  const key = `${folderId}:${zweig.pfad}`
  const auf = offen.has(key)
  const gewaehlt = gleich(knoten, { ordner: folderId, pfad: zweig.pfad })
  return (
    <li
      role="treeitem"
      aria-label={zweig.name}
      aria-level={ebene}
      aria-selected={gewaehlt}
      aria-expanded={zweig.kinder.length ? auf : undefined}
    >
      <div
        className={cn(
          'flex items-center gap-1 rounded-md py-1 pr-2 text-sm hover:bg-muted/60',
          gewaehlt && 'bg-muted'
        )}
        style={{ paddingLeft: 8 + (ebene - 1) * 14 }}
      >
        <Aufklapper sichtbar={zweig.kinder.length > 0} auf={auf} onClick={() => umschalten(key)} />
        <button
          type="button"
          onClick={() => knotenWaehlen({ ordner: folderId, pfad: zweig.pfad })}
          className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <FolderOpen className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate">{zweig.name}</span>
        </button>
        <span
          className="text-xs tabular-nums text-muted-foreground"
          title={bilderText(zweig.anzahl)}
        >
          {zahl.format(zweig.anzahl)}
        </span>
      </div>
      {auf && zweig.kinder.length > 0 && (
        <ul role="group">
          {zweig.kinder.map((k) => (
            <Unterordner
              key={k.pfad}
              folderId={folderId}
              zweig={k}
              ebene={ebene + 1}
              offen={offen}
              umschalten={umschalten}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

function Aufklapper({
  sichtbar,
  auf,
  onClick
}: {
  sichtbar: boolean
  auf: boolean
  onClick: () => void
}): JSX.Element {
  if (!sichtbar) return <span className="size-5 shrink-0" aria-hidden />
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={auf ? 'Zuklappen' : 'Aufklappen'}
      onClick={onClick}
      className="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted"
    >
      <ChevronRight
        className={cn('size-3.5 transition-transform', auf && 'rotate-90')}
        aria-hidden
      />
    </button>
  )
}

export function Ordnerbaum(): JSX.Element {
  const lib = useLibrary()
  const dirs = useVerzeichnisse(lib)
  const knoten = useKnoten()
  const { hinweis, waehlt } = useHinzufuegenStatus()
  // aufgeklappt: Bibliotheksordner zu Beginn offen, Unterordner zu
  const [offen, setOffen] = useState<ReadonlySet<string>>(new Set())
  const [zu, setZu] = useState<ReadonlySet<number>>(new Set())
  const baeume = useMemo(() => new Map(dirs.map((d) => [d.folderId, baueBaum(d.dirs)])), [dirs])
  const umschalten = (key: string): void =>
    setOffen((o) => {
      const n = new Set(o)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })

  return (
    <nav
      aria-label="Bibliothek und Ordner"
      className="flex w-64 shrink-0 flex-col border-r bg-leiste"
    >
      <h2 className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Bibliothek
      </h2>
      <div className="px-2">
        <button
          type="button"
          aria-current={knoten === null ? 'true' : undefined}
          onClick={() => knotenWaehlen(null)}
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring',
            knoten === null && 'bg-muted'
          )}
        >
          <Images className="size-4 shrink-0 text-primary-line" aria-hidden />
          <span className="flex-1">Alle Bilder</span>
          <span className="text-xs tabular-nums text-muted-foreground">
            {zahl.format(lib?.total ?? 0)}
          </span>
        </button>
      </div>
      <div className="flex items-center justify-between gap-2 px-3 pb-1 pt-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Ordner
        </h2>
        <button
          type="button"
          aria-label="Ordner hinzufügen"
          title="Ordner hinzufügen (oder Ordner in die Galerie ziehen)"
          disabled={waehlt}
          onClick={() =>
            void ordnerHinzufuegen().then((id) => id && knotenWaehlen({ ordner: id, pfad: '' }))
          }
          className="flex size-7 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          <FolderPlus className="size-4" aria-hidden />
        </button>
      </div>
      {hinweis && (
        <div className="relative mx-2 mb-2">
          <Alert tone="warning" className="pr-8">
            {hinweis}
          </Alert>
          <button
            type="button"
            aria-label="Hinweis schließen"
            onClick={hinweisSchliessen}
            className="absolute right-1.5 top-1.5 rounded-sm p-0.5 text-warning hover:bg-warning/10"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      )}
      <ul
        role="tree"
        aria-label="Ordner"
        className="min-h-0 flex-1 space-y-0.5 overflow-auto px-2 pb-2"
      >
        {lib?.folders.map((f) => {
          const baum = baeume.get(f.id)
          const auf = !zu.has(f.id)
          const gewaehlt = gleich(knoten, { ordner: f.id, pfad: '' })
          const kinder = baum?.kinder ?? []
          return (
            <li
              key={f.id}
              role="treeitem"
              aria-label={f.name}
              aria-level={1}
              aria-selected={gewaehlt}
              aria-expanded={kinder.length ? auf : undefined}
            >
              <div
                className={cn(
                  'flex items-center gap-1 rounded-md py-1.5 pl-1 pr-1 hover:bg-muted/60',
                  gewaehlt && 'bg-muted'
                )}
              >
                <Aufklapper
                  sichtbar={kinder.length > 0}
                  auf={auf}
                  onClick={() =>
                    setZu((z) => {
                      const n = new Set(z)
                      if (n.has(f.id)) n.delete(f.id)
                      else n.add(f.id)
                      return n
                    })
                  }
                />
                <button
                  type="button"
                  onClick={() => knotenWaehlen({ ordner: f.id, pfad: '' })}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Symbol ordner={f} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm" title={f.path}>
                      {f.name}
                    </span>
                    <Zustand ordner={f} />
                  </span>
                </button>
                <span
                  className="text-xs tabular-nums text-muted-foreground"
                  title={bilderText(f.count)}
                >
                  {zahl.format(f.count)}
                </span>
                <OrdnerMenue ordner={f} />
              </div>
              {auf && kinder.length > 0 && (
                <ul role="group">
                  {kinder.map((k) => (
                    <Unterordner
                      key={k.pfad}
                      folderId={f.id}
                      zweig={k}
                      ebene={2}
                      offen={offen}
                      umschalten={umschalten}
                    />
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
      <div className="m-2 rounded-md border bg-card p-2.5 text-xs text-muted-foreground">
        <p className="mb-1 inline-flex items-center gap-1.5 font-medium text-foreground">
          <ShieldCheck className="size-3.5 text-success" aria-hidden />
          Geschützt
        </p>
        <p>
          Offline – keine Netzverbindung. Vorschaubilder verschlüsselt. Originale ändert die Galerie
          nur auf Befehl.
        </p>
      </div>
    </nav>
  )
}
