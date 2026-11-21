# Cap nhat tu dong "Tien ich thong minh - TTYTKV Que Son"
# Chay boi Task Scheduler (moi 30 phut). Lay ban moi tu NGUON (thu muc mang chung hoac file zip GitHub),
# neu phien ban (manifest.json) moi hon ban tren may thi chep de len thu muc tien ich.
# manifest.json duoc chep SAU CUNG; tien ich tu thay phien ban moi va tu tai lai trong vong 1 phut.
param([string]$ConfigPath = (Join-Path $PSScriptRoot 'config.json'))

$ErrorActionPreference = 'Stop'
$LogFile = Join-Path $PSScriptRoot 'capnhat.log'

function Write-UpdLog([string]$msg) {
    $line = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '  ' + $msg
    try {
        # Giu log toi da ~500 dong
        if ((Test-Path $LogFile) -and ((Get-Item $LogFile).Length -gt 200KB)) {
            $keep = Get-Content $LogFile -Tail 300
            Set-Content -Path $LogFile -Value $keep -Encoding UTF8
        }
        Add-Content -Path $LogFile -Value $line -Encoding UTF8
    } catch {}
}

function Get-ManifestInfo([string]$path) {
    try {
        $m = Get-Content -Path $path -Raw -Encoding UTF8 | ConvertFrom-Json
        return $m
    } catch { return $null }
}

function Compare-Version([string]$a, [string]$b) {
    try { return ([version]$a).CompareTo([version]$b) } catch { return [string]::Compare($a, $b) }
}

function Test-OurExtension($manifest) {
    # Chi cap nhat dung tien ich cua minh (tranh chep nham / xoa nham thu muc khac)
    return ($null -ne $manifest) -and ($manifest.name -match 'Qu.{1,3} S.{1,3}n') -and ($manifest.background.service_worker -eq 'background.js')
}

$tmp = $null
try {
    if (-not (Test-Path $ConfigPath)) { Write-UpdLog "Khong thay file cau hinh $ConfigPath"; exit 1 }
    $cfg = Get-Content -Path $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $source = [string]$cfg.source
    $target = [string]$cfg.target
    if (-not $source -or -not $target) { Write-UpdLog 'Cau hinh thieu source / target'; exit 1 }

    # An toan: thu muc dich phai la thu muc tien ich (co manifest.json cua tien ich), khong phai o dia goc
    $targetFull = [IO.Path]::GetFullPath($target)
    if ($targetFull.TrimEnd('\').Length -le 3) { Write-UpdLog "Thu muc dich khong hop le: $targetFull"; exit 1 }
    $local = Get-ManifestInfo (Join-Path $targetFull 'manifest.json')
    if (-not (Test-OurExtension $local)) { Write-UpdLog "Thu muc dich khong phai thu muc tien ich: $targetFull"; exit 1 }
    $localVer = [string]$local.version

    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

    if ($source -match '^https?://') {
        # Nguon la file zip (VD GitHub). Kiem tra nhanh phien ban qua manifest.json "raw" truoc khi tai zip.
        $rawUrl = [string]$cfg.manifestUrl
        if (-not $rawUrl -and $source -match '^https://github\.com/([^/]+)/([^/]+)/archive/refs/heads/(.+)\.zip$') {
            $rawUrl = "https://raw.githubusercontent.com/$($Matches[1])/$($Matches[2])/$($Matches[3])/manifest.json"
        }
        if ($rawUrl) {
            try {
                $r = Invoke-WebRequest -Uri ($rawUrl + '?t=' + [DateTime]::Now.Ticks) -UseBasicParsing -TimeoutSec 30
                $remoteVerQuick = [string](($r.Content | ConvertFrom-Json).version)
                if ($remoteVerQuick -and (Compare-Version $remoteVerQuick $localVer) -le 0) { exit 0 }
            } catch { Write-UpdLog "Khong doc duoc $rawUrl : $($_.Exception.Message)" }
        }
        $tmp = Join-Path $env:TEMP ('tienich_capnhat_' + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $tmp | Out-Null
        $zip = Join-Path $tmp 'banmoi.zip'
        Invoke-WebRequest -Uri $source -OutFile $zip -UseBasicParsing -TimeoutSec 300
        Expand-Archive -Path $zip -DestinationPath (Join-Path $tmp 'x') -Force
        $mf = Get-ChildItem -Path (Join-Path $tmp 'x') -Recurse -Filter 'manifest.json' |
            Sort-Object { $_.FullName.Length } | Select-Object -First 1
        if (-not $mf) { Write-UpdLog 'File zip khong co manifest.json'; exit 1 }
        $src = $mf.DirectoryName
    } else {
        # Nguon la thu muc (o dia / thu muc mang \\may-chu\...)
        if (-not (Test-Path $source)) { Write-UpdLog "Khong truy cap duoc nguon: $source"; exit 1 }
        $src = $source
    }

    $remote = Get-ManifestInfo (Join-Path $src 'manifest.json')
    if (-not (Test-OurExtension $remote)) { Write-UpdLog "Nguon khong phai tien ich hop le: $src"; exit 1 }
    $remoteVer = [string]$remote.version
    if ((Compare-Version $remoteVer $localVer) -le 0) { exit 0 }

    # Chep moi thu TRU manifest.json (giu dong bo, xoa file da bo o ban moi), roi chep manifest.json sau cung
    $rc = Start-Process -FilePath 'robocopy.exe' -ArgumentList @(
        "`"$src`"", "`"$targetFull`"", '/MIR', '/XF', 'manifest.json', '/XD', '.git', '.claude',
        '/R:3', '/W:2', '/NFL', '/NDL', '/NJH', '/NJS', '/NP') -NoNewWindow -Wait -PassThru
    if ($rc.ExitCode -ge 8) { Write-UpdLog "Chep file loi (robocopy $($rc.ExitCode)) - giu ban cu $localVer"; exit 1 }
    Copy-Item -Path (Join-Path $src 'manifest.json') -Destination (Join-Path $targetFull 'manifest.json') -Force
    Write-UpdLog "Da cap nhat $localVer -> $remoteVer (tien ich tu tai lai trong 1 phut)"
    exit 0
} catch {
    Write-UpdLog ('Loi: ' + $_.Exception.Message)
    exit 1
} finally {
    if ($tmp -and (Test-Path $tmp)) { Remove-Item -Path $tmp -Recurse -Force -ErrorAction SilentlyContinue }
}
