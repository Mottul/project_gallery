# Installieren

Galeria Beata kommt als **eine Datei**: `Galeria-Beata-<Version>-setup.exe`. Doppelklick genügt –
ohne Administratorrechte, ohne Fragen, ohne Downloads beim ersten Start.

> **Stand:** Der Installer entsteht seit Phase 0 (`npm run package` bzw. GitHub Actions →
> „Installer bauen“ → Artifacts), enthält aber noch eine leere Galerie. Die erste nutzbare Version
> kommt mit Phase 1; dann folgt hier die Anleitung mit Bildern
> ([PLAN.md, „Installation und Auslieferung“](PLAN.md#installation-und-auslieferung)).

- **Installieren:** Doppelklick auf `Galeria-Beata-<Version>-setup.exe` – ohne Fragen und ohne
  Administratorrechte. Die App landet unter `%LOCALAPPDATA%\Programs\`, mit Verknüpfung im
  Startmenü und auf dem Desktop, und startet danach.
- **Sicherungen:** Bevor die App eine Datei zum ersten Mal ändert, legt sie eine Kopie unter
  `%LOCALAPPDATA%\Galeria Beata Sicherungen` ab und löscht sie nach 30 Tagen. Dieser Ordner
  übersteht die Deinstallation, damit keine Sicherung still verloren geht; er lässt sich von Hand
  löschen.
- **Deinstallieren:** Windows-Einstellungen → Apps → Galeria Beata. Die Einstellungen
  (`%APPDATA%\Galeria Beata`) bleiben für eine spätere Neuinstallation erhalten.

## Was beim ersten Installieren passiert

Der Installer ist bewusst nicht mit einem gekauften Zertifikat signiert. Windows SmartScreen
meldet deshalb beim ersten Mal „Unbekannter Herausgeber“. Weiter geht es über
*Weitere Informationen → Trotzdem ausführen*. Updates prüft die App später selbst über ihre eigene
Signatur.
