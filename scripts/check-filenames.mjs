// Aus der Mottulbox übernommen (project_mega/scripts/check-filenames.mjs, Stand 0cc14cb).
// Prüft die Dateinamen im Repository auf das, was ein Auschecken unter Windows oder macOS kaputt
// macht (beide unterscheiden Groß-/Kleinschreibung standardmäßig nicht):
// - zwei Pfade, die sich nur in der Schreibweise unterscheiden – auf der Platte kann nur einer
//   liegen, Git meldet den anderen dann dauernd als geändert (so geschehen mit
//   assets/brand/MottulBox-Logo.svg neben mottulbox-logo.svg in der Mottulbox, dort PR #130)
// - Namen, die Windows nicht anlegen kann: reservierte Gerätenamen (CON, AUX, COM1 …, auch mit
//   Endung), die Zeichen < > : " | ? * und ein Punkt oder Leerzeichen am Ende
// Aufruf: npm run check:files (läuft auch in der CI). Ohne Treffer still, sonst Liste und Code 1.

import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i
const BAD_CHARS = /[<>:"|?*\x00-\x1f]/

/** Probleme einer Pfadliste (Git-Schreibweise mit „/“); leer = alles gut. */
export function findProblems(paths) {
  const problems = []
  const byLower = new Map()
  for (const p of paths) {
    const key = p.toLowerCase()
    byLower.set(key, [...(byLower.get(key) ?? []), p])
    for (const part of p.split('/')) {
      if (RESERVED.test(part)) problems.push(`${p}: „${part}“ ist unter Windows ein Gerätename`)
      else if (BAD_CHARS.test(part)) problems.push(`${p}: Zeichen, das Windows nicht erlaubt`)
      else if (/[. ]$/.test(part)) problems.push(`${p}: „${part}“ endet mit Punkt oder Leerzeichen`)
    }
  }
  for (const same of byLower.values()) {
    if (same.length > 1) problems.push(`nur in der Schreibweise verschieden: ${same.join(' ↔ ')}`)
  }
  // Ordner zählen mit: a/Bild.png neben A/bild.png stößt schon beim Ordner zusammen
  const dirs = new Map()
  for (const p of paths) {
    const parts = p.split('/')
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/')
      const key = dir.toLowerCase()
      const seen = dirs.get(key) ?? new Set()
      seen.add(dir)
      dirs.set(key, seen)
    }
  }
  for (const same of dirs.values()) {
    if (same.size > 1)
      problems.push(`Ordner nur in der Schreibweise verschieden: ${[...same].join(' ↔ ')}`)
  }
  return problems
}

// nur als Programm prüfen, nicht beim Import (findProblems ist auch einzeln nutzbar)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 << 20 })
  const problems = findProblems(out.split('\0').filter(Boolean))
  if (problems.length) {
    console.error('Dateinamen, die sich unter Windows/macOS nicht sauber auschecken lassen:')
    for (const p of problems) console.error('  ' + p)
    process.exit(1)
  }
}
