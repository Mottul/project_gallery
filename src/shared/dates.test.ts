import { describe, expect, it } from 'vitest'
import { aufnahmeDatum, dateiDatum, leseDatum, lokalAusMs, zoneNormal } from './dates'

const JETZT = Date.UTC(2026, 9, 25, 12, 0, 0)
const DATEI = { btime: Date.UTC(2026, 9, 1, 10, 0, 0), mtime: Date.UTC(2026, 9, 2, 10, 0, 0) }

describe('leseDatum', () => {
  it('liest EXIF-Datum als lokale Zeit, ohne Zone zu verrechnen', () => {
    expect(leseDatum('2024:07:14 18:30:05', { jetzt: JETZT })).toEqual({
      lokal: '2024-07-14T18:30:05',
      offset: null
    })
    expect(leseDatum('2024:07:14 18:30:05', { zone: '+02:00', jetzt: JETZT })).toEqual({
      lokal: '2024-07-14T18:30:05',
      offset: '+02:00'
    })
  })

  it('nimmt Sekundenbruchteile und Zonen in mehreren Schreibweisen', () => {
    expect(leseDatum('2024:07:14 18:30:05', { subsec: '07', jetzt: JETZT })?.lokal).toBe(
      '2024-07-14T18:30:05.070'
    )
    expect(leseDatum('2024:07:14 18:30:05.5+0200', { jetzt: JETZT })).toEqual({
      lokal: '2024-07-14T18:30:05.500',
      offset: '+02:00'
    })
    expect(leseDatum('2024:07:14 18:30:05Z', { jetzt: JETZT })?.offset).toBe('+00:00')
    expect(leseDatum('2024:07:14 18:30:05', { subsec: 0, jetzt: JETZT })?.lokal).toBe(
      '2024-07-14T18:30:05'
    )
  })

  it('XMP ohne Uhrzeit oder ohne Sekunden', () => {
    expect(leseDatum('2024:07:14', { jetzt: JETZT })?.lokal).toBe('2024-07-14T00:00:00')
    expect(leseDatum('2024:07:14 18:30', { jetzt: JETZT })?.lokal).toBe('2024-07-14T18:30:00')
  })

  it('verwirft Unsinn, Nullen, zu frühe und zukünftige Daten', () => {
    for (const t of [
      '0000:00:00 00:00:00',
      '    :  :     :  :  ',
      '1800:01:01 00:00:00',
      '2024:02:30 10:00:00',
      '2024:13:01 10:00:00',
      '2024:07:14 25:00:00',
      '2030:01:01 00:00:00',
      'gestern',
      '',
      42,
      null,
      undefined
    ]) {
      expect(leseDatum(t, { jetzt: JETZT }), String(t)).toBeNull()
    }
    // heute (auch mit großem Zonenabstand) gilt noch
    expect(leseDatum('2026:10:26 10:00:00', { jetzt: JETZT })).not.toBeNull()
  })
})

describe('zoneNormal', () => {
  it('vereinheitlicht und prüft Zonen', () => {
    expect(zoneNormal('+02:00')).toBe('+02:00')
    expect(zoneNormal('-0530')).toBe('-05:30')
    expect(zoneNormal('Z')).toBe('+00:00')
    for (const z of ['+15:00', '02:00', 'MEZ', '', null, 2])
      expect(zoneNormal(z), String(z)).toBeNull()
  })
})

describe('aufnahmeDatum – Rangfolge', () => {
  it('EXIF-Original vor digitalisiert vor XMP vor Datei', () => {
    const alle = {
      dateTimeOriginal: '2024:01:01 10:00:00',
      createDate: '2024:02:02 10:00:00',
      xmpDateCreated: '2024:03:03'
    }
    expect(aufnahmeDatum(alle, DATEI, JETZT)).toMatchObject({
      lokal: '2024-01-01T10:00:00',
      quelle: 'exif'
    })
    expect(
      aufnahmeDatum({ ...alle, dateTimeOriginal: '0000:00:00 00:00:00' }, DATEI, JETZT)
    ).toMatchObject({
      lokal: '2024-02-02T10:00:00',
      quelle: 'exif-digitalisiert'
    })
    expect(aufnahmeDatum({ xmpDateCreated: '2024:03:03 12:00:00+01:00' }, DATEI, JETZT)).toEqual({
      lokal: '2024-03-03T12:00:00',
      offset: '+01:00',
      quelle: 'xmp'
    })
    expect(aufnahmeDatum({}, DATEI, JETZT).quelle).toBe('datei-erstellt')
  })

  it('Zone und Bruchteile gehören zum jeweiligen Tag', () => {
    const a = aufnahmeDatum(
      {
        createDate: '2024:02:02 10:00:00',
        subSecTimeDigitized: '25',
        offsetTimeDigitized: '-03:00'
      },
      DATEI,
      JETZT
    )
    expect(a).toEqual({
      lokal: '2024-02-02T10:00:00.250',
      offset: '-03:00',
      quelle: 'exif-digitalisiert'
    })
  })
})

describe('dateiDatum', () => {
  it('nimmt die ältere der beiden Dateizeiten', () => {
    const kopiert = { btime: Date.UTC(2026, 9, 20), mtime: Date.UTC(2019, 5, 1, 8, 30) }
    expect(dateiDatum(kopiert.btime, kopiert.mtime)).toEqual({
      lokal: lokalAusMs(kopiert.mtime),
      offset: null,
      quelle: 'datei-geaendert'
    })
    expect(dateiDatum(DATEI.btime, DATEI.mtime).quelle).toBe('datei-erstellt')
    expect(dateiDatum(null, DATEI.mtime).quelle).toBe('datei-geaendert')
    expect(dateiDatum(0, DATEI.mtime).quelle).toBe('datei-geaendert')
  })

  it('lokalAusMs liefert die Ortszeit dieses Rechners', () => {
    const ms = Date.UTC(2024, 6, 14, 16, 30, 5, 999)
    const d = new Date(ms)
    expect(lokalAusMs(ms)).toBe(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:05`
    )
  })
})
