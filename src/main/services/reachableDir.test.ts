// Aus der Mottulbox übernommen (project_mega/src/main/services/reachableDir.test.ts, Stand 0cc14cb).
import { mkdtempSync, rmSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('node:fs/promises', async (importOriginal) => {
  const m = await importOriginal<typeof import('node:fs/promises')>()
  return { ...m, stat: vi.fn(m.stat) }
})

const { isDirReachable } = await import('./reachableDir')

describe('Ordner erreichbar?', () => {
  it('vorhandener Ordner ja, Datei und fehlender Pfad nein', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'erreichbar-'))
    try {
      expect(await isDirReachable(dir)).toBe(true)
      expect(await isDirReachable(join(dir, 'gibt-es-nicht'))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('hängendes Netzlaufwerk: nach dem Zeitlimit „nein“, und nur eine Prüfung läuft', async () => {
    vi.mocked(stat).mockReset()
    vi.mocked(stat).mockImplementation(() => new Promise(() => {}))
    const started = Date.now()
    const answers = await Promise.all([
      isDirReachable('\\\\nas\\projekte', 50),
      isDirReachable('\\\\nas\\projekte', 50),
      isDirReachable('\\\\nas\\projekte', 50)
    ])
    expect(answers).toEqual([false, false, false])
    expect(Date.now() - started).toBeLessThan(1000)
    expect(vi.mocked(stat)).toHaveBeenCalledTimes(1)
  })
})
