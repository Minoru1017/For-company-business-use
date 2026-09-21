# 公司電腦：透過 Tailscale 讓新竹主機睡眠（需新竹先執行 start_hsinchu_host_agent.cmd）
param(
    [string]$HostIp = "",
    [string]$Token = "",
    [ValidateSet("sleep", "hibernate")]
    [string]$Mode = "sleep"
)

$ErrorActionPreference = "Stop"
$configPath = Join-Path $env:APPDATA "CallCoachRemoteHsinchu\config.json"

function Load-Config {
    if (-not (Test-Path $configPath)) { return $null }
    Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Save-Config($cfg) {
    $dir = Split-Path $configPath
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
    $cfg | ConvertTo-Json | Set-Content -Path $configPath -Encoding UTF8
}

$cfg = Load-Config
if (-not $HostIp -and $cfg.host_ip) { $HostIp = $cfg.host_ip.Trim() }
if (-not $Token -and $cfg.host_token) { $Token = $cfg.host_token.Trim() }
$port = if ($cfg.agent_port) { [int]$cfg.agent_port } else { 8769 }

if (-not $HostIp) {
    $HostIp = Read-Host "新竹 Tailscale IP（例 100.126.54.41）"
}
if (-not $Token) {
    $Token = Read-Host "Host Token（新竹 host agent 視窗顯示）"
}
Save-Config @{ host_ip = $HostIp; host_token = $Token; agent_port = $port }

$uri = "http://${HostIp}:${port}/host/sleep"
$headers = @{ "X-Call-Coach-Host-Token" = $Token }
$body = @{ mode = $Mode } | ConvertTo-Json

Write-Host "正在請求新竹主機進入 $(if ($Mode -eq 'hibernate') { '休眠(hibernate)' } else { '睡眠(sleep)' })…"
try {
    $r = Invoke-RestMethod -Method POST -Uri $uri -Headers $headers -Body $body -ContentType "application/json; charset=utf-8" -TimeoutSec 15
    Write-Host "OK: $($r.message)"
} catch {
    Write-Host "失敗: $($_.Exception.Message)"
    Write-Host "請確認：① 新竹已執行 start_hsinchu_host_agent.cmd  ② Windows 防火牆允許連入 ${port}  ③ Token 正確"
    exit 1
}
