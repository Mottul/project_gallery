// Sortierschlüssel für Namen – rein, getestet in sortKey.test.ts. Beim Einfügen in den Index
// berechnet (`name_sort`), nicht zur Laufzeit per SQL-Funktion (Skill bibliothek-index).
//
// Ziel (docs/PLAN.md, „Sortieren“): natürlich („Bild 2“ vor „Bild 10“), ohne Groß/Klein, Umlaute
// richtig – nach DIN 5007-1 wie im Telefonbuch: „ä“ wie „a“, „ß“ wie „ss“. Der Schlüssel ist ein
// gewöhnlicher Text, den SQLite mit BINARY vergleicht; Gleichstand entscheidet die Kennung.

/**
 * Zahlen im Schlüssel: Länge als zwei Ziffern vorweg, dann die Ziffern ohne führende Nullen –
 * „2“ → „012“, „10“ → „0210“: kürzere Zahlen sortieren vorn, gleich lange nach Wert. Der Schlüssel
 * besteht weiter nur aus Ziffern; damit bleibt die Reihenfolge wie im Explorer: Leer- und
 * Satzzeichen vor Zahlen, Zahlen vor Buchstaben („a.jpg“ vor „a2.jpg“ vor „ab.jpg“).
 */
function zahl(ziffern: string): string {
  const ohneNullen = ziffern.replace(/^0+(?=\d)/, '')
  return String(Math.min(ohneNullen.length, 99)).padStart(2, '0') + ohneNullen
}

export function nameSortKey(name: string): string {
  return (
    name
      .normalize('NFKD')
      // Akzente und Umlaut-Punkte weg (ä → a, é → e), ß → ss
      .replace(/\p{M}/gu, '')
      .replace(/ß/g, 'ss')
      .toLowerCase()
      // Satz- und Sonderzeichen vor Ziffern und Buchstaben („_“ liegt in ASCII hinter den Ziffern),
      // Leerraum ganz vorn
      .replace(/\s+/g, ' ')
      .replace(/[^\p{L}\p{N} ]/gu, (c) => '!' + c)
      // Zahlenfolgen vergleichbar machen
      .replace(/\d+/g, zahl)
  )
}
