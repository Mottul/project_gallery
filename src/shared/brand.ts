// Zentrale Marken-Angaben (Arbeitstitel). EIN Ort zum Umbenennen der App im Code; package.json
// (`productName`) und src/renderer/index.html (<title>) sind statisch und müssen bei einer
// Umbenennung separat angepasst werden.

export const APP_NAME = 'Galeria Beata'

/** Fenstertitel-Baustein: „<Kontext> · <App>“ bzw. nur „<App>“. */
export function windowTitle(context?: string): string {
  return context ? `${context} · ${APP_NAME}` : APP_NAME
}
