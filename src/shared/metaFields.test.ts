import { describe, expect, it } from 'vitest'
import {
  abweichend,
  alteWerte,
  BESCHREIBUNG_MAX,
  COPYRIGHT_MAX,
  leseSchluessel,
  ORT_MAX,
  pruefeMetaAenderung,
  schreibbar,
  tagsFuer,
  TITEL_MAX,
  URHEBER_MAX,
  werteAus,
  WERTE_TAGS
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

describe('tagsFuer: weitere Felder', () => {
  const wert = (t: { tag: string; wert: unknown }[], tag: string): unknown =>
    t.find((x) => x.tag === tag)?.wert

  it('Stichwörter überall als ganze Liste; IPTC ohne zu lange, XP ohne Emoji', () => {
    const lang = 'x'.repeat(65)
    const t = tagsFuer({ stichwoerter: ['Meer', lang, 'Sonne 🌞'] }, 'jpeg')
    expect(wert(t, 'XMP-dc:Subject')).toEqual(['Meer', lang, 'Sonne 🌞'])
    expect(wert(t, 'IPTC:Keywords')).toEqual(['Meer', 'Sonne 🌞'])
    expect(wert(t, 'EXIF:XPKeywords')).toBe(`Meer;${lang}`)
  })

  it('leere Liste entfernt die Stichwörter aus allen Quellen', () => {
    expect(tagsFuer({ stichwoerter: [] }, 'jpeg').map((x) => x.wert)).toEqual([null, null, null])
  })

  it('Datum: EXIF und XMP, Zone bleibt, alte Sekundenbruchteile gehen weg', () => {
    const t = tagsFuer({ aufnahme: { lokal: '2021-06-05T14:03:02', offset: '+02:00' } }, 'jpeg')
    expect(wert(t, 'EXIF:DateTimeOriginal')).toBe('2021:06:05 14:03:02')
    expect(wert(t, 'EXIF:CreateDate')).toBe('2021:06:05 14:03:02')
    expect(wert(t, 'EXIF:OffsetTimeOriginal')).toBe('+02:00')
    expect(wert(t, 'EXIF:SubSecTimeOriginal')).toBeNull()
    expect(wert(t, 'XMP-photoshop:DateCreated')).toBe('2021:06:05 14:03:02+02:00')
  })

  it('Datum im GIF nur in XMP', () => {
    const t = tagsFuer({ aufnahme: { lokal: '2021-06-05T14:03:02', offset: null } }, 'gif')
    expect(t).toEqual([{ tag: 'XMP-photoshop:DateCreated', wert: '2021:06:05 14:03:02' }])
  })

  it('Standort: Betrag und Himmelsrichtung, in XMP mit Vorzeichen, alte Höhe weg', () => {
    const t = tagsFuer({ standort: { breite: -33.5, laenge: -70.25 } }, 'jpeg')
    expect(wert(t, 'EXIF:GPSLatitude')).toBe(33.5)
    expect(wert(t, 'EXIF:GPSLatitudeRef')).toBe('S')
    expect(wert(t, 'EXIF:GPSLongitude')).toBe(70.25)
    expect(wert(t, 'EXIF:GPSLongitudeRef')).toBe('W')
    expect(wert(t, 'XMP-exif:GPSLatitude')).toBe(-33.5)
    expect(wert(t, 'EXIF:GPSAltitude')).toBeNull()
  })

  it('Standort entfernen nimmt den ganzen GPS-Block, nicht nur die Koordinaten', () => {
    const t = tagsFuer({ standort: null }, 'jpeg')
    expect(t.every((x) => x.wert === null)).toBe(true)
    for (const tag of ['GPSImgDirection', 'GPSDateStamp', 'GPSTimeStamp', 'GPSProcessingMethod']) {
      expect(t.map((x) => x.tag)).toContain(`EXIF:${tag}`)
    }
    expect(t.map((x) => x.tag)).toContain('XMP-exif:GPSLatitude')
  })

  it('Land: Ein alter Ländercode geht mit', () => {
    const t = tagsFuer({ land: 'Kroatien' }, 'jpeg')
    expect(wert(t, 'XMP-photoshop:Country')).toBe('Kroatien')
    expect(wert(t, 'XMP-iptcCore:CountryCode')).toBeNull()
    expect(wert(t, 'IPTC:Country-PrimaryLocationCode')).toBeNull()
  })

  it('Grenzen von IPTC je Feld', () => {
    expect(wert(tagsFuer({ ort: 'x'.repeat(33) }, 'jpeg'), 'IPTC:City')).toBeNull()
    expect(wert(tagsFuer({ urheber: 'x'.repeat(33) }, 'jpeg'), 'IPTC:By-line')).toBeNull()
    const c = 'x'.repeat(128)
    expect(wert(tagsFuer({ copyright: c }, 'jpeg'), 'IPTC:CopyrightNotice')).toBe(c)
  })
})

describe('WERTE_TAGS', () => {
  it('liest alles, was geschrieben werden kann, und den berechneten Standort', () => {
    const tags = WERTE_TAGS.map((t) => t.tag)
    expect(tags).toContain('XMP-dc:Creator')
    expect(tags).toContain('EXIF:GPSImgDirection')
    expect(tags).toContain('Composite:GPSLatitude')
    expect(new Set(tags).size).toBe(tags.length)
  })
})

describe('werteAus', () => {
  it('nimmt die Felder in der Rangfolge des Index und behält Zeilenumbrüche', () => {
    const w = werteAus({
      'XMP:Rating': 4,
      'XMP:Label': 'Red',
      'XMP:Title': 'XMP',
      'IPTC:ObjectName': 'IPTC',
      'EXIF:ImageDescription': 'a\nb',
      'XMP:Subject': ['Meer', 'Süden'],
      'IPTC:Keywords': 'Süden',
      'EXIF:DateTimeOriginal': '2021:06:05 14:03:02',
      'EXIF:OffsetTimeOriginal': '+02:00',
      'Composite:GPSLatitude': 42.5,
      'Composite:GPSLongitude': 18.5,
      'IPTC:City': 'Split',
      'XMP:Creator': ['Eine', 'Andere'],
      'EXIF:Copyright': '© x'
    })
    expect(w).toEqual({
      bewertung: 4,
      farblabel: 'Red',
      titel: 'XMP',
      beschreibung: 'a\nb',
      stichwoerter: ['Meer', 'Süden'],
      aufnahme: { lokal: '2021-06-05T14:03:02', offset: '+02:00' },
      standort: { breite: 42.5, laenge: 18.5 },
      ort: 'Split',
      region: null,
      land: null,
      ortsteil: null,
      urheber: 'Eine; Andere',
      copyright: '© x'
    })
  })

  it('leere Datei: nichts erfunden', () => {
    expect(werteAus({})).toMatchObject({
      bewertung: 0,
      titel: null,
      stichwoerter: [],
      aufnahme: null,
      standort: null
    })
  })

  it('unbrauchbare Werte fallen weg', () => {
    const w = werteAus({ 'XMP:Rating': 9, 'EXIF:DateTimeOriginal': '0000:00:00 00:00:00' })
    expect(w.bewertung).toBe(0)
    expect(w.aufnahme).toBeNull()
  })

  it('nimmt das Datum aus XMP, wenn EXIF keins hat, ohne Sekundenbruchteile', () => {
    const w = werteAus({ 'XMP:DateCreated': '2021:06:05 14:03:02.125+02:00' })
    expect(w.aufnahme).toEqual({ lokal: '2021-06-05T14:03:02', offset: '+02:00' })
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

  it('vergleicht Listen genau, ein einzelner Wert kommt als Text', () => {
    const soll = [{ tag: 'XMP-dc:Subject', wert: ['a', 'b'] }]
    expect(abweichend(soll, { 'XMP:Subject': ['a', 'b'] })).toEqual([])
    expect(abweichend(soll, { 'XMP:Subject': ['a'] })).toEqual(['XMP-dc:Subject'])
    expect(abweichend([{ tag: 'XMP-dc:Subject', wert: ['a'] }], { 'XMP:Subject': 'a' })).toEqual([])
  })

  it('Koordinaten dürfen um Rundungsfehler abweichen, mehr nicht', () => {
    const soll = [{ tag: 'EXIF:GPSLatitude', wert: 42.65 }]
    expect(abweichend(soll, { 'EXIF:GPSLatitude': 42.6500001 })).toEqual([])
    expect(abweichend(soll, { 'EXIF:GPSLatitude': 42.66 })).toEqual(['EXIF:GPSLatitude'])
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

describe('alteWerte mit Listen', () => {
  it('behält mehrere Werte', () => {
    expect(alteWerte([{ tag: 'XMP-dc:Subject', wert: [] }], { 'XMP:Subject': ['a', 'b'] })).toEqual(
      [{ tag: 'XMP-dc:Subject', wert: ['a', 'b'] }]
    )
  })
})

describe('pruefeMetaAenderung: weitere Felder', () => {
  const zeit = { lokal: '2021-06-05T14:03:02', offset: '+02:00' }

  it('lässt Gültiges durch', () => {
    const a = {
      stichwoerter: ['Meer', 'Süden'],
      aufnahme: zeit,
      standort: { breite: -33.5, laenge: 151.25 },
      ort: 'Köln',
      region: null,
      land: 'Deutschland',
      ortsteil: 'Altstadt',
      urheber: 'Ich',
      copyright: '© Ich'
    }
    expect(pruefeMetaAenderung(a)).toEqual(a)
    expect(pruefeMetaAenderung({ stichwoerter: [] })).toEqual({ stichwoerter: [] })
    expect(pruefeMetaAenderung({ aufnahme: null, standort: null })).toEqual({
      aufnahme: null,
      standort: null
    })
  })

  it('Stichwörter ohne Doppelte, Rand-Leerzeichen weg', () => {
    expect(pruefeMetaAenderung({ stichwoerter: [' Meer ', 'meer', 'Süden'] })).toEqual({
      stichwoerter: ['Meer', 'Süden']
    })
  })

  it.each([
    ['Stichwörter keine Liste', { stichwoerter: 'Meer' }],
    ['leeres Stichwort', { stichwoerter: [' '] }],
    ['Semikolon im Stichwort', { stichwoerter: ['a;b'] }],
    ['Zeilenumbruch im Stichwort', { stichwoerter: ['a\nb'] }],
    ['zu langes Stichwort', { stichwoerter: ['x'.repeat(101)] }],
    ['zu viele Stichwörter', { stichwoerter: Array.from({ length: 201 }, (_, i) => `w${i}`) }],
    ['Datum als Text', { aufnahme: '2021-06-05' }],
    ['Datum in falscher Form', { aufnahme: { lokal: '05.06.2021', offset: null } }],
    ['31. Februar', { aufnahme: { lokal: '2021-02-31T10:00:00', offset: null } }],
    ['vor der Fotografie', { aufnahme: { lokal: '1700-01-01T10:00:00', offset: null } }],
    ['Zukunft', { aufnahme: { lokal: '2999-01-01T10:00:00', offset: null } }],
    ['Zone falsch', { aufnahme: { ...zeit, offset: 'MESZ' } }],
    ['Breite zu groß', { standort: { breite: 91, laenge: 0 } }],
    ['Länge zu groß', { standort: { breite: 0, laenge: 181 } }],
    ['0/0', { standort: { breite: 0, laenge: 0 } }],
    ['Koordinate als Text', { standort: { breite: '1', laenge: 2 } }],
    ['keine Zahl', { standort: { breite: NaN, laenge: 2 } }],
    ['Ort zu lang', { ort: 'x'.repeat(ORT_MAX + 1) }],
    ['Zeilenumbruch im Ort', { ort: 'a\nb' }],
    ['Urheber zu lang', { urheber: 'x'.repeat(URHEBER_MAX + 1) }],
    ['Copyright zu lang', { copyright: 'x'.repeat(COPYRIGHT_MAX + 1) }],
    ['geerbter Name', { constructor: 'x' }]
  ])('lehnt ab: %s', (_n, v) => {
    expect(pruefeMetaAenderung(v)).toBeNull()
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
