// Netzsperre (Schicht A, docs/PLAN.md): Jede Anfrage der Standard-Sitzung – aus allen Fenstern und
// aus Electrons `net` im main – geht durch anfrageErlaubt (netzRegel.ts). Abgewiesenes landet
// einmal je Ziel im Log (Kurzform ohne Pfad). Die App-Aktualisierung (Phase 5) bekommt eine
// eigene Sitzung mit eigener Allowlist; diese Sperre wird dafür nie gelockert.
//
// Zusätzlich verbieten ESLint (Netz-Module im main) und die CSP der Seite das Netz – die Sperre
// hier greift auch, wenn eine der beiden Ebenen einmal etwas durchließe.

import { session } from 'electron'
import { logLine } from './log'
import { anfrageErlaubt, kurzeAdresse } from './netzRegel'
import type { AppPages } from './windows/windowPolicy'

/** Einmal beim Start, bevor das erste Fenster entsteht. */
export function installNetzsperre(pages: AppPages, eigeneProtokolle: readonly string[] = []): void {
  const gemeldet = new Set<string>()
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, cb) => {
    // Wirft die Regel doch einmal, bliebe die Anfrage ohne Antwort hängen – dann abweisen.
    let ok: boolean
    try {
      ok = anfrageErlaubt(details.url, pages, eigeneProtokolle)
    } catch {
      ok = false
    }
    if (!ok) {
      const ziel = kurzeAdresse(details.url)
      if (!gemeldet.has(ziel)) {
        gemeldet.add(ziel)
        logLine('[netzsperre] abgewiesen:', ziel, `(${details.resourceType})`)
      }
    }
    cb({ cancel: !ok })
  })
}
