// Aus der Mottulbox übernommen (project_mega/src/main/services/reachableDir.ts, Stand 0cc14cb).
// Ist ein Ordner erreichbar? Asynchron und mit Zeitlimit: Ein getrenntes Netzlaufwerk (UNC-Pfad,
// verbundenes Laufwerk) hielte ein statSync unter Windows bis zum SMB-Timeout an – 20 s und mehr,
// und so lange stünden alle Fenster und jede IPC-Anfrage im main. Genutzt von den Datei-Dialogen
// und beim Hinzufügen und Einlesen von Bibliotheksordnern.

import { stat } from 'node:fs/promises'

const TIMEOUT_MS = 2000

/** Laufende Prüfungen je Pfad: Hängt das Netzlaufwerk, belegt nicht jeder Aufruf einen weiteren
 *  der wenigen libuv-Threads, sondern wartet auf dieselbe Prüfung. */
const running = new Map<string, Promise<boolean>>()

export function isDirReachable(path: string, timeoutMs = TIMEOUT_MS): Promise<boolean> {
  let check = running.get(path)
  if (!check) {
    check = stat(path).then(
      (st) => st.isDirectory(),
      () => false
    )
    running.set(path, check)
    void check.finally(() => running.delete(path))
  }
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs)
  })
  return Promise.race([check, timeout]).finally(() => clearTimeout(timer))
}
