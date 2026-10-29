import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  Beobachter,
  istNetzpfad,
  pfadeZusammenfassen,
  relativerPfad,
  type Meldung
} from './beobachter'

describe('Pfade aus fs.watch', () => {
  it('relativ mit „/“; absolut heißt: der Ordner selbst ist weg', () => {
    expect(relativerPfad('Urlaub\\Köln\\a 🌞.jpg')).toBe('Urlaub/Köln/a 🌞.jpg')
    expect(relativerPfad('Urlaub/')).toBe('Urlaub')
    expect(relativerPfad('\\\\?\\C:\\Users\\x\\bib')).toBeNull()
    expect(relativerPfad('C:\\bib')).toBeNull()
    expect(relativerPfad('/home/x/bib')).toBeNull()
  })

  it('Netzlaufwerk: UNC-Pfad (auch ein verbundenes Laufwerk nach realpath), sonst lokal', () => {
    expect(istNetzpfad('\\\\nas\\fotos\\2024', true)).toBe(true)
    expect(istNetzpfad('//nas/fotos', true)).toBe(true)
    expect(istNetzpfad('\\\\?\\UNC\\nas\\fotos', true)).toBe(true)
    expect(istNetzpfad('\\\\?\\C:\\Bilder', true)).toBe(false)
    expect(istNetzpfad('\\\\.\\C:\\Bilder', true)).toBe(false)
    expect(istNetzpfad('E:\\Bilder', true)).toBe(false)
    expect(istNetzpfad('//nas/fotos', false)).toBe(false)
  })
})

describe('pfadeZusammenfassen', () => {
  it('Unwichtiges weg: Papierkorb, versteckte Ordner und Dateien, Zwischennamen', () => {
    expect(
      pfadeZusammenfassen([
        'a.jpg',
        '$RECYCLE.BIN/x.jpg',
        '.thumbs/b.jpg',
        'Urlaub/.c.jpg.galerie-tmp-1',
        'Urlaub/@eaDir/d.jpg',
        'Urlaub/e.jpg'
      ])
    ).toEqual(['Urlaub/e.jpg', 'a.jpg'])
  })

  it('was unter einem gemeldeten Ordner liegt, deckt dessen Abgleich ab', () => {
    expect(
      pfadeZusammenfassen(['Urlaub/Köln/a.jpg', 'Urlaub', 'Urlaub/Köln', 'Reise/b.jpg', 'Urlaubx'])
    ).toEqual(['Reise/b.jpg', 'Urlaub', 'Urlaubx'])
  })

  it('viele Einträge eines Ordners werden zum Ordner, auch über mehrere Ebenen', () => {
    const viele = Array.from({ length: 60 }, (_, i) => `2024/Mai/b${i}.jpg`)
    expect(pfadeZusammenfassen([...viele, 'x.jpg'], 500, 50)).toEqual(['2024/Mai', 'x.jpg'])
    // 60 neue Unterordner (je ein Eintrag) in 2024 → 2024
    const ordner = Array.from({ length: 60 }, (_, i) => `2024/t${i}`)
    expect(pfadeZusammenfassen([...ordner, ...ordner.map((o) => `${o}/a.jpg`)], 500, 50)).toEqual([
      '2024'
    ])
  })

  it('zu viele oder die Wurzel: null (ganzer Ordner)', () => {
    const viele = Array.from({ length: 60 }, (_, i) => `b${i}.jpg`)
    expect(pfadeZusammenfassen(viele, 500, 50)).toBeNull()
    const verteilt = Array.from({ length: 20 }, (_, i) => `o${i}/a.jpg`)
    expect(pfadeZusammenfassen(verteilt, 10, 50)).toBeNull()
    expect(pfadeZusammenfassen([])).toEqual([])
  })
})

describe('Beobachter (echtes fs.watch)', () => {
  let basis: string
  let dir: string
  let meldungen: Meldung[]
  let b: Beobachter | null

  beforeEach(() => {
    basis = mkdtempSync(join(tmpdir(), 'galeria-watch-'))
    dir = join(basis, 'bib')
    mkdirSync(dir)
    meldungen = []
    b = new Beobachter(dir, (m) => meldungen.push(m), { ruheMs: 100, hoechstensMs: 1000 })
    b.starten()
  })
  afterEach(() => {
    b?.schliessen()
    rmSync(basis, { recursive: true, force: true, maxRetries: 5 })
  })

  const warten = async (pruef: () => boolean, ms = 5000): Promise<void> => {
    const t0 = Date.now()
    while (!pruef() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 50))
  }
  const allePfade = (): string[] =>
    meldungen.flatMap((m) => (m.art === 'pfade' ? [...m.pfade, ...m.dateien] : [`<${m.art}>`]))

  it('meldet neue, geänderte und umbenannte Dateien gesammelt', async () => {
    mkdirSync(join(dir, 'Urlaub', 'Köln'), { recursive: true })
    writeFileSync(join(dir, 'Urlaub', 'Köln', 'a 🌞.jpg'), 'x')
    await warten(() => allePfade().length > 0)
    expect(allePfade()).toContain('Urlaub')
    meldungen = []
    renameSync(join(dir, 'Urlaub'), join(dir, 'Reise'))
    await warten(() => allePfade().includes('Reise') && allePfade().includes('Urlaub'))
    expect(allePfade()).toEqual(expect.arrayContaining(['Reise', 'Urlaub']))
  })

  it('Lesen ist keine Änderung: selbst gelesen und gleich → still; Ordner mit „change“ → still', async () => {
    mkdirSync(join(dir, 'Urlaub'))
    const datei = join(dir, 'Urlaub', 'a.jpg')
    writeFileSync(datei, 'x')
    await warten(() => allePfade().length > 0)
    await new Promise((r) => setTimeout(r, 300))
    meldungen = []
    // Zugriffszeit alt machen (Windows aktualisiert sie beim Lesen höchstens stündlich)
    const alt = (Date.now() - 2 * 3600_000) / 1000
    utimesSync(datei, alt, statSync(datei).mtime)
    const st = statSync(datei)
    b?.gelesenMerken(datei, st.size, Math.trunc(st.mtimeMs))
    readFileSync(datei)
    await new Promise((r) => setTimeout(r, 800))
    expect(meldungen).toEqual([])
    // eine echte Änderung derselben Datei zählt trotzdem
    appendFileSync(datei, 'y')
    await warten(() => allePfade().includes('Urlaub/a.jpg'))
    expect(meldungen).toEqual([{ art: 'pfade', pfade: [], dateien: ['Urlaub/a.jpg'] }])
  })

  // Gemessen unter Windows (Endlos-Sturm absoluter Pfade); Linux meldet das Löschen des Ordners
  // selbst nicht (CI) – dort findet es die Erreichbarkeitsprüfung der Bibliothek (30 s, Fokus;
  // library.test.ts, E2E ueberwachen)
  it.runIf(process.platform === 'win32')(
    'der Ordner selbst wird gelöscht: einmal „weg“, dann still (kein Ereignissturm)',
    { timeout: 10_000 },
    async () => {
      rmSync(dir, { recursive: true, force: true })
      await warten(() => meldungen.some((m) => m.art === 'weg'))
      await new Promise((r) => setTimeout(r, 300))
      expect(meldungen.filter((m) => m.art === 'weg')).toHaveLength(1)
      expect(meldungen.length).toBeLessThanOrEqual(2)
    }
  )
})
