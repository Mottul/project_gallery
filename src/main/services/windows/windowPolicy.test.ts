// Aus der Mottulbox übernommen (project_mega/src/main/services/windows/windowPolicy.test.ts) und an
// die engeren Regeln der Galerie angepasst.
import { describe, expect, it } from 'vitest'
import { devServerUrl, isAppPage, permissionAllowed } from './windowPolicy'

const built = { indexFile: 'file:///E:/Galeria/out/renderer/index.html', devOrigin: null }
const dev = { indexFile: built.indexFile, devOrigin: 'http://localhost:5173' }

describe('devServerUrl', () => {
  it('nutzt den Vite-Server nur beim Entwickeln und nur lokal', () => {
    expect(devServerUrl(false, 'http://localhost:5173')).toBe('http://localhost:5173')
    expect(devServerUrl(false, 'http://127.0.0.1:5173/')).toBe('http://127.0.0.1:5173/')
  })

  it('folgt der Umgebungsvariable in der fertigen App nie', () => {
    expect(devServerUrl(true, 'http://localhost:5173')).toBeNull()
  })

  it('lädt keine fremden Adressen', () => {
    expect(devServerUrl(false, 'https://example.com')).toBeNull()
    expect(devServerUrl(false, 'http://localhost.example.com:5173')).toBeNull()
    expect(devServerUrl(false, 'file:///C:/fremd/index.html')).toBeNull()
    expect(devServerUrl(false, 'kein url')).toBeNull()
    expect(devServerUrl(false, undefined)).toBeNull()
  })
})

describe('isAppPage', () => {
  it('erkennt die gebaute Seite mit jeder Route', () => {
    expect(isAppPage('file:///E:/Galeria/out/renderer/index.html#/betrachter/7', built)).toBe(true)
    expect(isAppPage('file:///e:/galeria/out/renderer/index.html', built)).toBe(true)
  })

  it('lehnt andere Dateien, Protokolle und Server ab', () => {
    expect(isAppPage('file:///E:/Galeria/out/renderer/andere.html', built)).toBe(false)
    expect(isAppPage('file:///C:/Users/x/Bilder/boese.html', built)).toBe(false)
    expect(isAppPage('https://example.com/', built)).toBe(false)
    expect(isAppPage('data:text/html,<p>x</p>', built)).toBe(false)
    expect(isAppPage('kein url', built)).toBe(false)
    expect(isAppPage(undefined, built)).toBe(false)
  })

  it('wirft nie, auch nicht bei kaputter %-Kodierung (sonst ginge die Navigation durch)', () => {
    expect(() => isAppPage('file:///C:/x%E0.html', built)).not.toThrow()
    expect(isAppPage('file:///C:/x%E0.html', built)).toBe(false)
    expect(isAppPage('file:///E:/Galeria/out/renderer/index.html%', built)).toBe(false)
  })

  it('erkennt beim Entwickeln nur den Vite-Server', () => {
    expect(isAppPage('http://localhost:5173/#/einstellungen', dev)).toBe(true)
    expect(isAppPage('http://localhost:5174/', dev)).toBe(false)
    expect(isAppPage(built.indexFile, dev)).toBe(false)
  })
})

describe('permissionAllowed', () => {
  it('erlaubt der App nur Vollbild und Zwischenablage', () => {
    expect(permissionAllowed('fullscreen', true)).toBe(true)
    expect(permissionAllowed('clipboard-sanitized-write', true)).toBe(true)
  })

  it('verweigert Kamera, Mikrofon und alles Übrige', () => {
    for (const p of [
      'media',
      'geolocation',
      'notifications',
      'midiSysex',
      'hid',
      'usb',
      'serial',
      'display-capture',
      'speaker-selection',
      'clipboard-read',
      'openExternal'
    ]) {
      expect(permissionAllowed(p, true), p).toBe(false)
    }
  })

  it('verweigert fremden Seiten alles', () => {
    expect(permissionAllowed('fullscreen', false)).toBe(false)
    expect(permissionAllowed('clipboard-sanitized-write', false)).toBe(false)
  })
})
