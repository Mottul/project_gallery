// Aus der Mottulbox übernommen (project_mega/src/shared/settingsMerge.ts, Stand 0cc14cb).
// Einstellungen verlustfrei zusammenführen – rein, im main-Prozess genutzt und getestet.
//
// Objekte (player, osc, remoteControls …) werden Feld für Feld zusammengeführt, Listen und
// einfache Werte ersetzt, `undefined` ignoriert. So überschreibt eine Teiländerung nie, was
// sie gar nicht ändern wollte – auch nicht, wenn ein Fenster mit veraltetem Stand schreibt.
// Passt der Typ nicht (Objekt/Liste erwartet, etwas anderes geliefert), bleibt der bisherige
// Wert: eine kaputte Datei oder ein fehlerhafter Aufruf zerlegt keinen ganzen Bereich.
// Karten mit löschbaren Schlüsseln deshalb als Liste speichern (Listen werden ersetzt).

/** Keine Schlüssel, die den Prototyp verbiegen könnten. */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

export function mergeSettings<T>(base: T, overlay: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(overlay)) return base
  const out: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(overlay)) {
    if (value === undefined || UNSAFE_KEYS.has(key)) continue
    const current = out[key]
    if (isPlainObject(current)) {
      if (isPlainObject(value)) out[key] = mergeSettings(current, value)
    } else if (Array.isArray(current)) {
      if (Array.isArray(value)) out[key] = value
    } else {
      out[key] = value
    }
  }
  return out as T
}
