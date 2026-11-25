# dsh-report-mode 一键安装 / 升级
#
# 做四件事（每一步都有前置检查，失败即停，不静默继续）：
#   1. 确认/安装补丁基准版本的原版 @nanmicoder/dsh-agent-teams
#   2. 安装本插件（tgz 或 git 地址）
#   3. 干跑 + 实做 AgentTeams 适配补丁，并 verify
#   4. 若 <DSH_HOME>\.env 不存在，从模板生成一份
#
# 用法：
#   pwsh -File install\install.ps1                          # 从本仓库当前目录安装
#   pwsh -File install\install.ps1 -Spec file:<tgz 的完整路径>   # 指定插件来源（占位符换成真实路径）
#   pwsh -File install\install.ps1 -Profile web             # 换 profile
#   pwsh -File install\install.ps1 -DshHome "<DSH_HOME>"    # 非默认 DSH 安装位置
#   pwsh -File install\install.ps1 -WhatIfOnly              # 只打印将要执行的命令
#
# 注意：本脚本不重启 DSH。装完请手动重启，再按 docs/INSTALL.md 第 5 节的清单验收。

[CmdletBinding()]
param(
  [string]$Profile = 'desktop',
  [string]$Spec = '',
  [string]$DshHome = '',
  [switch]$SkipAgentTeams,
  [switch]$WhatIfOnly
)

$ErrorActionPreference = 'Stop'
# 兼容不同 DSH 安装位置：优先 DSH_HOME 环境变量，其次 ~/.dsh。
if ([string]::IsNullOrWhiteSpace($DshHome)) {
  $DshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
}
$repoRoot = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content (Join-Path $repoRoot 'patches\manifest.json') -Raw | ConvertFrom-Json
$baseVersion = $manifest.version
$patchTool = Join-Path $repoRoot 'tools\apply-patch.mjs'

function Write-Step($text) { Write-Host "`n=== $text ===" -ForegroundColor Cyan }
function Write-Ok($text) { Write-Host "  ✓ $text" -ForegroundColor Green }
function Write-Info($text) { Write-Host "  · $text" -ForegroundColor Gray }
function Fail($text) { Write-Host "`n✗ $text`n" -ForegroundColor Red; exit 1 }

function Invoke-Cmd([string]$exe, [string[]]$arguments) {
  $display = "{0} {1}" -f $exe, ($arguments -join ' ')
  if ($WhatIfOnly) { Write-Info "[dry-run] $display"; return }
  Write-Info $display
  & $exe @arguments
  if ($LASTEXITCODE -ne 0) { Fail "命令失败（退出码 $LASTEXITCODE）：$display" }
}

# ── 0. 找 dsh ───────────────────────────────────────────────────────────────
Write-Step '0/4 定位 dsh'
$dsh = $null
$shim = Join-Path $env:APPDATA "DSH Desktop\host-commands\$Profile\bin\dsh.cmd"
if (Test-Path $shim) { $dsh = $shim }
else {
  $found = Get-Command dsh -ErrorAction SilentlyContinue
  if ($found) { $dsh = $found.Source }
}
if (-not $dsh) { Fail "找不到 dsh（既没有 $shim，也不在 PATH 上）。请从 DSH 应用内启动带 shell 的会话执行本步骤。" }
Write-Ok "dsh = $dsh"

# ── 1. 原版 AgentTeams ──────────────────────────────────────────────────────
Write-Step "1/4 补丁基准：@nanmicoder/dsh-agent-teams@$baseVersion"
$installed = Join-Path $DshHome "profiles\$Profile\node_modules\@nanmicoder\dsh-agent-teams\package.json"
if ($SkipAgentTeams) {
  Write-Info '按 -SkipAgentTeams 跳过（假定你已自行处理）'
} elseif (Test-Path $installed) {
  $current = (Get-Content $installed -Raw | ConvertFrom-Json).version
  if ($current -eq $baseVersion) { Write-Ok "已是基准版本 $current" }
  else {
    Write-Info "当前 $current != 基准 $baseVersion，安装基准版本"
    Invoke-Cmd $dsh @('plugin', '--profile', $Profile, 'add', "@nanmicoder/dsh-agent-teams@$baseVersion")
  }
} else {
  Write-Info '未安装，安装基准版本'
  Invoke-Cmd $dsh @('plugin', '--profile', $Profile, 'add', "@nanmicoder/dsh-agent-teams@$baseVersion")
}

# ── 2. 本插件 ───────────────────────────────────────────────────────────────
Write-Step '2/4 安装 dsh-report-mode'
if ($Spec -eq '') {
  $tgz = Get-ChildItem (Join-Path $repoRoot 'dsh-report-mode-*.tgz') -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($tgz) { $Spec = "file:$($tgz.FullName)" } else { $Spec = "file:$repoRoot" }
}
Write-Ok "来源：$Spec"
Invoke-Cmd $dsh @('plugin', '--profile', $Profile, 'add', $Spec)

# ── 3. 补丁 ─────────────────────────────────────────────────────────────────
Write-Step '3/4 应用 AgentTeams 适配补丁'
if (-not (Test-Path $patchTool)) { Fail "找不到补丁工具：$patchTool" }
Invoke-Cmd 'node' @($patchTool, '--mode', 'check', '--profile', $Profile)
Invoke-Cmd 'node' @($patchTool, '--mode', 'apply', '--dry-run', '--profile', $Profile)
Invoke-Cmd 'node' @($patchTool, '--mode', 'apply', '--profile', $Profile)
Invoke-Cmd 'node' @($patchTool, '--mode', 'verify', '--profile', $Profile)

# ── 4. .env ─────────────────────────────────────────────────────────────────
Write-Step '4/4 凭据文件'
$envFile = Join-Path $DshHome '.env'
$template = Join-Path $repoRoot 'config\report-mode.env.example'
if (Test-Path $envFile) { Write-Ok "$envFile 已存在，未改动（模板见 $template）" }
elseif ($WhatIfOnly) { Write-Info "[dry-run] 复制 $template -> $envFile" }
else {
  Copy-Item $template $envFile
  Write-Ok "已从模板生成 $envFile —— 请填入真实连接信息"
}

Write-Host "`n完成。接下来：" -ForegroundColor Cyan
Write-Host '  1. 编辑 ' -NoNewline; Write-Host $envFile -ForegroundColor Yellow
Write-Host '  2. 重启 DSH'
Write-Host '  3. 按 docs/INSTALL.md 第 5 节的清单逐项验收'
Write-Host '  4. 若旧预设目录 .agent-presets\report 仍在，确认无误后删掉（否则选择器里会出现两个「报表模式」）'
Write-Host '  5. 想撤销补丁：node tools/apply-patch.mjs --mode revert --profile ' -NoNewline; Write-Host $Profile -ForegroundColor Yellow
Write-Host ''

