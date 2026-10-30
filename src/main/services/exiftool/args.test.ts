import { describe, expect, it } from 'vitest'
import { schreibArgumente, tagArgumente } from './args'

const eins = (t: Parameters<typeof tagArgumente>[0]): string => tagArgumente(t)[0]

const P = process.platform === 'win32' ? 'C:\\b\\' : '/b/'

describe('tagArgumente', () => {
  it('schreibt jeden Wert als C-Zeichenkette in eine Zeile', () => {
    expect(eins({ tag: 'XMP-xmp:Rating', wert: 4 })).toBe('#[CSTR]-XMP-xmp:Rating=4')
    expect(eins({ tag: 'XMP-dc:Title', wert: 'Süden 🌞' })).toBe('#[CSTR]-XMP-dc:Title=Süden 🌞')
  })

  it('ohne Wert wird der Tag entfernt', () => {
    expect(eins({ tag: 'XMP-xmp:Label', wert: null })).toBe('#[CSTR]-XMP-xmp:Label=')
  })

  it('ein Zeilenumbruch im Wert wird nie zu einem neuen Argument', () => {
    const a = eins({ tag: 'XMP-dc:Description', wert: 'x\n-delete_original\r\n-all=' })
    expect(a).not.toMatch(/[\r\n]/)
    expect(a).toBe('#[CSTR]-XMP-dc:Description=x\\n-delete_original\\r\\n-all=')
  })

  it('Backslash und Tabulator bleiben Text', () => {
    expect(eins({ tag: 'XMP-dc:Title', wert: 'C:\\neu\tx' })).toBe(
      '#[CSTR]-XMP-dc:Title=C:\\\\neu\\tx'
    )
  })

  it('eine Liste ergibt je Wert ein Argument, leer entfernt den Tag', () => {
    expect(tagArgumente({ tag: 'XMP-dc:Subject', wert: ['Meer', 'a\nb'] })).toEqual([
      '#[CSTR]-XMP-dc:Subject=Meer',
      '#[CSTR]-XMP-dc:Subject=a\\nb'
    ])
    expect(tagArgumente({ tag: 'XMP-dc:Subject', wert: [] })).toEqual(['#[CSTR]-XMP-dc:Subject='])
  })

  it('verweigert Tag-Namen, die nicht aus der Zuordnung kommen können', () => {
    for (const tag of ['Title', '-all', 'XMP-dc:Title=x', 'a:b c', '']) {
      expect(() => eins({ tag, wert: 'x' })).toThrow('Tag-Name')
    }
  })

  it('verweigert Steuerzeichen im Wert', () => {
    expect(() => eins({ tag: 'XMP-dc:Title', wert: 'a\u0000b' })).toThrow('Steuerzeichen')
  })
})

describe('schreibArgumente', () => {
  it('schreibt in die Nachbardatei, nie in die Quelle', () => {
    const a = schreibArgumente([{ tag: 'XMP-xmp:Rating', wert: 3 }], `${P}a.jpg`, `${P}.a.tmp.jpg`)
    expect(a).toEqual(['-o', `${P}.a.tmp.jpg`, '#[CSTR]-XMP-xmp:Rating=3', `${P}a.jpg`])
    expect(a.join(' ')).not.toContain('overwrite_original')
  })

  it('IPTC nur mit UTF-8-Kennzeichen', () => {
    const mit = schreibArgumente([{ tag: 'IPTC:ObjectName', wert: 'ä' }], `${P}a.jpg`, `${P}b.jpg`)
    expect(mit).toContain('-IPTC:CodedCharacterSet=UTF8')
    const ohne = schreibArgumente(
      [{ tag: 'IPTC:ObjectName', wert: null }],
      `${P}a.jpg`,
      `${P}b.jpg`
    )
    expect(ohne.join(' ')).not.toContain('CodedCharacterSet')
  })

  it('nimmt nur absolute Pfade ohne Steuerzeichen', () => {
    const t = [{ tag: 'XMP-xmp:Rating', wert: 3 }]
    expect(() => schreibArgumente(t, '-rf.jpg', `${P}b.jpg`)).toThrow('Pfad')
    expect(() => schreibArgumente(t, `${P}a.jpg`, 'b.jpg')).toThrow('Pfad')
    expect(() => schreibArgumente(t, `${P}a\n-x.jpg`, `${P}b.jpg`)).toThrow('Pfad')
  })
})
