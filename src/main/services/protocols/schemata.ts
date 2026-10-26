// Eigene Protokolle der App – einmal vor `app.whenReady()` anmelden (Electron erlaubt nur einen
// Aufruf von registerSchemesAsPrivileged). Jedes steht auch in der Netzsperre und in der CSP
// (src/renderer/index.html) – sonst nirgends (Skill ipc-kanal).

import { protocol } from 'electron'
import { BILD_PROTOKOLL } from '@shared/bild'
import { THUMB_PROTOKOLL } from '@shared/vorschau'

export const EIGENE_PROTOKOLLE: readonly string[] = [THUMB_PROTOKOLL, BILD_PROTOKOLL]

export function eigeneSchemataAnmelden(): void {
  protocol.registerSchemesAsPrivileged([
    // sicheres Standard-Protokoll: <img> in der App-Seite
    { scheme: THUMB_PROTOKOLL, privileges: { standard: true, secure: true } },
    // dazu als Datenstrom (große Originale, später Videos mit Range-Anfragen)
    { scheme: BILD_PROTOKOLL, privileges: { standard: true, secure: true, stream: true } }
  ])
}
