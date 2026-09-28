# Generates the images Google Play requires before a closed test can be rolled
# out: the 512x512 store icon and the 1024x500 feature graphic.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/gen-store-assets.ps1
#
# Output goes to store/ and is committed, because the Play Console upload is a
# manual step and the files must exist independently of this script.
#
# Why the launcher icon is the source, not src/assets/logo.jpg: those are two
# different images. logo.jpg is the dark, near-black mark the app draws inside
# its own UI (mean luma 8/255). ic_launcher.png is the bright icon on the home
# screen and in the launcher. Play shows the store icon beside the app name, so
# it has to be the launcher artwork or the two disagree. It is also a flat design
# (761 distinct colours at 192x192), so the upscale to 512 is clean.
#
# The feature graphic is built from the same brand gradient the app uses
# (src/index.css --gradient-primary) and the same tagline
# (app.tagline in src/i18n/locales/en/index.json), so a rebrand has one place to
# change. Screenshots are NOT generated here — those are captured from the
# running app; see PLAY_STORE.md.
#
# System.Drawing is used because it ships with PowerShell on Windows and this
# project has no image dependency (no sharp, no canvas), so adding one just to
# place two rectangles and a line of text would be the larger change.

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$iconSource = Join-Path $root "android\app\src\main\res\mipmap-xxxhdpi\ic_launcher.png"
$outDir = Join-Path $root "store"

if (-not (Test-Path $iconSource)) { throw "Launcher icon not found at $iconSource" }
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

# Brand colours, matching src/index.css:
#   primary      hsl(217 100% 60%) -> #3381FF
#   accent       hsl(265  90% 62%) -> #9047F5
#   background   hsl(232  30%  6%) -> #0B0C14
$primary = [System.Drawing.Color]::FromArgb(255, 51, 129, 255)
$accent = [System.Drawing.Color]::FromArgb(255, 144, 71, 245)
$background = [System.Drawing.Color]::FromArgb(255, 5, 7, 15)
$white = [System.Drawing.Color]::FromArgb(255, 255, 255, 255)
$muted = [System.Drawing.Color]::FromArgb(255, 205, 214, 232)

# The adaptive-icon background declared in res/values/ic_launcher_background.xml.
# The launcher icon is composited onto it so the result matches what the launcher
# actually renders rather than whatever the source PNG's alpha happens to be.
$iconBackground = [System.Drawing.Color]::White

function New-Graphics([System.Drawing.Bitmap]$bitmap) {
  $g = [System.Drawing.Graphics]::FromImage($bitmap)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  return $g
}

function New-RoundedPath([int]$x, [int]$y, [int]$w, [int]$h, [int]$radius) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $radius * 2
  $path.AddArc($x, $y, $d, $d, 180, 90)
  $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

# --- Store icon: 512x512 PNG, 32-bit with alpha ------------------------------
# Play masks nothing on this one, so it is left square. Upscaling a flat 192px
# design to 512 is the one place the source resolution is a limit; a vector or
# 1024px export would replace this if the brand is ever redrawn.
$iconSize = 512
$iconBitmap = New-Object System.Drawing.Bitmap($iconSize, $iconSize)
$iconGraphics = New-Graphics $iconBitmap
try {
  $iconGraphics.Clear($iconBackground)
  $source = [System.Drawing.Image]::FromFile($iconSource)
  try {
    $iconGraphics.DrawImage($source, 0, 0, $iconSize, $iconSize)
  } finally { $source.Dispose() }

  $iconPath = Join-Path $outDir "icon-512.png"
  $iconBitmap.Save($iconPath, [System.Drawing.Imaging.ImageFormat]::Png)
  Write-Host "wrote store\icon-512.png (${iconSize}x${iconSize})"
} finally {
  $iconGraphics.Dispose()
  $iconBitmap.Dispose()
}

# --- Feature graphic: 1024x500 JPEG, no alpha --------------------------------
# Text is kept clear of the outer ~8% so a future crop cannot clip the wordmark.
$fw = 1024
$fh = 500
$featureBitmap = New-Object System.Drawing.Bitmap($fw, $fh)
$feature = New-Graphics $featureBitmap
try {
  $feature.Clear($background)

  $gradient = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Rectangle(0, 0, $fw, $fh)), $primary, $accent, 20.0
  )
  try {
    $feature.FillRectangle($gradient, 0, 0, $fw, $fh)
  } finally { $gradient.Dispose() }

  # White bold text on #3381FF is only about 3:1, so the right half is darkened
  # towards the brand background for legibility before any text is drawn.
  $washRect = New-Object System.Drawing.Rectangle(330, 0, ($fw - 330), $fh)
  $wash = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $washRect,
    [System.Drawing.Color]::FromArgb(10, 11, 12, 20),
    [System.Drawing.Color]::FromArgb(235, 11, 12, 20),
    0.0
  )
  try {
    $feature.FillRectangle($wash, $washRect)
  } finally { $wash.Dispose() }

  # The icon as a rounded app-icon card, vertically centred on the left.
  $markSize = 288
  $markX = 72
  $markY = [int](($fh - $markSize) / 2)
  $cardPath = New-RoundedPath $markX $markY $markSize $markSize 62
  try {
    $feature.SetClip($cardPath)
    $feature.Clear($iconBackground)
    $source = [System.Drawing.Image]::FromFile($iconSource)
    try {
      $feature.DrawImage($source, $markX, $markY, $markSize, $markSize)
    } finally { $source.Dispose() }
  } finally {
    $feature.ResetClip()
    $cardPath.Dispose()
  }

  $textX = $markX + $markSize + 62
  $titleFont = New-Object System.Drawing.Font("Segoe UI", 56, [System.Drawing.FontStyle]::Bold)
  $taglineFont = New-Object System.Drawing.Font("Segoe UI", 24, [System.Drawing.FontStyle]::Regular)
  $titleBrush = New-Object System.Drawing.SolidBrush($white)
  $taglineBrush = New-Object System.Drawing.SolidBrush($muted)
  $tagline2Brush = New-Object System.Drawing.SolidBrush(
    [System.Drawing.Color]::FromArgb(255, 146, 196, 255)
  )

  try {
    # "Vaylo Sports" — never the bare trademark.
    $title = "VAYLO SPORTS"
    # Matches app.tagline in src/i18n/locales/en/index.json.
    $tagline1 = "Learn smarter. Train better."
    $tagline2 = "Perform better."

    $titleSize = $feature.MeasureString($title, $titleFont)
    $t1Size = $feature.MeasureString($tagline1, $taglineFont)
    $t2Size = $feature.MeasureString($tagline2, $taglineFont)

    $blockHeight = $titleSize.Height + 16 + $t1Size.Height + 2 + $t2Size.Height
    $y = [int](($fh - $blockHeight) / 2)

    $feature.DrawString($title, $titleFont, $titleBrush, $textX, $y)
    $y += [int]$titleSize.Height + 16
    $feature.DrawString($tagline1, $taglineFont, $taglineBrush, $textX, $y)
    $y += [int]$t1Size.Height + 2
    $feature.DrawString($tagline2, $taglineFont, $tagline2Brush, $textX, $y)
  } finally {
    $titleFont.Dispose(); $taglineFont.Dispose()
    $titleBrush.Dispose(); $taglineBrush.Dispose(); $tagline2Brush.Dispose()
  }

  # JPEG, because Play rejects transparency on the feature graphic and a JPEG
  # cannot carry any. Quality 92 keeps the gradient smooth at this size.
  $encoder = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
    Where-Object { $_.MimeType -eq "image/jpeg" }
  $params = New-Object System.Drawing.Imaging.EncoderParameters(1)
  $params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter(
    [System.Drawing.Imaging.Encoder]::Quality, [int64]92
  )
  $featurePath = Join-Path $outDir "feature-graphic-1024x500.jpg"
  $featureBitmap.Save($featurePath, $encoder, $params)
  Write-Host "wrote store\feature-graphic-1024x500.jpg (${fw}x${fh})"
} finally {
  $feature.Dispose()
  $featureBitmap.Dispose()
}

Get-ChildItem $outDir -File | ForEach-Object {
  Write-Host ("  {0}  {1:N0} bytes" -f $_.Name, $_.Length)
}
