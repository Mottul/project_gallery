// Ablauf im main mit echtem Index und nachgestelltem Bilddienst: Freigabe, Journal, Sicherung,
// Rückgängig, Aufräumen. Das eigentliche Schreiben prüft bilddienst/schreiben.lab.test.ts.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SchreibAuftrag, SchreibErgebnis } from '../bilddienst/protokoll'

const dienst = vi.hoisted(() => ({
  tagsLesen: vi.fn(),
  schreiben: vi.fn(),
  zwischenWeg: vi.fn()
}))
const ordner = vi.hoisted(() => ({ sicherung: '' }))

vi.mock('../log', () => ({ logLine: vi.fn() }))
vi.mock('../bilddienst/client', () => ({ bilddienst: dienst }))
vi.mock('../lokaleDaten', () => ({ sicherungsOrdner: () => ordner.sicherung }))

const { oeffneIndex } = await import('../db')
const repo = await import('../library/repo')
const {
  metaAendern,
  metaRueckgaengig,
  schreibenAufraeumen,
  schreibenEinrichten,
  sicherungenDesOrdnersWeg
} = await import('./schreiben')

type DB = ReturnType<typeof oeffneIndex>
const TAG = 86_400_000

let db: DB
let folder: number
let dir: string
let geschrieben: { id: number; size: number }[]
let abgeglichen: number[]

function bild(rel: string, format: string | null = 'jpeg'): number {
  const seq = repo.scanBeginnen(db, folder)
  const name = rel.split('/').pop() as string
  repo.stapelSchreiben(db, folder, seq, [{ rel, name, size: 100, mtime: 1000, btime: 500 }], false)
  const id = db.prepare('SELECT id FROM images WHERE rel_path = ?').pluck().get(rel) as number
  db.prepare('UPDATE images SET format = ? WHERE id = ?').run(format, id)
  return id
}

const gelungen = (a: SchreibAuftrag): SchreibErgebnis => ({
  ok: true,
  size: a.datei.size + 10,
  mtime: a.datei.mtime + 10,
  roh: {}
})

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'galeria-meta-'))
  ordner.sicherung = join(dir, 'Sicherungen')
  db = oeffneIndex(':memory:')
  folder = repo.ordnerAnlegen(db, 'D:\\Bilder', true, 1)
  geschrieben = []
  abgeglichen = []
  dienst.tagsLesen.mockReset().mockResolvedValue({ 'XMP:Rating': 2 })
  dienst.schreiben.mockReset().mockImplementation(async (a: SchreibAuftrag) => gelungen(a))
  dienst.zwischenWeg.mockReset()
  schreibenEinrichten({
    db: () => db,
    details: (ids) => repo.details(db, ids),
    abgleichen: (id) => abgeglichen.push(id),
    geschrieben: async (id, r) => {
      repo.nachSchreiben(db, id, r.size, r.mtime)
      geschrieben.push({ id, size: r.size })
    }
  })
})
afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('metaAendern', () => {
  it('schreibt die Tags des Formats und meldet das Bild; das Journal kennt die alten Werte', async () => {
    const id = bild('a.jpg')
    const r = await metaAendern([id], { bewertung: 4 })
    expect(r.fehler).toEqual([])
    expect(r.geschrieben.map((b) => (b as { id: number }).id)).toEqual([id])
    const a = dienst.schreiben.mock.calls[0][0] as SchreibAuftrag
    expect(a.tags.map((t) => t.tag)).toEqual([
      'XMP-xmp:Rating',
      'EXIF:Rating',
      'EXIF:RatingPercent'
    ])
    expect(a.datei.pfad).toBe(join('D:\\Bilder', 'a.jpg'))
    expect(a.zwischen).toContain('.a.jpg.galerie-tmp-')
    const j = repo.journalHolen(db, r.journal[0])
    expect(j?.vorher).toEqual([
      { tag: 'XMP-xmp:Rating', wert: 2 },
      { tag: 'EXIF:Rating', wert: null },
      { tag: 'EXIF:RatingPercent', wert: null }
    ])
    expect(j?.size_nach).toBe(110)
    expect(repo.journalOffene(db)).toEqual([])
  })

  it('das Journal steht, bevor geschrieben wird', async () => {
    const id = bild('a.jpg')
    let offen = 0
    dienst.schreiben.mockImplementation(async (a: SchreibAuftrag) => {
      offen = repo.journalOffene(db).length
      expect(repo.journalOffene(db)[0].zwischen).toBe(a.zwischen)
      return gelungen(a)
    })
    await metaAendern([id], { bewertung: 4 })
    expect(offen).toBe(1)
  })

  it.each([
    ['„nur lesen“', () => repo.modusSetzen(db, folder, 'nur-lesen'), 'jpeg', /nur lesen/],
    ['BMP', () => undefined, 'bmp', /BMP/],
    ['noch nicht gelesen', () => undefined, null, /noch gelesen/]
  ])('lehnt ab, ohne den Dienst zu fragen: %s', async (_n, vorher, format, grund) => {
    const id = bild('a.jpg', format)
    vorher()
    const r = await metaAendern([id], { bewertung: 4 })
    expect(r.geschrieben).toEqual([])
    expect(r.fehler[0].grund).toMatch(grund)
    expect(dienst.tagsLesen).not.toHaveBeenCalled()
    expect(dienst.schreiben).not.toHaveBeenCalled()
  })

  it('ein gescheiterter Auftrag hinterlässt kein Journal und hält den nächsten nicht auf', async () => {
    const a = bild('a.jpg')
    const b = bild('b.jpg')
    dienst.schreiben.mockResolvedValueOnce({ ok: false, code: 'PIXEL' })
    const r = await metaAendern([a, b], { bewertung: 4 })
    expect(r.fehler).toEqual([{ id: a, name: 'a.jpg', grund: expect.stringMatching(/Bilddaten/) }])
    expect(r.journal).toHaveLength(1)
    expect(db.prepare('SELECT count(*) FROM journal').pluck().get()).toBe(1)
    expect(geschrieben.map((g) => g.id)).toEqual([b])
  })

  it('Datei von außen geändert: Hinweis und Abgleich des Ordners', async () => {
    const id = bild('a.jpg')
    dienst.tagsLesen.mockRejectedValue(Object.assign(new Error('x'), { code: 'GEAENDERT' }))
    const r = await metaAendern([id], { bewertung: 4 })
    expect(r.fehler[0].grund).toMatch(/von außen/)
    expect(abgeglichen).toEqual([folder])
    expect(dienst.schreiben).not.toHaveBeenCalled()
  })

  it.each(['ABGEBROCHEN', 'DIENST_BEENDET', 'ZEITLIMIT'])(
    'Ausgang offen (%s): Die Zeile bleibt für das Aufräumen beim nächsten Start',
    async (code) => {
      const id = bild('a.jpg')
      dienst.schreiben.mockRejectedValue(Object.assign(new Error('x'), { code }))
      const r = await metaAendern([id], { bewertung: 4 })
      expect(r.fehler).toHaveLength(1)
      expect(repo.journalOffene(db)).toHaveLength(1)
    }
  )

  it('Ordner wird während des Lesens „nur lesen“: nichts geschrieben', async () => {
    const id = bild('a.jpg')
    dienst.tagsLesen.mockImplementation(async () => {
      repo.modusSetzen(db, folder, 'nur-lesen')
      return {}
    })
    const r = await metaAendern([id], { bewertung: 4 })
    expect(r.fehler[0].grund).toMatch(/nur lesen/)
    expect(dienst.schreiben).not.toHaveBeenCalled()
    expect(db.prepare('SELECT count(*) FROM journal').pluck().get()).toBe(0)
  })

  it('Ordner wird während des Lesens „privat“: keine Sicherung', async () => {
    const id = bild('a.jpg')
    dienst.tagsLesen.mockImplementation(async () => {
      repo.modusSetzen(db, folder, 'privat')
      return {}
    })
    await metaAendern([id], { bewertung: 4 })
    expect((dienst.schreiben.mock.calls[0][0] as SchreibAuftrag).sicherung).toBeNull()
  })

  it('Aufträge laufen nacheinander und sehen den Stand des vorigen', async () => {
    const id = bild('a.jpg')
    const groessen: number[] = []
    dienst.schreiben.mockImplementation(async (a: SchreibAuftrag) => {
      groessen.push(a.datei.size)
      return gelungen(a)
    })
    await Promise.all([metaAendern([id], { bewertung: 1 }), metaAendern([id], { bewertung: 2 })])
    expect(groessen).toEqual([100, 110])
  })
})

describe('Sicherung', () => {
  const sicherungVon = (nr: number): string | null =>
    (dienst.schreiben.mock.calls[nr][0] as SchreibAuftrag).sicherung

  it('eine je Datei: nur beim ersten Schreiben, unter dem Namen der Datei', async () => {
    const id = bild('Urlaub/a.jpg')
    await metaAendern([id], { bewertung: 1 })
    await metaAendern([id], { bewertung: 2 })
    expect(sicherungVon(0)).toContain(ordner.sicherung)
    expect(sicherungVon(0)).toMatch(/a\.jpg$/)
    expect(sicherungVon(1)).toBeNull()
  })

  it('im Ordner „privat“ keine', async () => {
    const id = bild('a.jpg')
    repo.modusSetzen(db, folder, 'privat')
    await metaAendern([id], { bewertung: 1 })
    expect(sicherungVon(0)).toBeNull()
    expect(repo.sicherungVorhanden(db, id)).toBe(false)
  })

  it('gescheitert: keine Eintragung, der nächste Versuch sichert', async () => {
    const id = bild('a.jpg')
    dienst.schreiben.mockResolvedValueOnce({ ok: false, code: 'GESPERRT' })
    await metaAendern([id], { bewertung: 1 })
    expect(repo.sicherungVorhanden(db, id)).toBe(false)
    await metaAendern([id], { bewertung: 1 })
    expect(sicherungVon(1)).not.toBeNull()
  })

  it('Ordner entfernt oder privat geworden: Dateien und Zeilen weg', async () => {
    const id = bild('a.jpg')
    const pfad = join(ordner.sicherung, '2026-10-30', 'a.jpg')
    mkdirSync(join(ordner.sicherung, '2026-10-30'), { recursive: true })
    writeFileSync(pfad, 'x')
    repo.sicherungEintragen(db, { imageId: id, folderId: folder, pfad, at: 1 })
    await sicherungenDesOrdnersWeg(folder)
    expect(existsSync(pfad)).toBe(false)
    expect(existsSync(join(ordner.sicherung, '2026-10-30'))).toBe(false)
    expect(repo.sicherungVorhanden(db, id)).toBe(false)
  })
})

describe('metaRueckgaengig', () => {
  it('schreibt die alten Werte über denselben Weg und nur einmal', async () => {
    const id = bild('a.jpg')
    const { journal } = await metaAendern([id], { bewertung: 4 })
    const r = await metaRueckgaengig(journal)
    expect(r.fehler).toEqual([])
    const a = dienst.schreiben.mock.calls[1][0] as SchreibAuftrag
    expect(a.tags[0]).toEqual({ tag: 'XMP-xmp:Rating', wert: 2 })
    expect(dienst.tagsLesen).toHaveBeenCalledTimes(1)
    await metaRueckgaengig(journal)
    expect(dienst.schreiben).toHaveBeenCalledTimes(2)
  })

  it('nicht, wenn die Datei seither geändert wurde', async () => {
    const id = bild('a.jpg')
    const { journal } = await metaAendern([id], { bewertung: 4 })
    db.prepare('UPDATE images SET mtime = 9999 WHERE id = ?').run(id)
    const r = await metaRueckgaengig(journal)
    expect(r.fehler[0].grund).toMatch(/seither/)
    expect(dienst.schreiben).toHaveBeenCalledTimes(1)
    expect(repo.journalHolen(db, journal[0])?.undone_at).toBeNull()
  })

  it('nicht im Ordner „nur lesen“', async () => {
    const id = bild('a.jpg')
    const { journal } = await metaAendern([id], { bewertung: 4 })
    repo.modusSetzen(db, folder, 'nur-lesen')
    expect((await metaRueckgaengig(journal)).fehler[0].grund).toMatch(/nur lesen/)
  })

  it('unbekannte Kennung: nichts geschieht', async () => {
    expect(await metaRueckgaengig([999])).toEqual({ geschrieben: [], fehler: [], journal: [] })
  })
})

describe('schreibenAufraeumen', () => {
  it('räumt Nachbardateien eines Absturzes weg und verwirft die offene Zeile', async () => {
    const id = bild('a.jpg')
    const j = repo.journalAnlegen(db, {
      at: 1,
      action: 'metadaten',
      imageId: id,
      vorher: [],
      nachher: [],
      zwischen: 'D:\\Bilder\\.a.jpg.galerie-tmp-1.jpg'
    })
    await schreibenAufraeumen()
    expect(dienst.zwischenWeg).toHaveBeenCalledWith(['D:\\Bilder\\.a.jpg.galerie-tmp-1.jpg'])
    expect(repo.journalHolen(db, j)).toBeNull()
  })

  it('ohne Offenes fragt es den Dienst nicht', async () => {
    await schreibenAufraeumen()
    expect(dienst.zwischenWeg).not.toHaveBeenCalled()
  })

  it('löscht nach 30 Tagen Sicherungen samt Datei und alte Journal-Zeilen, jüngere bleiben', async () => {
    const id = bild('a.jpg')
    const jetzt = 100 * TAG
    const alt = join(dir, 'alt.jpg')
    const jung = join(dir, 'jung.jpg')
    writeFileSync(alt, 'x')
    writeFileSync(jung, 'x')
    const s = { imageId: id, folderId: folder }
    repo.sicherungEintragen(db, { ...s, pfad: alt, at: jetzt - 31 * TAG })
    repo.sicherungEintragen(db, { ...s, pfad: jung, at: jetzt - 29 * TAG })
    const j = { action: 'metadaten', imageId: id, vorher: [], nachher: [], zwischen: 'x' }
    const j1 = repo.journalAnlegen(db, { ...j, at: jetzt - 31 * TAG })
    const j2 = repo.journalAnlegen(db, { ...j, at: jetzt - 29 * TAG })
    repo.journalFertig(db, j1, 1, 1)
    repo.journalFertig(db, j2, 1, 1)
    await schreibenAufraeumen(jetzt)
    expect(existsSync(alt)).toBe(false)
    expect(existsSync(jung)).toBe(true)
    expect(repo.journalHolen(db, j1)).toBeNull()
    expect(repo.journalHolen(db, j2)).not.toBeNull()
    expect(repo.sicherungVorhanden(db, id)).toBe(true)
  })
})
