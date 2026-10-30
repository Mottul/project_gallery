import { describe, expect, it } from 'vitest'
import {
  abweichend,
  alteWerte,
  BESCHREIBUNG_MAX,
  leseSchluessel,
  pruefeMetaAenderung,
  schreibbar,
  tagsFuer,
  TITEL_MAX
} from './metaFields'

const namen = (t: { tag: string }[]): string[] => t.map((x) => x.tag)

describe('tagsFuer', () => {
  it('Bewertung: XMP und EXIF, für Windows auch in Prozent', () => {
    expect(tagsFuer({ bewertung: 4 }, 'jpeg')).toEqual([
      { tag: 'XMP-xmp:Rating', wert: 4 },
      { tag: 'EXIF:Rating', wert: 4 },
      { tag: 'EXIF:RatingPercent', wert: 75 }
    ])
    expect(tagsFuer({ bewertung: 1 }, 'jpeg')[2].wert).toBe(1)
    expect(tagsFuer({ bewertung: 5 }, 'jpeg')[2].wert).toBe(99)
  })

  it('Bewertung 0 entfernt die Tags, statt „0 Sterne“ zu schreiben', () => {
    expect(tagsFuer({ bewertung: 0 }, 'jpeg').map((t) => t.wert)).toEqual([null, null, null])
  })

  it('schreibt je Format nur, was es kann', () => {
    const titel = { titel: 'x' }
    expect(namen(tagsFuer(titel, 'jpeg'))).toEqual([
      'XMP-dc:Title',
      'IPTC:ObjectName',
      'EXIF:XPTitle'
    ])
    expect(namen(tagsFuer(titel, 'png'))).toEqual(['XMP-dc:Title', 'EXIF:XPTitle'])
    expect(namen(tagsFuer(titel, 'gif'))).toEqual(['XMP-dc:Title'])
    expect(tagsFuer(titel, 'bmp')).toEqual([])
  })

  it('Text zu lang für IPTC: dort entfernen statt abschneiden', () => {
    const lang = 'ä'.repeat(40) // 80 Bytes, IPTC erlaubt 64
    const t = tagsFuer({ titel: lang }, 'jpeg')
    expect(t.find((x) => x.tag === 'IPTC:ObjectName')?.wert).toBeNull()
    expect(t.find((x) => x.tag === 'XMP-dc:Title')?.wert).toBe(lang)
    const passt = 'a'.repeat(64)
    expect(tagsFuer({ titel: passt }, 'jpeg')[1].wert).toBe(passt)
  })

  it('Emoji fehlen nur in den XP-Feldern, die sie nicht speichern können', () => {
    const t = tagsFuer({ titel: 'Sonne 🌞' }, 'jpeg')
    expect(t.find((x) => x.tag === 'XMP-dc:Title')?.wert).toBe('Sonne 🌞')
    expect(t.find((x) => x.tag === 'EXIF:XPTitle')?.wert).toBe('Sonne')
    const nurEmoji = tagsFuer({ titel: '🌞' }, 'jpeg')
    expect(nurEmoji.find((x) => x.tag === 'EXIF:XPTitle')?.wert).toBeNull()
  })

  it('Beschreibung auch als Kommentar für den Explorer', () => {
    expect(namen(tagsFuer({ beschreibung: 'x' }, 'jpeg'))).toContain('EXIF:XPComment')
  })

  it('ein Feld, das nicht genannt ist, bleibt unberührt', () => {
    expect(tagsFuer({}, 'jpeg')).toEqual([])
    expect(namen(tagsFuer({ farblabel: 'Red' }, 'jpeg'))).toEqual(['XMP-xmp:Label'])
  })
})

describe('schreibbar', () => {
  it('kennt die gemessenen Formate', () => {
    for (const f of ['jpeg', 'png', 'webp', 'avif', 'tiff', 'gif']) expect(schreibbar(f)).toBe(true)
    for (const f of ['bmp', 'svg', 'constructor', null]) expect(schreibbar(f)).toBe(false)
  })
})

describe('abweichend', () => {
  it('Tag-Gruppe wie in der Ausgabe von -G0', () => {
    expect(leseSchluessel('XMP-dc:Title')).toBe('XMP:Title')
    expect(leseSchluessel('EXIF:Rating')).toBe('EXIF:Rating')
  })

  it('vergleicht Text und Zahl, entfernte Tags dürfen fehlen', () => {
    const soll = [
      { tag: 'XMP-xmp:Rating', wert: 4 },
      { tag: 'XMP-dc:Title', wert: 'Zürich' },
      { tag: 'XMP-xmp:Label', wert: null }
    ]
    expect(abweichend(soll, { 'XMP:Rating': 4, 'XMP:Title': 'Zürich' })).toEqual([])
    expect(abweichend(soll, { 'XMP:Rating': '4', 'XMP:Title': 'Zürich', 'XMP:Label': '' })).toEqual(
      []
    )
  })

  it('zahlenartiger Text bleibt gleich, auch wenn ExifTool ihn als Zahl ausgibt', () => {
    expect(abweichend([{ tag: 'XMP-dc:Title', wert: '1.50' }], { 'XMP:Title': 1.5 })).toEqual([])
  })

  it('findet falsche, fehlende und übrig gebliebene Werte', () => {
    const soll = [
      { tag: 'XMP-xmp:Rating', wert: 4 },
      { tag: 'XMP-dc:Title', wert: 'x' },
      { tag: 'XMP-xmp:Label', wert: null }
    ]
    expect(abweichend(soll, { 'XMP:Rating': 3, 'XMP:Label': 'Red' })).toEqual([
      'XMP-xmp:Rating',
      'XMP-dc:Title',
      'XMP-xmp:Label'
    ])
  })
})

describe('alteWerte', () => {
  it('nimmt je Tag den Wert der Datei, fehlende als null', () => {
    const tags = [
      { tag: 'XMP-xmp:Rating', wert: 4 },
      { tag: 'XMP-dc:Title', wert: 'neu' },
      { tag: 'XMP-xmp:Label', wert: 'Red' }
    ]
    expect(alteWerte(tags, { 'XMP:Rating': 2, 'XMP:Title': 'alt' })).toEqual([
      { tag: 'XMP-xmp:Rating', wert: 2 },
      { tag: 'XMP-dc:Title', wert: 'alt' },
      { tag: 'XMP-xmp:Label', wert: null }
    ])
  })
})

describe('pruefeMetaAenderung', () => {
  it('lässt Gültiges durch', () => {
    expect(pruefeMetaAenderung({ bewertung: 0 })).toEqual({ bewertung: 0 })
    expect(pruefeMetaAenderung({ bewertung: 5, farblabel: 'Red' })).toEqual({
      bewertung: 5,
      farblabel: 'Red'
    })
    expect(pruefeMetaAenderung({ farblabel: null })).toEqual({ farblabel: null })
    expect(pruefeMetaAenderung({ titel: ' Hafen ' })).toEqual({ titel: 'Hafen' })
    expect(pruefeMetaAenderung({ beschreibung: 'a\nb\tc' })).toEqual({ beschreibung: 'a\nb\tc' })
  })

  it('leerer Text heißt: Feld entfernen', () => {
    expect(pruefeMetaAenderung({ titel: '   ' })).toEqual({ titel: null })
  })

  it.each([
    ['kein Objekt', 'x'],
    ['Liste', []],
    ['nichts geändert', {}],
    ['fremdes Feld', { rating: 3 }],
    ['Tag-Name', { 'XMP-dc:Title': 'x' }],
    ['Bewertung zu hoch', { bewertung: 6 }],
    ['Bewertung negativ', { bewertung: -1 }],
    ['Bewertung krumm', { bewertung: 2.5 }],
    ['Bewertung Text', { bewertung: '3' }],
    ['fremdes Label', { farblabel: 'Pink' }],
    ['Titel zu lang', { titel: 'x'.repeat(TITEL_MAX + 1) }],
    ['Zeilenumbruch im Titel', { titel: 'a\nb' }],
    ['Steuerzeichen im Titel', { titel: 'a\u0000b' }],
    ['Beschreibung zu lang', { beschreibung: 'x'.repeat(BESCHREIBUNG_MAX + 1) }],
    ['Steuerzeichen in der Beschreibung', { beschreibung: 'a\u0007b' }],
    ['Titel keine Zeichenkette', { titel: 5 }]
  ])('lehnt ab: %s', (_n, v) => {
    expect(pruefeMetaAenderung(v)).toBeNull()
  })
})
