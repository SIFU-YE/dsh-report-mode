#!/usr/bin/env node
/**
 * 发布前门禁：**密钥 + 可迁移性**。
 *
 * 报表模式的原始预设里带着真实的库口令、内网主机名、本机绝对路径和 reasonix 状态目录。
 * 这些内容一旦推上 Gitee（哪怕是私有仓库），就必须按"已泄漏"处理：私有不是安全边界，
 * 仓库可能被分享、被镜像、被协作者 clone。所以每次发布前跑这个脚本，命中即失败。
 *
 * 检查三类东西：
 *   1. 通用模式：口令/token 赋值、内网与私网地址、Windows 用户目录绝对路径；
 *   2. **可迁移性**：盘符绝对路径、固定 Program Files 下的 Git 安装位置——写死它们
 *      会让"换机器/换盘符/换用户名"直接失效（0.1.24 起并入本门禁）；
 *   3. 本机历史值：从原始预设里出现过的具体口令与主机名，防止改造后被改回来。
 *
 * 允许的写法是**占位符与环境变量**：`<DSH_HOME>`、`<盘符>`、`<tgz 路径>`、
 * `!!js process.env.X`、`%USERPROFILE%`、`$APPDATA` 等都不算命中。
 *
 * 用法： node scripts/scan-secrets.mjs [--root <dir>]
 * 退出码：0 通过；1 命中。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(process.argv.includes('--root') ? process.argv[process.argv.indexOf('--root') + 1] : join(dirname(fileURLToPath(import.meta.url)), '..'))

/** 扫描时跳过的目录：都不是发布内容。 */
const SKIP_DIRS = new Set(['.git', 'node_modules', '.trash', '.work', 'dist'])
/** 跳过的大文件类型（二进制/打包产物由源文件间接覆盖）。 */
const SKIP_EXT = new Set(['.tgz', '.png', '.jpg', '.ico', '.zip', '.pdf'])
/** 单文件扫描上限：超过就说明是产物而非源码。 */
const MAX_BYTES = 2 * 1024 * 1024

const RULES = [
  // 通用：明文口令赋值
  [/^\s*(?:MYSQL_PASSWORD|MYSQL_PASSWD|DB_PASSWORD|PASSWORD|PASSWD)\s*[:=]\s*(?!['"]?\s*$)(?!.*\$\{)(?!.*!!js)(?!your_)(?!\s*$)\S+/im, '明文口令赋值'],
  // 通用：私网 IP（含历史测试库地址）
  [/\b(?:10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}\b/, '私有 IP 地址'],
  // 通用：内网域名（example.internal 等保留域名除外）
  [/\b[a-z0-9-]+\.(?:internal|corp|intranet)\b/i, '内网主机名'],
  // 通用：Windows 用户目录绝对路径
  // 排除占位写法（C:\Users\<你>\、C:\Users\you\、%USERNAME%），它们出现在文档模板里是正常的；
  // 真实账号名紧跟反斜杠，所以用"占位名 + 反斜杠"来排除，不会漏掉类似 young 这样的真账号。
  [/[A-Za-z]:\\Users\\(?!<|you\\|your\\|username\\|用户名\\|%USERNAME%)[^\\\s'"]+\\/i, 'Windows 用户目录绝对路径'],

  // 通用：可迁移性——盘符绝对路径与固定安装位置（占位符/环境变量写法不命中）
  [/(?:^|[^A-Za-z0-9_])[A-Za-z]:[\\/]/, '盘符绝对路径（换机器/换盘符即失效）'],
  [/Program Files[\\/]Git/i, '固定 Program Files 下的 Git 安装路径'],

  // 通用：常见 token 形态（Gitee/GitHub 私有令牌、AWS、Slack）
  [/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/, 'GitHub 令牌'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS Access Key'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, 'Slack 令牌'],
  [/\b[0-9a-f]{40}\b(?=[^\n]*token)/i, '疑似 40 位十六进制令牌'],

  // 通用：真实 PII（示例域名/本机地址放行；命中只报规则，不回显内容）
  [/(?<!\d)1[3-9]\d{9}(?!\d)/, '疑似真实手机号'],
  [/(?<!\d)[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?!\d)/, '疑似身份证号'],
  [/[A-Za-z0-9._%+-]+@(?!example\.(?:com|org|net)\b|localhost\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, '非示例邮箱'],
]

/**
 * 历史敏感值的 **SHA-256 白名单**：不把明文写回仓库，但保留"改造被回退"的检测能力。
 * 覆盖历史账号、口令片段、内网主机与私网 IP；命中时只报告"哈希比对命中"，不回显值。
 */
const HISTORICAL_SHA256 = new Map([
  ['c643ca41020677fe283de2ad3a09e913488e867fb44de8da5ecd73c5cd98a545', 'Doris 账号（历史值哈希）'],
  ['bcf08ad11b2aaeb0cca9a93275f3ff663bf987f5d50cb1955d1b1581151df8f9', 'MySQL 填报账号（历史值哈希）'],
  ['ab862b6c729c55fec4ceba00d9130b280dec2368272f778b815a11e610d9928f', '测试库只读账号（历史值哈希）'],
  ['948e58617cee31a2a0f0e06c16ab32cf26b7ff8b92a1fffa058fbb57179b887b', '账号口令组合（历史值哈希）'],
  ['0bf345ef76ae4b8308e46b86d9ec2720cf6f87b1ee32e704b4fd598a562a5b18', '账号口令组合（历史值哈希）'],
  ['e014d6a71e5026d99faeac5f609ed59f0b3c7c5f39969169e02148b9ae11a212', '口令片段（历史值哈希）'],
  ['2ad3bbee07640ebe5a4c2291261c212008cd4f579bfabcab971c65f65519d1de', '口令片段（历史值哈希）'],
  ['6a782315e480b313d60f2f7b8be8883109e4d29fab1d408b6b6ae2fbed533dcd', '内网主机名（历史值哈希）'],
  ['91860607d411613f7c2f7bada9689e7617ab0841a1835fafac957de219e95a1d', '内网 IP（历史值哈希）'],
])
/** 哈希比对的分词：去掉空白与常见分隔符后逐 token 比对，避免把整行拼接口令误判为安全。 */
const TOKEN_SPLIT = /[\s"'`()\[\]{}<>;,:=/]+/
const sha256 = (value) => createHash('sha256').update(value).digest('hex')


/** 明确的例外：注释与模板里出现这些词是允许的。 */
const ALLOW_LINE = [
  /环境变量/,
  /模板/,
  /占位/,
  /checklist/i,
  /本机历史值/,
  /scan-secrets/,
  /reasonix 旧路径/,   // 说明凭据查找顺序时的文字描述
  /\bexample\.(?:internal|com|org|net)\b/i, // RFC 保留示例域名
  /\b(?:user:token|token)@(?:gitee|github)\.com\b/i, // 文档里的占位凭据示例
]

const findings = []

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === '.git') continue;
    const abs = join(dir, entry)
    const stat = statSync(abs)
    if (stat.isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue
      walk(abs)
      continue
    }
    if (!stat.isFile() || stat.size > MAX_BYTES) continue
    const ext = entry.slice(entry.lastIndexOf('.')).toLowerCase()
    if (SKIP_EXT.has(ext)) continue

    const rel = relative(ROOT, abs).replace(/\\/g, '/')
    const text = readFileSync(abs, 'utf8')
    const lines = text.split('\n')
    for (const [pattern, label] of RULES) {
      lines.forEach((line, index) => {
        if (!pattern.test(line)) return
        if (ALLOW_LINE.some((allow) => allow.test(line))) return
        findings.push({ file: rel, line: index + 1, label })
      })
    }
    // 历史敏感值只比对 SHA-256，仓库里不出现明文（见 HISTORICAL_SHA256）。
    lines.forEach((line, index) => {
      if (ALLOW_LINE.some((allow) => allow.test(line))) return
      const hit = line.split(TOKEN_SPLIT).some((token) => token.length >= 4 && HISTORICAL_SHA256.has(sha256(token)))
      if (!hit) return
      findings.push({ file: rel, line: index + 1, label: '历史敏感值（哈希比对）', text: '（值已隐藏）' })
    })
  }
}

console.log(`\ndsh-report-mode · 发布前门禁（密钥 + 可迁移性）\n  根目录：${ROOT}\n`)
walk(ROOT)

if (findings.length === 0) {
  console.log('  ✓ 未发现明文凭据、内网主机名、本机绝对路径或真实 PII')
  console.log('  ✓ 未发现盘符绝对路径 / 固定安装位置（换机器不用改代码）\n')
  process.exit(0)
}

console.error(`  ✗ 命中 ${findings.length} 处，禁止发布：\n`)
for (const finding of findings) {
  console.error(`    ${finding.file}:${finding.line}  [${finding.label}]`)
}
console.error('\n  处置：把值移到 <DSH_HOME>/.env 并在配置里写 !!js process.env.X；')
console.error('  与环境无关的说明性文字请改成占位符（<DSH_HOME> / <盘符> / <tgz 路径>）；')
console.error('  确属说明性文字且必须保留原样时，在 scripts/scan-secrets.mjs 的 ALLOW_LINE 里精确放行。\n')
process.exit(1)
