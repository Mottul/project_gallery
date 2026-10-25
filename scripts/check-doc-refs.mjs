// Aus der Mottulbox übernommen (project_mega/scripts/check-doc-refs.mjs, Stand 0cc14cb), ergänzt um
// die Liste geplanter Dateien.
//
// Prüft, ob die Dateien, die CLAUDE.md, README, docs/ und die Projekt-Skills nennen, noch existieren.
// Nach dem Verschieben oder Umbenennen zeigten sie sonst still ins Leere – und Skills leiten
// künftige Arbeit an die falsche Stelle.
// Geprüft wird jeder Verweis in Backticks mit Dateiendung: voller Pfad, Teilpfad (`ffmpeg/x.ts`
// passt auf src/main/services/ffmpeg/x.ts) oder bloßer Dateiname irgendwo im Repository.
//
// Plan und Skills beschreiben Dateien, die erst in späteren Phasen entstehen („geplant“), und
// nennen Vorbilder in der Mottulbox oder Dateien nur im Release („anderswo“). Beide stehen in
// geplante-dateien.json und gelten als vorhanden. Gibt es eine geplante inzwischen, meldet die
// Prüfung das – dann den Eintrag streichen, damit die Liste nur Offenes zeigt.
// Aufruf: npm run check:refs (läuft auch in der CI). Ohne Treffer still, sonst Liste und Code 1.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REF = /`(@?[\w./-]+\.(?:tsx?|mjs|cjs|js|json|md|ya?ml|css|html|nsh|wsb))`/g
const ALIAS = [
  ['@shared/', 'src/shared/'],
  ['@renderer/', 'src/renderer/src/']
]
/** Gibt es nur zur Laufzeit, im Build oder in einem Paket – nicht im Repository */
const ELSEWHERE = new Set([
  'settings.json', // userData
  'testbilder.json', // erzeugte Testbibliothek (scripts/testbilder.mjs)
  'install.js' // node_modules/electron
])

/** Passt der Verweis auf eine der Dateien? (voller Pfad, Teilpfad oder bloßer Name) */
export function refFound(raw, files, names = new Set(files.map((f) => basename(f)))) {
  let ref = raw.replace(/^\.\//, '')
  for (const [from, to] of ALIAS) if (ref.startsWith(from)) ref = to + ref.slice(from.length)
  return ref.includes('/') ? files.some((f) => f === ref || f.endsWith('/' + ref)) : names.has(ref)
}

/** Verweise eines Textes, die auf keine der Dateien passen; leer = alles gut. */
export function findMissing(text, files) {
  const names = new Set(files.map((f) => basename(f)))
  const missing = []
  for (const [, raw] of text.matchAll(REF)) {
    if (ELSEWHERE.has(raw)) continue
    if (!refFound(raw, files, names) && !missing.includes(raw)) missing.push(raw)
  }
  return missing
}

/** Geplante Verweise, die es inzwischen gibt (Eintrag in geplante-dateien.json streichen). */
export function findDone(planned, files) {
  return planned.filter((raw) => refFound(raw, files))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // auch neue, noch nicht vorgemerkte Dateien: sonst prüft der lokale Lauf ein frisch angelegtes
  // Skill nicht, und erst die CI meldet seine Verweise
  const out = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { encoding: 'utf8', maxBuffer: 64 << 20 }
  )
  const files = out.split('\0').filter(Boolean)
  const liste = JSON.parse(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'geplante-dateien.json'), 'utf8')
  )
  const planned = liste.geplant
  const known = new Set([...planned, ...liste.anderswo])
  const docs = files.filter(
    (f) =>
      f === 'CLAUDE.md' ||
      f === 'README.md' ||
      /^docs\/[^/]+\.md$/.test(f) ||
      /^\.claude\/skills\/[^/]+\/SKILL\.md$/.test(f)
  )
  const problems = []
  for (const doc of docs) {
    const missing = findMissing(readFileSync(doc, 'utf8'), files).filter(
      // Pfade in Paketen (z. B. electron/checksums.json) zählen als vorhanden
      (ref) => !existsSync(join('node_modules', ref)) && !known.has(ref)
    )
    for (const ref of missing) problems.push(`${doc}: \`${ref}\``)
  }
  for (const ref of findDone(planned, files)) {
    problems.push(`scripts/geplante-dateien.json: \`${ref}\` gibt es jetzt – Eintrag streichen`)
  }
  if (problems.length) {
    console.error('Verweise auf Dateien, die es nicht (mehr) gibt:')
    for (const p of problems) console.error('  ' + p)
    process.exit(1)
  }
}
