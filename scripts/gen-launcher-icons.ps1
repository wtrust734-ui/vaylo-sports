# Regenerates every Android launcher icon from src/assets/logo.jpg (the brain
# mark). No image dependency is added — System.Drawing ships with Windows
# PowerShell, matching the approach of gen-store-assets.ps1.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/gen-launcher-icons.ps1
#
# Outputs (all overwritten in place):
#   mipmap-{mdpi..xxxhdpi}/ic_launcher.png           legacy square icons (48-192px)
#   mipmap-{mdpi..xxxhdpi}/ic_launcher_round.png     circle-masked legacy icons
#   mipmap-{mdpi..xxxhdpi}/ic_launcher_foreground.png adaptive foreground (108-432px)
#   values/ic_launcher_background.xml                adaptive background color
#
# The adaptive icon (mipmap-anydpi-v26/*.xml) layers ic_launcher_foreground.png
# over @color/ic_launcher_background, so the background color here and the
# launcher PNGs must agree — they are both driven by $adaptiveBackground.
#
# The adaptive canvas is 108dp but launchers mask to a circle and may parallax,
# so only the inner 72/108 (66.7%) is the guaranteed-visible safe zone: the
# brain is drawn to fill exactly that zone.

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $root "src\assets\logo.jpg"
$resDir = Join-Path $root "android\app\src\main\res"

if (-not (Test-Path $sourcePath)) { throw "Source image not found at $sourcePath" }

# Brand background — the app's own splash/launch color (capacitor.config.ts
# SplashScreen backgroundColor #05070f). The brain mark reads cleanly on it.
$adaptiveBackground = [System.Drawing.Color]::FromArgb(255, 5, 7, 15)
$legacyBackground = [System.Drawing.Color]::White

function New-Graphics([System.Drawing.Bitmap]$bitmap) {
  $g = [System.Drawing.Graphics]::FromImage($bitmap)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  return $g
}

# Draw the source image scaled to fit a square of $contentSize centred on a
# $canvasSize bitmap (JPG has no alpha, so aspect ratio is preserved with a
# centered fit).
function Draw-Centered([System.Drawing.Graphics]$g, [int]$canvasSize, [double]$contentSize) {
  $src = [System.Drawing.Image]::FromFile($script:sourcePath)
  try {
    $scale = [Math]::Min($contentSize / $src.Width, $contentSize / $src.Height)
    $w = $src.Width * $scale
    $h = $src.Height * $scale
    $x = ($canvasSize - $w) / 2
    $y = ($canvasSize - $h) / 2
    $g.DrawImage($src, [float]$x, [float]$y, [float]$w, [float]$h)
  } finally { $src.Dispose() }
}

# Circle-masked bitmap: content drawn after the clip is applied.
function New-RoundBitmap([int]$size, [System.Drawing.Color]$bg) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddEllipse(0, 0, $size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.SetClip($path)
  $g.Clear($bg)
  Draw-Centered $g $size ($size * 0.86)
  $g.Dispose()
  $path.Dispose()
  return $bmp
}

# Legacy square launcher: white backing, full-bleed image (like the store icon).
foreach ($density in @(
  @{ dir = "mipmap-mdpi";    size = 48 },
  @{ dir = "mipmap-hdpi";    size = 72 },
  @{ dir = "mipmap-xhdpi";   size = 96 },
  @{ dir = "mipmap-xxhdpi";  size = 144 },
  @{ dir = "mipmap-xxxhdpi"; size = 192 }
)) {
  $size = $density.size
  $dirPath = Join-Path $resDir $density.dir
  New-Item -ItemType Directory -Force -Path $dirPath | Out-Null

  # ic_launcher.png — square
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = New-Graphics $bmp
  $g.Clear($legacyBackground)
  Draw-Centered $g $size $size
  $out = Join-Path $dirPath "ic_launcher.png"
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  Write-Host "wrote $density.dir/ic_launcher.png (${size}x${size})"

  # ic_launcher_round.png — circle-masked
  $round = New-RoundBitmap $size $legacyBackground
  $out = Join-Path $dirPath "ic_launcher_round.png"
  $round.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $round.Dispose()
  Write-Host "wrote $density.dir/ic_launcher_round.png (${size}x${size})"

  # ic_launcher_foreground.png — adaptive layer, 108dp canvas, 66.7% safe zone
  $canvas = [int][Math]::Round($size * 108.0 / 48.0)
  $fg = New-Object System.Drawing.Bitmap($canvas, $canvas)
  $g = New-Graphics $fg
  $g.Clear([System.Drawing.Color]::Transparent)
  $safeZone = $canvas * (72.0 / 108.0)
  Draw-Centered $g $canvas $safeZone
  $out = Join-Path $dirPath "ic_launcher_foreground.png"
  $fg.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $fg.Dispose()
  Write-Host "wrote $density.dir/ic_launcher_foreground.png (${canvas}x${canvas})"
}

# Adaptive background color must match what the foreground was composed for.
# Android color literals need the #AARRGGBB / #RRGGBB form — the '#' is part of
# the value, not shell comment syntax. The file is written BOM-less (ASCII):
# Windows PowerShell 5.1's `-Encoding UTF8` emits a BOM, and a BOM in a values
# XML makes AAPT2 fail the whole resource merge with an opaque
# "Invalid <color>" / ParsedResource error.
$hex = "#{0:X2}{1:X2}{2:X2}" -f $adaptiveBackground.R, $adaptiveBackground.G, $adaptiveBackground.B
$bgXml = "<?xml version=`"1.0`" encoding=`"utf-8`"?>`r`n<resources>`r`n    <color name=`"ic_launcher_background`">$hex</color>`r`n</resources>`r`n"
[System.IO.File]::WriteAllText((Join-Path $resDir "values\ic_launcher_background.xml"), $bgXml)
Write-Host "wrote values/ic_launcher_background.xml ($hex)"

Write-Host "Launcher icons regenerated from $sourcePath"
