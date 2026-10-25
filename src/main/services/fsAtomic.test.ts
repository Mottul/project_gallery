// Aus der Mottulbox übernommen (project_mega/src/main/services/fsAtomic.test.ts, Stand 0cc14cb).
import {
  existsSync,
  fsyncSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { link, open, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./log', () => ({ logLine: vi.fn() }))
vi.mock('node:fs', async (importOriginal) => {
  const m = await importOriginal<typeof import('node:fs')>()
  return { ...m, fsyncSync: vi.fn(m.fsyncSync) }
})
vi.mock('node:fs/promises', async (importOriginal) => {
  const m = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...m,
    link: vi.fn(m.link),
    open: vi.fn(m.open),
    rename: vi.fn(m.rename),
    rm: vi.fn(m.rm),
    writeFile: vi.fn(m.writeFile)
  }
})

const { writeFileAtomic, writeFileAtomicAsync, writeNewFileAsync } = await import('./fsAtomic')

const fail = (code: string): Error => Object.assign(new Error(`${code}: simuliert`), { code })
let dir = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fsatomic-'))
})
afterEach(() => {
  vi.clearAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

describe('atomar schreiben', () => {
  it('scheitert das Schreiben, bleibt die alte Datei und keine Nachbardatei liegen', () => {
    const file = join(dir, 'settings.json')
    writeFileSync(file, '{"a":1}')
    vi.mocked(fsyncSync).mockImplementationOnce(() => {
      throw fail('EIO')
    })
    expect(() => writeFileAtomic(file, '{"a":2}')).toThrow('EIO')
    expect(readFileSync(file, 'utf8')).toBe('{"a":1}')
    expect(readdirSync(dir)).toEqual(['settings.json'])
  })

  it('kurz gesperrt (Virenscanner): Umbenennen wird wiederholt statt direkt zu schreiben', async () => {
    const file = join(dir, 'Messe.mottul')
    writeFileSync(file, 'alt')
    vi.mocked(rename).mockRejectedValueOnce(fail('EPERM')).mockRejectedValueOnce(fail('EBUSY'))
    await writeFileAtomicAsync(file, Buffer.from('neu'))
    expect(readFileSync(file, 'utf8')).toBe('neu')
    expect(vi.mocked(writeFile)).not.toHaveBeenCalled()
    expect(readdirSync(dir)).toEqual(['Messe.mottul'])
  })

  it('bleibt die Sperre, greift der Notweg und räumt die Nachbardatei weg', async () => {
    const file = join(dir, 'Messe.mottul')
    writeFileSync(file, 'alt')
    vi.mocked(rename).mockRejectedValue(fail('EPERM'))
    await writeFileAtomicAsync(file, Buffer.from('neu'))
    vi.mocked(rename).mockReset()
    expect(readFileSync(file, 'utf8')).toBe('neu')
    expect(readdirSync(dir)).toEqual(['Messe.mottul'])
  })
})

describe('neue Datei exklusiv anlegen', () => {
  it('legt an; gibt es die Datei schon, EEXIST und sie bleibt unverändert', async () => {
    const file = join(dir, 'Neu.mottul')
    await writeNewFileAsync(file, Buffer.from('eins'))
    expect(readFileSync(file, 'utf8')).toBe('eins')
    await expect(writeNewFileAsync(file, Buffer.from('zwei'))).rejects.toMatchObject({
      code: 'EEXIST'
    })
    expect(readFileSync(file, 'utf8')).toBe('eins')
    expect(readdirSync(dir)).toEqual(['Neu.mottul'])
  })

  it('bricht das Schreiben ab (Netzlaufwerk weg), liegt am Zielpfad nichts Halbes', async () => {
    const file = join(dir, 'Abbruch.mottul')
    const real = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    // die Datei entsteht, das Schreiben bricht ab – und auch das Aufräumen scheitert
    vi.mocked(open).mockImplementationOnce(async (path, flags) => {
      const fh = await real.open(path, flags)
      return {
        writeFile: async () => {
          await fh.close()
          throw fail('EIO')
        },
        sync: async () => {},
        close: async () => {}
      } as unknown as Awaited<ReturnType<typeof open>>
    })
    vi.mocked(rm).mockRejectedValueOnce(fail('EIO'))
    await expect(writeNewFileAsync(file, Buffer.from('x'))).rejects.toThrow('EIO')
    expect(existsSync(file)).toBe(false)
  })

  it('ohne Hardlinks (FAT, manche Freigaben): reservieren und darüberlegen', async () => {
    const file = join(dir, 'Stick.mottul')
    vi.mocked(link).mockRejectedValueOnce(fail('EPERM'))
    await writeNewFileAsync(file, Buffer.from('fertig'))
    expect(readFileSync(file, 'utf8')).toBe('fertig')
    expect(readdirSync(dir)).toEqual(['Stick.mottul'])
  })
})
