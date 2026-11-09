// Aufträge der Mehrfachauswahl im main mit echtem Index und nachgestelltem Bilddienst: je Datei nur,
// was sich dort ändert, Stichwörter aus der eigenen Liste, Konflikt, Abbrechen, ein Auftrag zur Zeit,
// Rückfrage, Platz für die Sicherungen, Rückgängig als ein Schritt, gemischte Werte lesen.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TagWert } from '@shared/metaFields'
import type { AuftragEnde, AuftragStand, AuftragStart } from '@shared/metaMehrfach'
import type { AnzeigeDatei, SchreibAuftrag, SchreibErgebnis } from '../bilddienst/protokoll'
import type { Melden } from './mehrfach'

const dienst = vi.hoisted(() => ({
  tagsLesen: vi.fn(),
  tagsLesenViele: vi.fn(),
  schreiben: vi.fn(),
  zwischenWeg: vi.fn()
}))
const ordner = vi.hoisted(() => ({ sicherung: '' }))
const platz = vi.hoisted(() => ({ frei: null as number | null }))
const box = vi.hoisted(() => ({ antwort: 0, fragen: [] as string[] }))

vi.mock('electron', () => ({
  dialog: {
    showMessageBox: vi.fn(async (_f: unknown, o?: { message: string }) => {
      box.fragen.push((o ?? (_f as { message: string })).message)
      return { response: box.antwort, checkboxChecked: false }
    })
  }
}))
vi.mock('../log', () => ({ logLine: vi.fn() }))
vi.mock('../bilddienst/client', () => ({ bilddienst: dienst }))
vi.mock('../lokaleDaten', () => ({ sicherungsOrdner: () => ordner.sicherung }))
vi.mock('./platz', async (orig) => ({
  ...(await orig<typeof import('./platz')>()),
  freierPlatz: async () => platz.frei
}))

const { oeffneIndex } = await import('../db')
const repo = await import('../library/repo')
const { schreibenEinrichten } = await import('./schreiben')
const m = await import('./mehrfach')

type DB = ReturnType<typeof oeffneIndex>
const GB = 1024 ** 3

let db: DB
let folder: number
let dir: string
/** Was in den Dateien steht (rohe Tags je Pfad) – der nachgestellte Dienst liest und schreibt hier */
let dateien: Map<string, Record<string, unknown>>
let abgeglichen: [number, string][]
let gewartet: number[][]

function bild(rel: string, roh: Record<string, unknown>, ordnerId = folder): number {
  const seq = repo.scanBeginnen(db, ordnerId)
  const name = rel.split('/').pop() as string
  repo.stapelSchreiben(
    db,
    ordnerId,
    seq,
    [{ rel, name, size: 100, mtime: 1000, btime: 500 }],
    false
  )
  const id = db
    .prepare('SELECT id FROM images WHERE rel_path = ? AND folder_id = ?')
    .pluck()
    .get(rel, ordnerId) as number
  db.prepare("UPDATE images SET format = 'jpeg' WHERE id = ?").run(id)
  const pfad = join(ordnerId === folder ? 'D:\\Bilder' : 'E:\\Archiv', rel)
  dateien.set(pfad, { ...roh })
  return id
}

const schluessel = (t: string): string => t.replace(/^XMP-[^:]+:/, 'XMP:')

/** Wie ExifTool: Werte setzen, null entfernt den Tag */
function anwenden(roh: Record<string, unknown>, tags: readonly TagWert[]): void {
  for (const { tag, wert } of tags) {
    const k = schluessel(tag)
    if (wert === null || (Array.isArray(wert) && !wert.length)) delete roh[k]
    else roh[k] = wert
  }
}

/** Einen Auftrag starten und bis zu seinem Ende mitschreiben */
async function lauf(
  starte: (melden: Melden) => AuftragStart | Promise<AuftragStart>
): Promise<{ start: AuftragStart; staende: AuftragStand[]; ende: AuftragEnde | null }> {
  const staende: AuftragStand[] = []
  let fertig: (e: AuftragEnde) => void = () => {}
  const ende = new Promise<AuftragEnde>((r) => (fertig = r))
  const start = await starte((s) => {
    staende.push(s)
    if (s.ende) fertig(s.ende)
  })
  if (!('auftrag' in start)) return { start, staende, ende: null }
  return { start, staende, ende: await ende }
}

const schreiben = (ids: number[], a: object, opt = {}) =>
  lauf((melden) => m.schreibenStarten(null, ids, a, opt, melden))
const geschriebeneTags = (nr: number): TagWert[] =>
  (dienst.schreiben.mock.calls[nr][0] as SchreibAuftrag).tags
const pfadVon = (nr: number): string =>
  (dienst.schreiben.mock.calls[nr][0] as SchreibAuftrag).datei.pfad

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'galeria-mehrfach-'))
  ordner.sicherung = join(dir, 'Sicherungen')
  platz.frei = null
  box.antwort = 0
  box.fragen = []
  db = oeffneIndex(':memory:')
  folder = repo.ordnerAnlegen(db, 'D:\\Bilder', true, 1)
  dateien = new Map()
  abgeglichen = []
  gewartet = []
  dienst.tagsLesen.mockReset().mockImplementation(async (d: AnzeigeDatei) => ({
    ...dateien.get(d.pfad)
  }))
  dienst.tagsLesenViele
    .mockReset()
    .mockImplementation(async (ds: AnzeigeDatei[]) =>
      ds.map((d) => ({ werte: { ...dateien.get(d.pfad) }, code: null }))
    )
  dienst.schreiben.mockReset().mockImplementation(async (a: SchreibAuftrag) => {
    anwenden(dateien.get(a.datei.pfad) as Record<string, unknown>, a.tags)
    return { ok: true, size: a.datei.size + 10, mtime: a.datei.mtime + 10, roh: {} }
  })
  dienst.zwischenWeg.mockReset()
  schreibenEinrichten({
    db: () => db,
    details: (ids) => repo.details(db, ids),
    abgleichen: (id, rel) => abgeglichen.push([id, rel]),
    abgleichAbwarten: async (o) => {
      gewartet.push([...o])
    },
    geschrieben: async (id, r: Extract<SchreibErgebnis, { ok: true }>) => {
      repo.nachSchreiben(db, id, r.size, r.mtime)
    }
  })
})
afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('Schreiben', () => {
  it('Stichwörter je Datei aus ihrer eigenen Liste; wer schon alles hat, bleibt unberührt', async () => {
    const a = bild('a.jpg', { 'XMP:Subject': ['Urlaub', 'Meer'] })
    const b = bild('b.jpg', { 'XMP:Subject': ['Kroatien'], 'IPTC:Keywords': ['meer'] })
    const c = bild('c.jpg', { 'XMP:Subject': ['Familie'] })
    const r = await schreiben([a, b, c], {
      stichwoerterDazu: ['Familie'],
      stichwoerterWeg: ['MEER']
    })
    expect(r.ende?.dateien.map((d) => [d.id, d.status])).toEqual([
      [a, 'geschrieben'],
      [b, 'geschrieben'],
      [c, 'unveraendert']
    ])
    expect(dienst.schreiben).toHaveBeenCalledTimes(2)
    const subject = (nr: number): unknown =>
      geschriebeneTags(nr).find((t) => t.tag === 'XMP-dc:Subject')?.wert
    expect(subject(0)).toEqual(['Urlaub', 'Familie'])
    // nie die Liste der ersten Datei: b behält „Kroatien“, „meer“ geht auch aus IPTC
    expect(subject(1)).toEqual(['Kroatien', 'Familie'])
    expect(geschriebeneTags(1).find((t) => t.tag === 'IPTC:Keywords')?.wert).toEqual([
      'Kroatien',
      'Familie'
    ])
    // keine Sicherung, kein Journal für die unberührte Datei
    expect(repo.sicherungVorhanden(db, c)).toBe(false)
    expect(r.ende?.journal).toHaveLength(2)
    expect(r.ende?.dateien[0].sicherung).toBe('neu')
  })

  it('nur Felder, die sich in der Datei ändern', async () => {
    const a = bild('a.jpg', { 'XMP:Rating': 4, 'XMP:Title': 'Hafen' })
    const b = bild('b.jpg', { 'XMP:Rating': 2, 'XMP:Title': 'Hafen' })
    const r = await schreiben([a, b], { bewertung: 4, titel: 'Hafen' })
    expect(r.ende?.dateien.map((d) => d.status)).toEqual(['unveraendert', 'geschrieben'])
    expect(geschriebeneTags(0).map((t) => t.tag)).toEqual([
      'XMP-xmp:Rating',
      'EXIF:Rating',
      'EXIF:RatingPercent'
    ])
    // das Journal kennt die alten Werte genau dieser Tags
    const j = repo.journalHolen(db, r.ende?.journal[0] as number)
    expect(j?.vorher).toEqual([
      { tag: 'XMP-xmp:Rating', wert: 2 },
      { tag: 'EXIF:Rating', wert: null },
      { tag: 'EXIF:RatingPercent', wert: null }
    ])
  })

  it('„nur lesen“ und BMP in der Auswahl: abgelehnt, ohne die Datei zu lesen; „privat“ ohne Sicherung', async () => {
    const archiv = repo.ordnerAnlegen(db, 'E:\\Archiv', true, 2)
    const nurLesen = bild('n.jpg', { 'XMP:Rating': 1 }, archiv)
    repo.modusSetzen(db, archiv, 'nur-lesen')
    const bmp = bild('x.bmp', {})
    db.prepare("UPDATE images SET format = 'bmp' WHERE id = ?").run(bmp)
    const ok = bild('a.jpg', { 'XMP:Rating': 1 })
    const r = await schreiben([nurLesen, bmp, ok], { bewertung: 3 })
    expect(r.ende?.dateien.map((d) => [d.status, d.grund ?? ''])).toEqual([
      ['abgelehnt', expect.stringMatching(/nur lesen/)],
      ['abgelehnt', expect.stringMatching(/BMP/)],
      ['geschrieben', '']
    ])
    expect(dienst.tagsLesen).toHaveBeenCalledTimes(1)

    repo.modusSetzen(db, folder, 'privat')
    const p = bild('p.jpg', { 'XMP:Rating': 1 })
    const r2 = await schreiben([p], { bewertung: 3 })
    expect(r2.ende?.dateien[0]).toMatchObject({ status: 'geschrieben', sicherung: 'keine' })
    expect((dienst.schreiben.mock.calls[1][0] as SchreibAuftrag).sicherung).toBeNull()
  })

  it('außerhalb geändert: Konflikt, nur diese Datei wird abgeglichen, die anderen gehen weiter', async () => {
    const a = bild('a.jpg', {})
    const b = bild('Unter/b.jpg', {})
    const c = bild('c.jpg', {})
    dienst.tagsLesen.mockImplementation(async (d: AnzeigeDatei) => {
      if (d.pfad.endsWith('b.jpg')) throw Object.assign(new Error('x'), { code: 'GEAENDERT' })
      return { ...dateien.get(d.pfad) }
    })
    const r = await schreiben([a, b, c], { bewertung: 2 })
    expect(r.ende?.dateien.map((d) => d.status)).toEqual(['geschrieben', 'konflikt', 'geschrieben'])
    expect(r.ende?.dateien[1]).toMatchObject({
      name: 'b.jpg',
      grund: expect.stringMatching(/außerhalb/)
    })
    expect(abgeglichen).toEqual([[folder, 'Unter/b.jpg']])
  })

  it('Konflikt erst beim Schreiben (Dienst merkt die Änderung): Journal verworfen, Datei abgeglichen', async () => {
    const a = bild('a.jpg', {})
    dienst.schreiben.mockResolvedValueOnce({ ok: false, code: 'GEAENDERT' })
    const r = await schreiben([a], { bewertung: 2 })
    expect(r.ende?.dateien[0].status).toBe('konflikt')
    expect(r.ende?.journal).toEqual([])
    expect(db.prepare('SELECT count(*) FROM journal').pluck().get()).toBe(0)
    expect(abgeglichen).toEqual([[folder, 'a.jpg']])
  })

  it('„erneut versuchen“: erst die Dateien abgleichen und darauf warten, dann schreiben', async () => {
    const a = bild('a.jpg', {})
    let reihenfolge = ''
    dienst.schreiben.mockImplementation(async (x: SchreibAuftrag) => {
      reihenfolge += gewartet.length ? 'nach' : 'vor'
      anwenden(dateien.get(x.datei.pfad) as Record<string, unknown>, x.tags)
      return { ok: true, size: 110, mtime: 1010, roh: {} }
    })
    await schreiben([a], { bewertung: 2 }, { nochmal: true })
    expect(abgeglichen).toEqual([[folder, 'a.jpg']])
    expect(gewartet).toEqual([[folder]])
    expect(reihenfolge).toBe('nach')
  })

  it('Abbrechen hält nach der laufenden Datei an; Geschriebenes bleibt und steht im Bericht', async () => {
    const ids = ['a', 'b', 'c', 'd'].map((n) => bild(`${n}.jpg`, {}))
    dienst.schreiben.mockImplementation(async (x: SchreibAuftrag) => {
      // während die erste Datei geschrieben wird, kommt „Abbrechen“
      if (dienst.schreiben.mock.calls.length === 1) m.auftragAbbrechen()
      return { ok: true, size: x.datei.size + 10, mtime: x.datei.mtime + 10, roh: {} }
    })
    const r = await schreiben(ids, { bewertung: 5 })
    expect(r.ende?.abgebrochen).toBe(true)
    expect(r.ende?.dateien.map((d) => [d.id, d.status])).toEqual([[ids[0], 'geschrieben']])
    expect(dienst.schreiben).toHaveBeenCalledTimes(1)
    expect(r.ende?.journal).toHaveLength(1)
  })

  it('ein Auftrag zur Zeit; danach geht der nächste', async () => {
    const a = bild('a.jpg', {})
    let frei: () => void = () => {}
    dienst.schreiben.mockImplementationOnce(async (x: SchreibAuftrag) => {
      await new Promise<void>((r) => (frei = r))
      return { ok: true, size: x.datei.size + 10, mtime: x.datei.mtime + 10, roh: {} }
    })
    const erster = schreiben([a], { bewertung: 1 })
    await vi.waitFor(() => expect(dienst.schreiben).toHaveBeenCalled())
    expect(m.schreibAuftragLaeuft()).toBe(true)
    expect((await schreiben([a], { bewertung: 2 })).start).toEqual({ grund: m.BESCHAEFTIGT })
    expect((await lauf((x) => m.lesenStarten([a], x))).start).toEqual({ grund: m.BESCHAEFTIGT })
    frei()
    await erster
    expect(m.schreibAuftragLaeuft()).toBe(false)
    expect((await schreiben([a], { bewertung: 2 })).start).toHaveProperty('auftrag')
  })

  it('Fortschritt kommt gedrosselt, das Ende mit allen Ergebnissen', async () => {
    const ids = Array.from({ length: 5 }, (_, i) => bild(`${i}.jpg`, {}))
    const r = await schreiben(ids, { bewertung: 3 })
    const letzte = r.staende.at(-1) as AuftragStand
    expect(letzte.fertig).toBe(5)
    expect(letzte.gesamt).toBe(5)
    expect(r.staende.flatMap((s) => s.dateien).map((d) => d.id)).toEqual(ids)
    expect(r.ende?.dateien).toHaveLength(5)
    expect(r.staende.every((s, i) => i === 0 || s.fertig >= r.staende[i - 1].fertig)).toBe(true)
  })

  it('doppelte Kennungen zählen einmal', async () => {
    const a = bild('a.jpg', {})
    const r = await schreiben([a, a, a], { bewertung: 3 })
    expect(r.ende?.dateien).toHaveLength(1)
    expect(dienst.schreiben).toHaveBeenCalledTimes(1)
  })

  it('mehr als 200 Stichwörter in einer Datei: Fehler mit Grund, nichts geschrieben', async () => {
    const viele = Array.from({ length: 200 }, (_, i) => `w${i}`)
    const a = bild('a.jpg', { 'XMP:Subject': viele })
    const r = await schreiben([a], { stichwoerterDazu: ['neu'] })
    expect(r.ende?.dateien[0]).toMatchObject({
      status: 'fehler',
      grund: expect.stringMatching(/200/)
    })
    expect(dienst.schreiben).not.toHaveBeenCalled()
  })
})

describe('Rückfrage und Platz', () => {
  it('Schnellbewertung fragt mit der Zahl der Bilder; Abbrechen startet nichts', async () => {
    const ids = [bild('a.jpg', {}), bild('b.jpg', {})]
    box.antwort = 1
    const r = await schreiben(ids, { bewertung: 3 }, { rueckfrage: true })
    expect(box.fragen).toEqual(['3 Sterne für 2 Bilder schreiben?'])
    expect(r.start).toEqual({ abgebrochen: true })
    expect(dienst.tagsLesen).not.toHaveBeenCalled()
    box.antwort = 0
    expect(
      (await schreiben(ids, { bewertung: 3 }, { rueckfrage: true })).ende?.journal
    ).toHaveLength(2)
  })

  it('zu wenig Platz für alle Sicherungen zusammen: nichts beginnt', async () => {
    const ids = [bild('a.jpg', {}), bild('b.jpg', {})]
    db.prepare('UPDATE images SET size = ?').run(GB)
    platz.frei = 2.5 * GB
    const r = await schreiben(ids, { bewertung: 3 })
    expect(r.start).toEqual({ grund: expect.stringMatching(/fehlt Platz.*2 GB.*1,5 GB/) })
    expect(dienst.tagsLesen).not.toHaveBeenCalled()
  })

  it('wer schon eine Sicherung hat oder „privat“ ist, braucht keinen Platz', async () => {
    const a = bild('a.jpg', {})
    const b = bild('b.jpg', {})
    db.prepare('UPDATE images SET size = ?').run(GB)
    repo.sicherungEintragen(db, { imageId: a, folderId: folder, pfad: join(dir, 'a'), at: 1 })
    platz.frei = 2.5 * GB
    expect((await schreiben([a, b], { bewertung: 3 })).start).toHaveProperty('auftrag')
    repo.modusSetzen(db, folder, 'privat')
    platz.frei = 0
    expect((await schreiben([a, b], { bewertung: 4 })).start).toHaveProperty('auftrag')
  })
})

describe('Rückgängig', () => {
  it('nimmt einen ganzen Auftrag in einem Schritt zurück; seither Geänderte bleiben', async () => {
    const a = bild('a.jpg', { 'XMP:Rating': 1, 'XMP:Subject': ['Urlaub'] })
    const b = bild('b.jpg', { 'XMP:Rating': 2 })
    const c = bild('c.jpg', { 'XMP:Rating': 3 })
    const vorher = structuredClone([...dateien.values()])
    const w = await schreiben([a, b, c], { bewertung: 5, stichwoerterDazu: ['Neu'] })
    db.prepare('UPDATE images SET mtime = 9999 WHERE id = ?').run(c)
    const r = await lauf((x) => m.rueckgaengigStarten(w.ende?.journal ?? [], x))
    expect(r.ende?.dateien.map((d) => [d.id, d.status])).toEqual([
      [c, 'konflikt'],
      [b, 'geschrieben'],
      [a, 'geschrieben']
    ])
    expect(r.ende?.dateien[0].grund).toMatch(/seither/)
    const [da, db2] = [...dateien.values()]
    expect(da).toEqual(vorher[0])
    expect(db2).toEqual(vorher[1])
    // ein zweites Mal ändert nichts mehr an a und b
    const r2 = await lauf((x) => m.rueckgaengigStarten(w.ende?.journal ?? [], x))
    expect(r2.ende?.dateien.map((d) => d.id)).toEqual([c])
  })
})

describe('Lesen', () => {
  it('gemischte Werte der beschreibbaren Dateien; die übrigen mit Grund', async () => {
    const a = bild('a.jpg', { 'XMP:Rating': 4, 'XMP:Subject': ['Urlaub', 'Meer'] })
    const b = bild('b.jpg', { 'XMP:Rating': 4, 'XMP:Subject': ['urlaub'] })
    const bmp = bild('x.bmp', { 'XMP:Rating': 1 })
    db.prepare("UPDATE images SET format = 'bmp' WHERE id = ?").run(bmp)
    const geaendert = bild('g.jpg', {})
    dienst.tagsLesenViele.mockImplementation(async (ds: AnzeigeDatei[]) =>
      ds.map((d) =>
        d.pfad.endsWith('g.jpg')
          ? { werte: null, code: 'GEAENDERT' }
          : { werte: { ...dateien.get(d.pfad) }, code: null }
      )
    )
    const r = await lauf((x) => m.lesenStarten([a, b, bmp, geaendert], x))
    expect(r.ende?.werte?.anzahl).toBe(2)
    expect(r.ende?.werte?.bewertung).toEqual({ gleich: true, wert: 4 })
    expect(r.ende?.werte?.stichwoerter).toEqual([
      { wort: 'Urlaub', anzahl: 2 },
      { wort: 'Meer', anzahl: 1 }
    ])
    expect(r.ende?.dateien.map((d) => [d.id, d.status])).toEqual([
      [bmp, 'abgelehnt'],
      [geaendert, 'konflikt']
    ])
    expect(abgeglichen).toEqual([[folder, 'g.jpg']])
    // BMP nicht gelesen: nur zwei der vier gingen an den Dienst
    expect((dienst.tagsLesenViele.mock.calls[0][0] as AnzeigeDatei[]).length).toBe(3)
  })

  it('liest in Teilen; ein gescheiterter Teil trifft nur seine Dateien', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => bild(`${i}.jpg`, { 'XMP:Rating': 2 }))
    dienst.tagsLesenViele
      .mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'DIENST_BEENDET' }))
      .mockImplementation(async (ds: AnzeigeDatei[]) =>
        ds.map((d) => ({ werte: { ...dateien.get(d.pfad) }, code: null }))
      )
    const r = await lauf((x) => m.lesenStarten(ids, x))
    expect(dienst.tagsLesenViele).toHaveBeenCalledTimes(2)
    expect(r.ende?.werte?.anzahl).toBe(50)
    expect(r.ende?.dateien).toHaveLength(200)
    expect(r.ende?.dateien.every((d) => d.status === 'fehler')).toBe(true)
  })
})

it('Pfad im Auftrag stammt aus dem Index', async () => {
  const a = bild('Urlaub/a.jpg', {})
  await schreiben([a], { bewertung: 1 })
  expect(pfadVon(0)).toBe(join('D:\\Bilder', 'Urlaub/a.jpg'))
})
