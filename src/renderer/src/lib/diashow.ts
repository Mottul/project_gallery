// Einstellungen der Diashow (Phase 2.5): Bedienzustand in localStorage wie die Ansicht (`ansicht.ts`),
// alles Gelesene geprüft; fehlt localStorage, gilt der Stand nur für diese Sitzung. Hat Windows die
// Animationen abgeschaltet („Bewegung reduzieren“), zeigt der Betrachter weder Übergang noch Ken Burns.

import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { KEN_BURNS_STAERKEN, type KenBurnsStaerke } from '@shared/kenBurns'

export const DIASHOW_INTERVALLE = [2, 3, 5, 10]
export type Uebergang = 'schnitt' | 'ueberblenden'
export type KenBurnsWahl = 'aus' | 'auto'

/** Dauer des Überblendens: Das Intervall zählt von Wechsel zu Wechsel */
export const UEBERBLENDEN_MS = 800

export interface DiashowWahl {
  /** Sekunden */
  intervall: number
  uebergang: Uebergang
  kenBurns: KenBurnsWahl
  staerke: KenBurnsStaerke
}

export const DIASHOW_VORGABE: DiashowWahl = {
  intervall: 3,
  uebergang: 'ueberblenden',
  kenBurns: 'auto',
  staerke: 'sanft'
}

const KEY = 'galerie.diashow'

/** Gelesenes je Feld prüfen: Ungültiges bekommt die Vorgabe. */
export function pruefeDiashowWahl(v: unknown): DiashowWahl {
  const e = v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  const wahl = <T>(wert: unknown, erlaubt: readonly T[], vorgabe: T): T =>
    erlaubt.includes(wert as T) ? (wert as T) : vorgabe
  return {
    intervall: wahl(e.intervall, DIASHOW_INTERVALLE, DIASHOW_VORGABE.intervall),
    uebergang: wahl(e.uebergang, ['schnitt', 'ueberblenden'], DIASHOW_VORGABE.uebergang),
    kenBurns: wahl(e.kenBurns, ['aus', 'auto'], DIASHOW_VORGABE.kenBurns),
    staerke: wahl(e.staerke, KEN_BURNS_STAERKEN, DIASHOW_VORGABE.staerke)
  }
}

function lesen(): DiashowWahl {
  try {
    return pruefeDiashowWahl(JSON.parse(localStorage.getItem(KEY) ?? 'null'))
  } catch {
    return DIASHOW_VORGABE
  }
}

const useStore = create<DiashowWahl>(lesen)

export const useDiashowWahl = (): DiashowWahl => useStore()

export function diashowAendern(patch: Partial<DiashowWahl>): void {
  useStore.setState(patch)
  try {
    localStorage.setItem(KEY, JSON.stringify(useStore.getState()))
  } catch {
    // localStorage nicht verfügbar -> nur für diese Sitzung
  }
}

const WENIG_BEWEGUNG = '(prefers-reduced-motion: reduce)'

/** Hat das System Animationen abgeschaltet? Folgt einer Änderung, auch bei offenem Betrachter. */
export function useWenigBewegung(): boolean {
  const [wenig, setWenig] = useState(() => matchMedia(WENIG_BEWEGUNG).matches)
  useEffect(() => {
    const m = matchMedia(WENIG_BEWEGUNG)
    const aendern = (): void => setWenig(m.matches)
    aendern()
    m.addEventListener('change', aendern)
    return () => m.removeEventListener('change', aendern)
  }, [])
  return wenig
}
