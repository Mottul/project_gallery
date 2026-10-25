// Aus der Mottulbox übernommen (project_mega/src/renderer/src/lib/utils.ts).
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/** Fehlertext für Nutzer: Electron-Präfix „Error invoking remote method …“ ist nur Rauschen. */
export function errorText(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
