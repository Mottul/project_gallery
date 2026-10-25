// Wächter für ALLE Fenster, auch künftige: eingehängt über 'web-contents-created', also ohne dass
// ein Fenster daran denken muss. Aus der Mottulbox übernommen
// (project_mega/src/main/services/windows/windowGuards.ts), für die Galerie strenger:
// - keine neuen Fenster – und anders als in der Mottulbox auch kein Weiterreichen an den
//   Standardbrowser: Die App öffnet von sich aus keine Verbindung (Schicht A). Links öffnen
//   später nur auf ausdrücklichen Klick über eine eigene API-Methode.
// - keine Navigation weg von der App-Seite (ein Skript oder Link kann die App-API so nie einer
//   fremden Seite geben)
// - keine Webviews
// - Browser-Berechtigungen nur nach Allowlist (windowPolicy.permissionAllowed)
import { app, session, type WebContents } from 'electron'
import { appPages } from './appWindows'
import { logLine } from '../log'
import { kurzeAdresse } from '../netzRegel'
import { isAppPage, permissionAllowed } from './windowPolicy'

function guard(contents: WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    logLine('[wächter] neues Fenster verhindert:', kurzeAdresse(url))
    return { action: 'deny' }
  })
  contents.on('will-navigate', (e, url) => {
    // DevTools navigieren intern; die App selbst wechselt nur die Route im Hash
    if (url.startsWith('devtools:') || isAppPage(url, appPages)) return
    e.preventDefault()
    logLine('[wächter] Navigation verhindert:', kurzeAdresse(url))
  })
  contents.on('will-attach-webview', (e) => e.preventDefault())
}

/** Einmal beim Start, bevor das erste Fenster entsteht. */
export function installWindowGuards(): void {
  app.on('web-contents-created', (_e, contents) => guard(contents))

  const fromApp = (url: string | undefined, contents: WebContents | null): boolean =>
    isAppPage(url || contents?.getURL(), appPages)
  const denied = new Set<string>()
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    const ok = permissionAllowed(permission, fromApp(details.requestingUrl, contents))
    // je Berechtigung einmal ins Log – zeigt, falls eine Funktion doch eine braucht
    if (!ok && !denied.has(permission)) {
      denied.add(permission)
      logLine('[wächter] Berechtigung verweigert:', permission)
    }
    callback(ok)
  })
  session.defaultSession.setPermissionCheckHandler((contents, permission, _origin, details) =>
    permissionAllowed(permission, fromApp(details.requestingUrl, contents))
  )
}
