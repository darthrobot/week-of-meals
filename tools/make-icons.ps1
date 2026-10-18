# Draws the app icons (a white checklist on a green tile) with System.Drawing.
# Run from the project folder:  powershell -File tools\make-icons.ps1
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot

function New-Icon([int]$size, [bool]$background, [double]$glyphScale, [string]$path) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)
  $green = [System.Drawing.ColorTranslator]::FromHtml("#2D7148")
  $leaf = [System.Drawing.ColorTranslator]::FromHtml("#A9DDBB")
  if ($background) { $g.FillRectangle((New-Object System.Drawing.SolidBrush $green), 0, 0, $size, $size) }

  $w = $size * $glyphScale
  $x0 = ($size - $w) / 2
  $rowH = $w / 3
  $box = $rowH * 0.56
  $stroke = [Math]::Max(2, $w * 0.055)
  $white = New-Object System.Drawing.Pen ([System.Drawing.Color]::White), $stroke
  $white.StartCap = 'Round'; $white.EndCap = 'Round'; $white.LineJoin = 'Round'
  $check = New-Object System.Drawing.Pen $leaf, ($stroke * 1.1)
  $check.StartCap = 'Round'; $check.EndCap = 'Round'; $check.LineJoin = 'Round'

  for ($i = 0; $i -lt 3; $i++) {
    $cy = $x0 + $rowH * $i + $rowH / 2
    $bx = $x0
    $by = $cy - $box / 2
    $g.DrawRectangle($white, [float]$bx, [float]$by, [float]$box, [float]$box)
    $g.DrawLine($white, [float]($bx + $box * 1.6), [float]$cy, [float]($x0 + $w), [float]$cy)
    if ($i -lt 2) {
      $pts = @(
        (New-Object System.Drawing.PointF ([float]($bx + $box * 0.2)), ([float]($cy))),
        (New-Object System.Drawing.PointF ([float]($bx + $box * 0.45)), ([float]($cy + $box * 0.28))),
        (New-Object System.Drawing.PointF ([float]($bx + $box * 1.0)), ([float]($cy - $box * 0.42)))
      )
      $g.DrawLines($check, $pts)
    }
  }
  $g.Dispose()
  New-Item -ItemType Directory -Force (Split-Path -Parent $path) | Out-Null
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

New-Icon 192 $true 0.56 "$root\web\icons\icon-192.png"
New-Icon 512 $true 0.56 "$root\web\icons\icon-512.png"
# Source images for the Android launcher icon (used by @capacitor/assets in the build)
New-Icon 1024 $true 0.56 "$root\assets\icon-only.png"
New-Icon 1024 $false 0.42 "$root\assets\icon-foreground.png"
$bg = New-Object System.Drawing.Bitmap 1024, 1024
$gb = [System.Drawing.Graphics]::FromImage($bg); $gb.Clear([System.Drawing.ColorTranslator]::FromHtml("#2D7148")); $gb.Dispose()
$bg.Save("$root\assets\icon-background.png", [System.Drawing.Imaging.ImageFormat]::Png); $bg.Dispose()
"Icons written"
