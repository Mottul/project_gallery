// Einstieg des Bilddienstes: eigener Prozess (utilityProcess), gestartet von client.ts.
// Eine präparierte Datei, ein abstürzender Dekoder oder ein hängendes Netzlaufwerk trifft so nur
// diesen Prozess – main und Fenster laufen weiter (docs/PLAN.md, „Bildarbeit im eigenen Prozess“).
// Ab 1.2/1.3 kommen ExifTool und sharp hierher. Für den Dienst gelten dieselben Lint-Regeln wie
// für den main (kein Netz).

import type { AnDienst, VomDienst } from './protokoll'
import { STAPEL } from './protokoll'
import { scanne } from './scan'

const port = process.parentPort
const abgebrochen = new Set<number>()

function senden(n: VomDienst): void {
  port.postMessage(n)
}

async function scan(auftrag: number, wurzel: string): Promise<void> {
  try {
    const r = await scanne(wurzel, (dateien) => senden({ typ: 'stapel', auftrag, dateien }), {
      stapelGroesse: STAPEL,
      abgebrochen: () => abgebrochen.has(auftrag)
    })
    senden({ typ: 'fertig', auftrag, gefunden: r.gefunden, unlesbar: r.unlesbar })
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    senden({
      typ: 'fehler',
      auftrag,
      code: e?.code ?? 'UNBEKANNT',
      meldung: String(e?.message ?? err)
    })
  } finally {
    abgebrochen.delete(auftrag)
  }
}

port.on('message', (e: { data: AnDienst }) => {
  const n = e.data
  if (n.typ === 'scan') void scan(n.auftrag, n.wurzel)
  else if (n.typ === 'abbrechen') abgebrochen.add(n.auftrag)
})

senden({ typ: 'log', text: `Bilddienst bereit (pid ${process.pid})` })
