; Ergänzungen für den NSIS-Installer (electron-builder bindet build/installer.nsh selbst ein).
;
; Deinstallation: die lokalen Daten der Galerie unter %LOCALAPPDATA%\Galeria Beata entfernen –
; Index (Pfade, Aufnahmedaten, ab Phase 2 Orte) und ab 1.3 die Vorschaubilder privater Fotos
; (Schicht D, Skill windows-paket). Nicht bei einem Update: Dann ruft der neue Installer den alten
; Deinstaller auf, und Bibliothek und Vorschaubilder sollen bleiben. Einstellungen in
; %APPDATA%\Galeria Beata bleiben ebenfalls (Plan: nur nach Rückfrage bzw. laut Doku entfernen).
!macro customUnInstall
  ${ifNot} ${isUpdated}
    RMDir /r "$LOCALAPPDATA\Galeria Beata"
  ${endIf}
!macroend
