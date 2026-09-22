# 公司電腦：透過 Tailscale 讓新竹主機睡眠（需新竹先執行 start_hsinchu_host_agent.cmd）
#
#   start_company_remote_sleep.cmd                     互動：先問要不要預約自動喚醒，再睡眠
#   ... -WakeAt 08:00                                  睡眠並預約明早 08:00 自動醒（RTC，不需 WoL）
#   ... -WakeAfterMinutes 480                          睡眠並預約 8 小時後自動醒
#   ... -NoWake                                        直接睡眠，不預約、不詢問
#   ... -Status                                        只查狀態（含排程、下次喚醒），不睡眠
#   ... -ScheduleOnly -WakeAt 08:00                    只預約喚醒，不睡眠
#   ... -CancelWake                                    取消一次性喚醒
param(
    [string]$HostIp = "",
    [string]$Token = "",
    [ValidateSet("sleep", "hibernate")]
    [string]$Mode = "sleep",
    [string]$WakeAt = "",
    [int]$WakeAfterMinutes = 0,
    [switch]$NoWake,
    [switch]$Status,
    [switch]$ScheduleOnly,
    [switch]$CancelWake
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

function Error-Message($err) {
    $detail = $err.Exception.Message
    if ($err.ErrorDetails -and $err.ErrorDetails.Message) {
        try {
            $errBody = $err.ErrorDetails.Message | ConvertFrom-Json
            if ($errBody.message) { $detail = $errBody.message }
        } catch { }
    }
    return $detail
}

$cfg = Load-Config
if (-not $HostIp -and $cfg.host_ip) { $HostIp = $cfg.host_ip.Trim() }
if (-not $Token -and $cfg.host_token) { $Token = $cfg.host_token.Trim() }
$port = if ($cfg.agent_port) { [int]$cfg.agent_port } else { 8769 }

if (-not $HostIp) {
    $HostIp = Read-Host "新竹 Tailscale IP（例 100.126.54.41）"
}
if (-not $Token) {
    $Token = Read-Host "Host Token（新竹主機代理視窗「複製 Token」）"
}
Save-Config @{ host_ip = $HostIp; host_token = $Token; agent_port = $port }

$base = "http://${HostIp}:${port}"
$headers = @{ "X-Call-Coach-Host-Token" = $Token }

function Invoke-Host($method, $path, $bodyObj) {
    $json = if ($null -ne $bodyObj) { $bodyObj | ConvertTo-Json -Compress } else { $null }
    Invoke-RestMethod -Method $method -Uri "$base$path" -Headers $headers -Body $json -ContentType "application/json; charset=utf-8" -TimeoutSec 15
}

function Show-Status($h) {
    Write-Host "新竹主機：$($h.hostname)  代理 v$($h.agent_version)"
    if ($h.summary) { $h.summary | ForEach-Object { Write-Host "  $_" } }
    if ($h.last_wake) { Write-Host "  最近排程喚醒：$($h.last_wake.time)（$($h.last_wake.reason)）" }
}

try {
    if ($Status) {
        Show-Status (Invoke-Host GET "/host/health" $null)
        exit 0
    }
    if ($CancelWake) {
        $r = Invoke-Host POST "/host/wake/cancel" @{}
        Write-Host "OK: $($r.message)"
        exit 0
    }

    # 預約喚醒：CLI 參數優先；互動時詢問一次
    $wakeBody = @{}
    if ($WakeAt) { $wakeBody.wake_at = $WakeAt }
    elseif ($WakeAfterMinutes -gt 0) { $wakeBody.wake_after_min = $WakeAfterMinutes }
    elseif (-not $NoWake -and -not $ScheduleOnly -and $Mode -eq "sleep") {
        Write-Host ""
        Write-Host "要預約新竹自動醒來嗎？（睡眠後 DeskIn 會斷，Wi-Fi 無法 WoL，只能靠定時喚醒）"
        $ans = Read-Host "輸入時間 HH:MM（例 08:00）或幾分鐘後（例 480）；留空 = 不預約"
        $ans = $ans.Trim()
        if ($ans -match '^\d{1,2}:\d{2}$') { $wakeBody.wake_at = $ans }
        elseif ($ans -match '^\d+$') { $wakeBody.wake_after_min = [int]$ans }
    }

    if ($ScheduleOnly) {
        if ($wakeBody.Count -eq 0) { throw "請提供 -WakeAt HH:MM 或 -WakeAfterMinutes N" }
        $r = Invoke-Host POST "/host/wake/schedule" $wakeBody
        Write-Host "OK: $($r.message)"
        exit 0
    }

    $body = @{ mode = $Mode } + $wakeBody
    $what = if ($Mode -eq 'hibernate') { '休眠(hibernate)' } else { '睡眠(sleep)' }
    Write-Host "正在請求新竹主機進入 $what…"
    $r = Invoke-Host POST "/host/sleep" $body
    Write-Host "OK: $($r.message)"
} catch {
    $detail = Error-Message $_
    Write-Host "失敗: $detail"
    if ($detail -match "時段") {
        Write-Host "（新竹 host_schedule.json 限制遠端睡眠時段；可先用 -Status 查看下次喚醒）"
    } elseif ($detail -match "Token") {
        Write-Host "請到新竹主機代理視窗按「複製 Token」，再刪除 $configPath 重新執行本程式。"
    } else {
        Write-Host "請確認：① 新竹已執行主機代理  ② Windows 防火牆允許連入 ${port}  ③ Token 正確"
    }
    exit 1
}
