# Abnahme eines Installers in der Windows-Sandbox OHNE Netz (Skill windows-paket, „Prüfen“).
# Läuft IN der Sandbox als Anmeldebefehl (scripts/sandbox-abnahme.mjs schreibt die .wsb):
# Installer aus C:\Installer (nur lesen), Bericht und Bildschirmfoto nach C:\Ergebnis.
# Phase 0: installieren ohne Fragen, ohne Netz starten, gebündelte Programme laufen,
# deinstallieren ohne Reste im Programmordner. Seit 1.6 mit Testbildern (galerie.mjs): Ordner
# hinzufügen, Vorschaubilder, Sortieren, Betrachter, Überwachen, Originale unverändert, und nach
# der Deinstallation keine Vorschaubilder mehr auf der Platte. Metadaten folgen mit Phase 3.

$ErrorActionPreference = 'Continue'
$ergebnis = 'C:\Ergebnis'
$bericht = Join-Path $ergebnis 'abnahme.txt'
$fehler = 0

function Zeile([string]$text) {
  Add-Content -LiteralPath $bericht -Value $text -Encoding utf8
}
function Pruefe([string]$name, [bool]$ok, [string]$detail = '') {
  if ($ok) { Zeile "OK      $name $detail" } else { Zeile "FEHLER  $name $detail"; $script:fehler++ }
}

Set-Content -LiteralPath $bericht -Value "Abnahme Galeria Beata – $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -Encoding utf8

# 0. wirklich ohne Netz?
$netz = Test-Connection -ComputerName 1.1.1.1 -Count 1 -Quiet -ErrorAction SilentlyContinue
Pruefe 'Sandbox ohne Netz' (-not $netz)

# 1. Installieren: One-Click, je Benutzer, still (/S) – keine Rückfrage, keine Administratorrechte
$setup = Get-ChildItem 'C:\Installer' -Filter 'Galeria-Beata-*-setup.exe' | Sort-Object LastWriteTime | Select-Object -Last 1
Pruefe 'Installer gefunden' ($null -ne $setup) "$($setup.Name)"
$t0 = Get-Date
$p = Start-Process -FilePath $setup.FullName -ArgumentList '/S' -PassThru -Wait
Pruefe 'Installer beendet ohne Fehler' ($p.ExitCode -eq 0) "(Code $($p.ExitCode), $([int]((Get-Date) - $t0).TotalSeconds) s)"

$exe = Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Programs') -Recurse -Filter 'Galeria Beata.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
Pruefe 'Programm je Benutzer installiert' ($null -ne $exe) "$($exe.FullName)"
$startmenue = Get-ChildItem (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs') -Recurse -Filter 'Galeria Beata*.lnk' -ErrorAction SilentlyContinue
Pruefe 'Startmenü-Verknüpfung' ($startmenue.Count -gt 0)
Pruefe 'Desktop-Verknüpfung' (Test-Path (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Galeria Beata.lnk'))

# 2. Gebündelte Programme aus der Installation
$res = Join-Path $exe.DirectoryName 'resources'
$ver = & (Join-Path $res 'exiftool\exiftool.exe') -ver 2>&1
Pruefe 'ExifTool startet' ("$ver" -match '^\d+\.\d+$') "$ver"
$ff = (& (Join-Path $res 'ffmpeg\ffmpeg.exe') -hide_banner -version 2>&1 | Select-Object -First 1)
Pruefe 'ffmpeg startet' ("$ff" -match '^ffmpeg version') "$ff"

# 3. App starten (ohne Netz) und Fenster abwarten
$app = Start-Process -FilePath $exe.FullName -PassThru
$titel = ''
for ($i = 0; $i -lt 60 -and -not $titel; $i++) {
  Start-Sleep -Milliseconds 500
  $titel = (Get-Process -Id $app.Id -ErrorAction SilentlyContinue).MainWindowTitle
}
Pruefe 'App startet mit Fenster' ($titel -eq 'Galeria Beata') "(Titel: '$titel')"
Start-Sleep -Seconds 3
try {
  Add-Type -AssemblyName System.Windows.Forms, System.Drawing
  $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bild = New-Object System.Drawing.Bitmap $b.Width, $b.Height
  [System.Drawing.Graphics]::FromImage($bild).CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
  $bild.Save((Join-Path $ergebnis 'app.png'), [System.Drawing.Imaging.ImageFormat]::Png)
  Zeile 'INFO    Bildschirmfoto: app.png'
} catch { Zeile "INFO    kein Bildschirmfoto: $_" }
Stop-Process -Id $app.Id -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# 3b. Galerie mit Testbildern (Phase 1.6): die installierte App über Playwright steuern – mit dem
# Node des Rechners (C:\Node) und playwright-core aus dem Projekt (C:\Repo), beides nur lesend.
# Testbilder (synthetisch, auf dem Rechner erzeugt) nach „Bilder“ kopieren: dort liegen sie echt.
$bilder = Join-Path $env:USERPROFILE 'Pictures\Testbilder'
Copy-Item -LiteralPath 'C:\Testbilder\bib' -Destination $bilder -Recurse -Force
$node = 'C:\Node\node.exe'
if ((Test-Path $node) -and (Test-Path 'C:\Repo\scripts\sandbox\galerie.mjs')) {
  $ausgabe = & $node 'C:\Repo\scripts\sandbox\galerie.mjs' $exe.FullName $bilder $ergebnis 2>&1
  $galerie = 0
  foreach ($z in $ausgabe) {
    $t = "$z"
    if ($t -match '^(OK|FEHLER)\s') {
      Zeile $t
      $galerie++
      if ($t -match '^FEHLER') { $fehler++ }
    } elseif ($t.Trim()) { Zeile "INFO    $t" }
  }
  # lief sie überhaupt durch? (sonst stünden oben keine Prüfungen)
  Pruefe 'Galerie-Prüfung vollständig gelaufen' ($galerie -ge 7) "(Code $LASTEXITCODE, $galerie Prüfungen)"
  Zeile 'INFO    Bildschirmfotos: galerie.png, betrachter.png'
} else {
  Pruefe 'Node und Galerie-Prüfung eingebunden' $false
}
$cache = Join-Path $env:LOCALAPPDATA 'Galeria Beata\vorschau'
$gbv = @(Get-ChildItem $cache -Recurse -Filter '*.gbv' -ErrorAction SilentlyContinue)
Pruefe 'Vorschaubilder verschlüsselt im lokalen Datenordner' ($gbv.Count -gt 0) "($($gbv.Count) Dateien)"
$jpeg = @($gbv | Where-Object { $k = [System.IO.File]::ReadAllBytes($_.FullName); $k.Length -gt 2 -and $k[0] -eq 0xFF -and $k[1] -eq 0xD8 })
Pruefe 'kein Vorschaubild unverschlüsselt (keine JPEG-Signatur)' ($jpeg.Count -eq 0)

$log = Join-Path $env:APPDATA 'Galeria Beata\galeria-debug.log'
if (Test-Path $log) {
  $abgewiesen = Select-String -LiteralPath $log -Pattern '\[netzsperre\] abgewiesen' -SimpleMatch:$false
  Pruefe 'Netzsperre musste nichts abweisen (keine Anfrage nach außen)' ($abgewiesen.Count -eq 0) "$($abgewiesen.Line -join '; ')"
}
# Index lokal (nicht im Roaming-Profil) – Phase 1.1
$lokal = Join-Path $env:LOCALAPPDATA 'Galeria Beata'
Pruefe 'Index im lokalen Datenordner angelegt' (Test-Path (Join-Path $lokal 'index\galerie.db'))
Pruefe 'kein Index im Roaming-Profil' (-not (Test-Path (Join-Path $env:APPDATA 'Galeria Beata\index')))
Get-Process -Name 'Galeria Beata' -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2

# 4. Deinstallieren (still) – Programmordner und Verknüpfungen weg; Einstellungen bleiben laut Plan
$uninst = Get-ChildItem $exe.DirectoryName -Filter 'Uninstall*.exe' | Select-Object -First 1
$u = Start-Process -FilePath $uninst.FullName -ArgumentList '/S' -PassThru -Wait
Start-Sleep -Seconds 3
Pruefe 'Deinstallation ohne Fehler' ($u.ExitCode -eq 0) "(Code $($u.ExitCode))"
Pruefe 'Programmordner entfernt' (-not (Test-Path $exe.DirectoryName))
Pruefe 'Desktop-Verknüpfung entfernt' (-not (Test-Path (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Galeria Beata.lnk')))
Pruefe 'Index und Cache entfernt (keine Reste in %LOCALAPPDATA%)' (-not (Test-Path $lokal))
Pruefe 'Testbilder bleiben nach der Deinstallation' ((@(Get-ChildItem $bilder -Recurse -File)).Count -gt 0)
Zeile "INFO    Einstellungen bleiben (gewollt): $(Test-Path (Join-Path $env:APPDATA 'Galeria Beata'))"

Zeile ''
Zeile ($(if ($fehler -eq 0) { 'ERGEBNIS: bestanden' } else { "ERGEBNIS: $fehler Fehler" }))
Set-Content -LiteralPath (Join-Path $ergebnis 'fertig.txt') -Value $fehler

# Sandbox selbst schließen: Bericht und Bildschirmfoto liegen schon auf dem Rechner (gemappter
# Ordner). Eine offen gebliebene Sandbox ließe die nächste Abnahme nicht starten – es läuft immer
# nur eine – und hielte die gemappten Ordner gesperrt.
Start-Sleep -Seconds 3
Stop-Computer -Force
