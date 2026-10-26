// Führt die E2E-Skripte nacheinander aus (je Skript eine frische App). Ohne Argument alle,
// sonst nur die genannten: `npm run e2e -- smoke netz` (Namen ohne .mjs). Aus der Mottulbox
// übernommen (project_mega/e2e/run.mjs). `paket` (die gepackte App aus dist/) läuft nur auf
// Wunsch – vorher `npm run package:dir`. Der Exit-Code ist 1, sobald ein Schritt fehlschlägt.

const all = ['smoke', 'security', 'netz', 'galerie', 'sortieren', 'originale']
const nurAufWunsch = ['paket']
const wanted = process.argv.slice(2)
const unknown = wanted.filter((n) => !all.includes(n) && !nurAufWunsch.includes(n))
if (unknown.length) {
  console.error(`Unbekannt: ${unknown.join(', ')} (vorhanden: ${all.join(', ')})`)
  process.exit(2)
}

for (const name of wanted.length ? wanted : all) {
  console.log(`\n=== ${name} ===`)
  await import(`./${name}.mjs`)
}
