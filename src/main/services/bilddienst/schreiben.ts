// Schreiben in eine Datei des Nutzers (Phase 3, Schicht B im Skill bildschutz) – im Bilddienst, hier
// liegt ExifTool. Der Ablauf hält das Original heil, bis alles nachgeprüft ist:
//   1. Datei passt noch zum Index (sonst GEAENDERT, nichts geschieht), nicht schreibgeschützt.
//   2. ExifTool schreibt mit `-o` in eine Nachbardatei; das Original bleibt unberührt.
//   3. Die Nachbardatei prüfen: Stehen die Werte drin, sind die Pixel gleich? Sonst weg damit.
//   4. Sicherung des Originals, wenn der main eine verlangt.
//   5. Noch einmal prüfen, ob die Datei unverändert ist, dann atomar ersetzen.
// Das Nachprüfen liegt also VOR dem Ersetzen, nicht danach – gescheitert ändert sich nichts. Die
// Nachbardatei geht auf jedem Weg wieder weg (`finally`); bleibt sie nach einem Absturz liegen,
// räumt der nächste Start sie auf (Journal). Ins Log kommen nur Codes, nie Werte.

import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, mkdir, rename, rm, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import sharp from 'sharp'
import { GRUNDFELD_TAGS } from '@shared/grundfelder'
import { abweichend, type TagWert } from '@shared/metaFields'
import { mitZeitlimit, pruefeDatei } from '../dateien/pruefeDatei'
import { schreibArgumente } from '../exiftool/args'
import { leseTags, type ExifToolPool } from '../exiftool/exiftool'
import type { SchreibAuftrag, SchreibErgebnis } from './protokoll'

/** So lange darf die Prüfung einer Datei dauern (hängendes Netzlaufwerk) */
const PRUEF_MS = 5000
/** Virenscanner und Sync-Programme halten eine frische Datei oft nur Millisekunden */
const WARTEN_MS = [25, 50, 100, 200, 400, 800]
const GESPERRT = new Set(['EPERM', 'EACCES', 'EBUSY'])

/**
 * Kennung der Bilddaten: ExifTool hasht sie ohne Metadaten (JPEG, PNG, WebP, AVIF), für GIF und TIFF
 * kann es das nicht (gemessen) – dann die dekodierten Pixel. Die Ausrichtung gehört nicht dazu.
 */
export async function bildKennung(pool: ExifToolPool, pfad: string): Promise<string> {
  const a = await pool.ausfuehren(['-api', 'ImageHashType=SHA256', '-ImageDataHash', '-s3', pfad])
  const h = a.ausgabe.trim()
  if (/^[0-9a-f]{64}$/.test(h)) return `bilddaten:${h}`
  const { data, info } = await sharp(pfad, { animated: true, failOn: 'none' })
    .raw()
    .toBuffer({ resolveWithObject: true })
  const summe = createHash('sha256').update(data).digest('hex')
  return `pixel:${info.width}x${info.height}x${info.channels}:${summe}`
}

async function ersetzen(zwischen: string, pfad: string): Promise<void> {
  for (const ms of WARTEN_MS) {
    try {
      return await rename(zwischen, pfad)
    } catch (err) {
      if (!GESPERRT.has((err as NodeJS.ErrnoException).code ?? '')) throw err
      await new Promise((r) => setTimeout(r, ms))
    }
  }
  try {
    await rename(zwischen, pfad)
  } catch (err) {
    if (!GESPERRT.has((err as NodeJS.ErrnoException).code ?? '')) throw err
    throw Object.assign(new Error('gesperrt'), { code: 'GESPERRT' })
  }
}

/** Tags einer Datei lesen, nach derselben Prüfung wie vor jedem Lesen. */
export async function tagsLesen(
  pool: ExifToolPool,
  datei: SchreibAuftrag['datei'],
  tags: readonly TagWert[]
): Promise<Record<string, unknown> | null> {
  await mitZeitlimit(pruefeDatei(datei.pfad, datei.ordner, datei.size, datei.mtime), PRUEF_MS)
  const r = await leseTags(
    pool,
    [datei.pfad],
    tags.map((t) => `-${t.tag}`)
  )
  return r.get(datei.pfad) ?? null
}

export async function schreibe(
  { datei, tags, sicherung, zwischen }: SchreibAuftrag,
  pool: ExifToolPool
): Promise<SchreibErgebnis> {
  const { pfad, ordner, size, mtime } = datei
  const unveraendert = (): Promise<void> =>
    mitZeitlimit(pruefeDatei(pfad, ordner, size, mtime), PRUEF_MS)
  const nein = (code: string): SchreibErgebnis => ({ ok: false, code })
  try {
    await unveraendert()
    if (!((await stat(pfad)).mode & 0o200)) return nein('SCHREIBGESCHUETZT')

    const a = await pool.ausfuehren(schreibArgumente(tags, pfad, zwischen))
    if (!/\b1 image files? created\b/.test(a.ausgabe)) return nein('SCHREIBFEHLER')

    const ist = (
      await leseTags(
        pool,
        [zwischen],
        tags.map((t) => `-${t.tag}`)
      )
    ).get(zwischen)
    if (!ist || abweichend(tags, ist).length) return nein('ABWEICHUNG')
    const [vorher, nachher] = await Promise.all([
      bildKennung(pool, pfad),
      bildKennung(pool, zwischen)
    ])
    if (vorher !== nachher) return nein('PIXEL')

    if (sicherung) {
      await mkdir(dirname(sicherung), { recursive: true })
      await copyFile(pfad, sicherung, constants.COPYFILE_EXCL).catch((err) => {
        // dieselbe Fassung liegt schon dort (Name aus Kennung und Änderungszeit)
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
          throw Object.assign(new Error('Sicherung'), { code: 'SICHERUNG' })
        }
      })
    }

    await unveraendert()
    await ersetzen(zwischen, pfad)
    const neu = await stat(pfad)
    const roh = (await leseTags(pool, [pfad], GRUNDFELD_TAGS)).get(pfad) ?? null
    return { ok: true, size: neu.size, mtime: Math.trunc(neu.mtimeMs), roh }
  } catch (err) {
    return nein((err as NodeJS.ErrnoException)?.code ?? 'SCHREIBFEHLER')
  } finally {
    await rm(zwischen, { force: true }).catch(() => {})
  }
}
