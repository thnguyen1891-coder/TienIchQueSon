# CAI 1 LAN tren moi may: bat tu dong cap nhat "Tien ich thong minh - TTYTKV Que Son".
# - Chep script cap nhat vao %LOCALAPPDATA%\TienIchQueSon (khong can quyen Quan tri)
# - Tao tac vu hen gio chay an moi 5 phut (va chay ngay 1 lan)
# Tham so: -Source (neu bo trong thi doc update\nguon_cap_nhat.txt), -Target (mac dinh = thu muc tien ich chua file nay)
param(
    [string]$Source = '',
    [string]$Target = (Split-Path -Parent $PSScriptRoot),
    [int]$Minutes = 5
)
$ErrorActionPreference = 'Stop'
$TaskName = 'TienIchQueSon_CapNhat'

function Say([string]$m, [string]$color = 'Gray') { Write-Host $m -ForegroundColor $color }

try {
    if (-not $Source) {
        $cfgTxt = Join-Path $PSScriptRoot 'nguon_cap_nhat.txt'
        if (Test-Path $cfgTxt) {
            $line = Get-Content $cfgTxt | Where-Object { $_ -match '^\s*SOURCE\s*=' } | Select-Object -First 1
            if ($line) { $Source = ($line -replace '^\s*SOURCE\s*=\s*', '').Trim() }
        }
    }
    if (-not $Source) { throw 'Chua co nguon cap nhat: ghi dong SOURCE=... trong update\nguon_cap_nhat.txt (hoac chay voi -Source ...).' }

    $Target = [IO.Path]::GetFullPath($Target)
    if (-not (Test-Path (Join-Path $Target 'manifest.json'))) { throw "Thu muc tien ich khong dung (khong co manifest.json): $Target" }

    $home2 = Join-Path $env:LOCALAPPDATA 'TienIchQueSon'
    New-Item -ItemType Directory -Force -Path $home2 | Out-Null
    Copy-Item -Path (Join-Path $PSScriptRoot 'CapNhatTienIch.ps1') -Destination (Join-Path $home2 'CapNhatTienIch.ps1') -Force

    @{ source = $Source; target = $Target } | ConvertTo-Json | Set-Content -Path (Join-Path $home2 'config.json') -Encoding UTF8

    # Chay an hoan toan (khong nhay cua so) qua wscript
    $ps1 = Join-Path $home2 'CapNhatTienIch.ps1'
    $vbs = Join-Path $home2 'ChayAn.vbs'
    $cmd = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""' + $ps1 + '""'
    Set-Content -Path $vbs -Encoding ASCII -Value ('CreateObject("WScript.Shell").Run "' + $cmd + '", 0, False')

    # Tac vu hen gio cua nguoi dung hien tai (khong can quyen Quan tri)
    $tr = 'wscript.exe "' + $vbs + '"'
    # (PowerShell 5.1: loi tren stderr cua lenh ngoai bi coi la loi dung chuong trinh -> tam cho phep 'Continue')
    $ErrorActionPreference = 'Continue'
    $out = & schtasks.exe /Create /F /SC MINUTE /MO $Minutes /TN $TaskName /TR $tr 2>&1
    $okMain = ($LASTEXITCODE -eq 0)
    # Them 1 lan luc dang nhap Windows: can quyen Quan tri -> khong co thi bo qua (khong bat buoc)
    $null = & schtasks.exe /Create /F /SC ONLOGON /TN ($TaskName + '_DangNhap') /TR $tr 2>&1
    $okLogon = ($LASTEXITCODE -eq 0)
    $ErrorActionPreference = 'Stop'
    if (-not $okMain) { throw ("Khong tao duoc tac vu hen gio: " + (($out | Out-String).Trim())) }

    Say ''
    Say '=== DA BAT TU DONG CAP NHAT ===' 'Green'
    Say ("Nguon      : " + $Source)
    Say ("Tien ich   : " + $Target)
    Say ("Kiem tra   : moi $Minutes phut (tac vu '$TaskName')" + $(if ($okLogon) { ' + khi dang nhap Windows' } else { '' }))
    Say ("Nhat ky    : " + (Join-Path $home2 'capnhat.log'))
    Say ''
    Say 'Dang kiem tra ban moi lan dau...'
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $ps1
    $log = Join-Path $home2 'capnhat.log'
    if (Test-Path $log) { Get-Content $log -Tail 3 | ForEach-Object { Say ("  " + $_) } } else { Say '  Dang dung ban moi nhat.' }
    Say ''
    Say 'Luu y: tien ich phai duoc cai bang "Tai tien ich da giai nen" tu DUNG thu muc tren.' 'Yellow'
    exit 0
} catch {
    Say ('LOI: ' + $_.Exception.Message) 'Red'
    exit 1
}
