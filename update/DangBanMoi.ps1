# DANG BAN MOI (chay tren may nguoi quan ly) vao THU MUC MANG CHUNG.
# Truoc khi chay: TANG "version" trong manifest.json (VD 2.3.0 -> 2.3.1), neu khong cac may se khong cap nhat.
# Cach dung:  powershell -ExecutionPolicy Bypass -File update\DangBanMoi.ps1 -Dest "\\MAY-CHU\TienIch\KiemTraTheBHYT_VNPT_HIS"
# (Neu dung GitHub thi chi can commit + push, khong can file nay.)
param([Parameter(Mandatory = $true)][string]$Dest)
$ErrorActionPreference = 'Stop'
$src = Split-Path -Parent $PSScriptRoot
$ver = (Get-Content (Join-Path $src 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
$old = $null
try { $old = (Get-Content (Join-Path $Dest 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version } catch {}
if ($old -and ([version]$ver -le [version]$old)) {
    Write-Host "Phien ban $ver KHONG moi hon ban dang dang ($old). Hay tang version trong manifest.json." -ForegroundColor Red
    exit 1
}
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
# Chep moi thu tru manifest.json, roi chep manifest.json sau cung (may khach chi cap nhat khi thay manifest moi)
$rc = Start-Process robocopy.exe -ArgumentList @("`"$src`"", "`"$Dest`"", '/MIR', '/XF', 'manifest.json', '/XD', '.git', '.claude', '/R:3', '/W:2', '/NFL', '/NDL', '/NJH', '/NJS', '/NP') -NoNewWindow -Wait -PassThru
if ($rc.ExitCode -ge 8) { Write-Host "Chep loi (robocopy $($rc.ExitCode))" -ForegroundColor Red; exit 1 }
Copy-Item (Join-Path $src 'manifest.json') (Join-Path $Dest 'manifest.json') -Force
Write-Host "Da dang ban $ver len $Dest (ban cu: $old). Cac may se tu cap nhat trong vong 30 phut." -ForegroundColor Green
