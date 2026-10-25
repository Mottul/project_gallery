import { describe, expect, it } from 'vitest'
import { konfliktText, ordnerKonflikt, pfadSchluessel } from './ordnerPruefen'

const APP = [
  'C:\\Users\\x\\AppData\\Local\\Galeria Beata',
  'C:\\Users\\x\\AppData\\Roaming\\Galeria Beata'
]

describe('pfadSchluessel', () => {
  it('vereinheitlicht Trenner, Schluss-Trenner und unter Windows Groß/Klein', () => {
    expect(pfadSchluessel('D:\\Bilder\\Urlaub\\', true)).toBe('d:/bilder/urlaub')
    expect(pfadSchluessel('D:/Bilder//Urlaub', true)).toBe('d:/bilder/urlaub')
    expect(pfadSchluessel('/home/x/Bilder/', false)).toBe('/home/x/Bilder')
  })

  it('lässt Wurzeln und Netzwerkpfade erkennbar', () => {
    expect(pfadSchluessel('D:\\', true)).toBe('d:/')
    expect(pfadSchluessel('\\\\NAS\\Fotos\\', true)).toBe('//nas/fotos')
    expect(pfadSchluessel('/', false)).toBe('/')
  })

  it('NFC und NFD ergeben denselben Schlüssel', () => {
    expect(pfadSchluessel('D:\\M\u00fcnchen', true)).toBe(pfadSchluessel('D:\\Mu\u0308nchen', true))
  })
})

describe('ordnerKonflikt', () => {
  const vorhanden = ['D:\\Bilder\\Urlaub', '\\\\nas\\fotos']

  it('erlaubt neue, getrennte Ordner – auch mit ähnlichem Namen', () => {
    expect(ordnerKonflikt('D:\\Bilder\\Urlaub 2024', vorhanden, APP, true)).toBeNull()
    expect(ordnerKonflikt('E:\\Kamera', vorhanden, APP, true)).toBeNull()
  })

  it('erkennt denselben Ordner in anderer Schreibweise', () => {
    expect(ordnerKonflikt('d:/bilder/URLAUB/', vorhanden, APP, true)).toEqual({
      art: 'gleich',
      pfad: 'D:\\Bilder\\Urlaub'
    })
  })

  it('erkennt Ordner darin und darüber', () => {
    expect(ordnerKonflikt('D:\\Bilder\\Urlaub\\Kroatien', vorhanden, APP, true)?.art).toBe('darin')
    expect(ordnerKonflikt('D:\\Bilder', vorhanden, APP, true)?.art).toBe('enthaelt')
    expect(ordnerKonflikt('D:\\', vorhanden, APP, true)?.art).toBe('enthaelt')
    expect(ordnerKonflikt('\\\\NAS\\Fotos\\2024', vorhanden, APP, true)?.art).toBe('darin')
  })

  it('sperrt Ordner innerhalb der Datenordner der App, nicht aber das Profil darüber', () => {
    expect(
      ordnerKonflikt('C:\\Users\\x\\AppData\\Local\\Galeria Beata\\index', [], APP, true)?.art
    ).toBe('app')
    expect(ordnerKonflikt('C:\\Users\\x\\AppData\\Local\\Galeria Beata', [], APP, true)?.art).toBe(
      'app'
    )
    expect(ordnerKonflikt('C:\\Users\\x', [], APP, true)).toBeNull()
    expect(ordnerKonflikt('C:\\Users\\x\\Bilder', [], APP, true)).toBeNull()
  })

  it('unterscheidet Groß/Klein außerhalb von Windows', () => {
    expect(ordnerKonflikt('/home/x/bilder', ['/home/x/Bilder'], [], false)).toBeNull()
    expect(ordnerKonflikt('/home/x/Bilder', ['/home/x/Bilder'], [], false)?.art).toBe('gleich')
  })
})

describe('konfliktText', () => {
  it('nennt den betroffenen Ordner', () => {
    const name = (p: string): string => p.split(/[\\/]/).pop() ?? p
    expect(konfliktText({ art: 'darin', pfad: 'D:\\Bilder\\Urlaub' }, name)).toContain('„Urlaub“')
    expect(konfliktText({ art: 'gleich', pfad: 'x' }, name)).toMatch(/schon in der Galerie/)
  })
})
