// 一次性派生脚本：presets/report-mode/agent.cordis.yml → presets/report-ptc/agent.cordis.yml
// 三处受控差异：①头部说明 ②领域工作方式加一条 PTC 引导 ③行清单尾加选择器行。其余逐字同源。
// 重跑安全：派生是幂等的（每次都从 report-mode 源重新生成）。
// 用法：node scripts/derive-report-ptc.mjs（生成）/ --check（只比对，gate 用：防止
// report-mode 改了但变体没重新派生，导致 report-ptc 静默落后于语义源）。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DEST = join(ROOT, 'presets', 'report-ptc', 'agent.cordis.yml')
const CHECK = process.argv.includes('--check')
const src = readFileSync(join(ROOT, 'presets', 'report-mode', 'agent.cordis.yml'), 'utf8')
const lines = src.split('\n')

const header = [
  '# 「报表模式（PTC）」实验变体 —— 与 report-mode 同源 + PTC 工具呈现选择器（2026-11-21）。',
  '# 语义源：本文件由 presets/report-mode/agent.cordis.yml 派生，受控差异仅三处：',
  '#   ① 本头部说明；② 领域工作方式加一条 run_code 批量引导；③ 行清单尾加',
  '#   tool-presentation 选择器行（mode: both）。其余内容逐字同源，改动请先改 report-mode',
  '#   再重新派生，不要在本文件直接改共性行。日常报表工作用 report-mode；本变体仅用于',
  '#   ptc-ab A/B 量化实验。同步：node scripts/sync-preset.mjs（同步两个预设行）。',
]

const guidanceAnchor = '      - 样式、交互、填报等运行期结论必须来自真实预览或用户确认，不能只凭静态检查。'
const guidanceLines = [
  '      - 同类工具操作 ≥5 次、或固定多步序列（读→改→校验→门禁）时，优先用 run_code 写一段',
  '        TypeScript 程序批量完成（配方见 get_capabilities({section:"ptc.recipes"})）；单次',
  '        调用不用它。工具调用与结果留在程序内，只有最终摘要进入对话。',
]

const selectorComment = [
  '',
  '# ── PTC 呈现选择器（实验变体，2026-11-21）─────────────────────────────────────',
  '# 复刻 ptc-ab A/B 实验形态：mode=both 时原生工具 schema 全部保留，另挂 run_code + 生成的',
  '# TypeScript SDK——模型可把 ≥5 次同类调用或固定多步序列写成一段程序，中间结果留在程序内',
  '# 不进对话（批量配方见 get_capabilities({section:"ptc.recipes"})）。',
  '# 运行时未就绪时选择器优雅回退 native（不阻断启动）；宿主未组合 ptcRuntime 时 run_code',
  '# 不出现，A/B 前置清单第 2 步会当场发现（届时按 README 补挂 dsh-ptc-runtime-node 行）。',
  '# 注：官方已把新配置指向 dsh-tool-executor-ptc 直挂形态；本实验沿用选择器的 both 形态',
  '# 正是为了其优雅回退语义——executor 行在无 runtime 时会阻断应用启动（其 README 明文）。',
]
const selectorRow = [
  '- id: tool-presentation-ptc',
  "  name: '@deepseek-ai/dsh-agent-tool-presentation'",
  '  config:',
  '    mode: both',
]

const anchorIdx = lines.indexOf(guidanceAnchor)
if (anchorIdx < 0) throw new Error('persona 引导锚点行未找到（report-mode 源已变？）')

const tail = lines.slice(anchorIdx + 1)
while (tail.length && tail[tail.length - 1] === '') tail.pop()

const out = [
  ...header,
  ...lines.slice(0, anchorIdx + 1),
  ...guidanceLines,
  ...tail,
  ...selectorComment,
  ...selectorRow,
  '',
]

const text = out.join('\n')
if (CHECK) {
  const current = existsSync(DEST) ? readFileSync(DEST, 'utf8') : ''
  if (current !== text) {
    console.error('\n✗ report-ptc 变体与 report-mode 源不同源（派生已过期）。')
    console.error('  处置：node scripts/derive-report-ptc.mjs，然后把 presets/report-ptc 一起提交。\n')
    process.exit(1)
  }
  console.log('  ✓ report-ptc 与 report-mode 同源派生一致')
} else {
  mkdirSync(join(ROOT, 'presets', 'report-ptc'), { recursive: true })
  writeFileSync(DEST, text, 'utf8')
  console.log('written:', DEST.replace(ROOT + '\\', '').replace(ROOT + '/', '') + ',', out.length, 'lines')
}
