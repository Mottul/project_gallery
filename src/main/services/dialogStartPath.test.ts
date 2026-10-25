// Aus der Mottulbox übernommen (project_mega/src/main/services/dialogStartPath.test.ts, Stand 0cc14cb).
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { dialogStartPath } from './dialogStartPath'

const dir = resolve('show', 'medien')
const exists = (): boolean => true
const missing = (): boolean => false

describe('dialogStartPath', () => {
  it('startet ohne Vorschlag im gemerkten Ordner', () => {
    expect(dialogStartPath(dir, undefined, exists)).toBe(dir)
  })

  it('hängt den vorgeschlagenen Dateinamen an den gemerkten Ordner', () => {
    expect(dialogStartPath(dir, 'testbild.mp4', exists)).toBe(join(dir, 'testbild.mp4'))
  })

  it('lässt einen absoluten Vorschlag unverändert', () => {
    const own = resolve('anderswo', 'film.mov')
    expect(dialogStartPath(dir, own, exists)).toBe(own)
  })

  it('nimmt nur den Dateinamen, nie einen Pfadteil des Vorschlags', () => {
    expect(dialogStartPath(dir, join('..', 'x.json'), exists)).toBe(join(dir, 'x.json'))
  })

  it('bleibt beim Vorschlag, wenn der Ordner fehlt oder nichts gemerkt ist', () => {
    expect(dialogStartPath(dir, 'a.pdf', missing)).toBe('a.pdf')
    expect(dialogStartPath(null, 'a.pdf', exists)).toBe('a.pdf')
    expect(dialogStartPath(null, undefined, exists)).toBeUndefined()
  })

  it('ignoriert kaputte Werte aus settings.json', () => {
    expect(dialogStartPath(42, 'a.pdf', exists)).toBe('a.pdf')
    expect(dialogStartPath('relativ/ordner', undefined, exists)).toBeUndefined()
  })
})
