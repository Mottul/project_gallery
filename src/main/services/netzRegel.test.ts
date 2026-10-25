import { describe, expect, it } from 'vitest'
import { anfrageErlaubt, kurzeAdresse } from './netzRegel'

const built = { indexFile: 'file:///E:/Galeria/out/renderer/index.html', devOrigin: null }
const dev = { indexFile: built.indexFile, devOrigin: 'http://localhost:5173' }

describe('anfrageErlaubt – gebaute App', () => {
  it('lässt die eigene Seite und ihre Dateien zu', () => {
    for (const url of [
      'file:///E:/Galeria/out/renderer/index.html',
      'file:///E:/Galeria/out/renderer/index.html#/betrachter/1',
      'file:///E:/Galeria/out/renderer/assets/index-abc123.js',
      'file:///e:/galeria/out/renderer/assets/index.css'
    ]) {
      expect(anfrageErlaubt(url, built), url).toBe(true)
    }
  })

  it('weist jede Webadresse ab, auch lokale', () => {
    for (const url of [
      'https://example.com/',
      'http://127.0.0.1:8080/spion',
      'http://localhost:5173/',
      'ws://localhost:5173/',
      'wss://example.com/',
      'ftp://example.com/x',
      'https://fonts.googleapis.com/css?family=Roboto'
    ]) {
      expect(anfrageErlaubt(url, built), url).toBe(false)
    }
  })

  it('weist Dateien außerhalb der App ab', () => {
    for (const url of [
      'file:///C:/Users/x/Bilder/urlaub.jpg',
      'file:///E:/Galeria/out/main/index.js',
      'file:///E:/Galeria/out/renderer-fremd/x.js',
      'file:///E:/Galeria/out/renderer/../main/index.js',
      'file:///E:/Galeria/out/renderer/%2e%2e/main/index.js',
      'file:///E:/Galeria/out/renderer/..%2fmain/index.js',
      'file:///E:/Galeria/out/renderer/..%5Cmain/index.js',
      'file://server/freigabe/out/renderer/index.html'
    ]) {
      expect(anfrageErlaubt(url, built), url).toBe(false)
    }
  })

  it('lässt von der Seite erzeugte Inhalte, DevTools und eigene Protokolle zu', () => {
    expect(anfrageErlaubt('data:image/png;base64,AAAA', built)).toBe(true)
    expect(anfrageErlaubt('blob:file:///0b1c', built)).toBe(true)
    expect(anfrageErlaubt('devtools://devtools/bundled/devtools_app.html', built)).toBe(true)
    expect(anfrageErlaubt('thumb://12/256', built, ['thumb', 'bild'])).toBe(true)
    expect(anfrageErlaubt('thumb://12/256', built)).toBe(false)
    expect(anfrageErlaubt('foto://x', built, ['thumb', 'bild'])).toBe(false)
  })

  it('weist Unsinn ab – ohne zu werfen (sonst bliebe die Anfrage ohne Antwort hängen)', () => {
    expect(anfrageErlaubt('kein url', built)).toBe(false)
    expect(anfrageErlaubt('', built)).toBe(false)
    expect(() => anfrageErlaubt('file:///E:/Galeria/out/renderer/x%E0.js', built)).not.toThrow()
    expect(anfrageErlaubt('file:///E:/Galeria/out/renderer/x%E0.js', built)).toBe(false)
  })
})

describe('anfrageErlaubt – Entwickeln', () => {
  it('lässt den Vite-Server samt Hot-Reload zu', () => {
    expect(anfrageErlaubt('http://localhost:5173/', dev)).toBe(true)
    expect(anfrageErlaubt('http://localhost:5173/src/main.tsx?t=1', dev)).toBe(true)
    expect(anfrageErlaubt('ws://localhost:5173/?token=x', dev)).toBe(true)
  })

  it('aber keinen anderen Port, Rechner oder fremde Seiten', () => {
    expect(anfrageErlaubt('http://localhost:5174/', dev)).toBe(false)
    expect(anfrageErlaubt('ws://localhost:5174/', dev)).toBe(false)
    expect(anfrageErlaubt('http://127.0.0.1:5173/', dev)).toBe(false)
    expect(anfrageErlaubt('https://example.com/', dev)).toBe(false)
  })
})

describe('kurzeAdresse', () => {
  it('nennt nur Protokoll und Rechner', () => {
    expect(kurzeAdresse('https://example.com/pfad/bild.jpg?gps=48.1,11.5')).toBe(
      'https://example.com'
    )
    expect(kurzeAdresse('file:///C:/Users/x/Bilder/urlaub.jpg')).toBe('file:')
    expect(kurzeAdresse('ws://127.0.0.1:9000/')).toBe('ws://127.0.0.1:9000')
    expect(kurzeAdresse('kaputt')).toBe('(ungültige Adresse)')
  })
})
