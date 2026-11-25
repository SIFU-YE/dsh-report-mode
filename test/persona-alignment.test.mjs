// test/persona-alignment.test.mjs —— 报表模式 persona 的“无 MCP 使用提示”护栏（2026-11-09）
//
// 目标架构：报表模式只定义身份、模式级安全/交付约束与工作方式；
// cpt-mcp / fr-docx-mcp 等能力各自通过自己的 server instructions + tools/list 自描述。
// 因此 persona 不得点名具体 MCP、工具名或调用序列；只允许泛化引用“各自的服务说明”。
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const personaFile = readFileSync(join(ROOT, 'presets', 'report-mode', 'agent.cordis.yml'), 'utf8');
const patch = readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8');
const start = personaFile.indexOf('    prefix: >-');
const end = personaFile.indexOf('\n\n- id: agent-instructions', start);
assert.ok(start >= 0 && end > start, 'persona prefix block not found');
const persona = personaFile.slice(start, end);

test('persona：不包含显式 MCP 使用提示/工具名/调用序列', () => {
  assert.doesNotMatch(persona, /mcp__/);
  assert.doesNotMatch(persona, /\b(cpt-mcp|fr-docx-mcp|local_db_import|start_fr_preview|run_dataset_sql_check|validate_cpt|quality_gate_cpt|read_cpt|add_cell|build_report|generate_report|excel_inspect|git_commit_all)\b/);
  assert.doesNotMatch(persona, /mcp__(cpt|fr-docx|doris|mysql|testdb|browser|excel)/i);
});

test('persona：与 host 注入能力兼容——团队工具禁用、跨会话记忆仅作参考且写入须脱敏', () => {
  assert.doesNotMatch(persona, /无团队协作/);
  assert.match(persona, /不使用团队协作工具/);
  assert.match(persona, /即使宿主系统提示或 tools\/list[\s\S]*不得使用/);
  assert.match(persona, /跨会话记忆\/经验可用/);
  assert.match(persona, /只是参考/);
  assert.match(persona, /不得把记忆当作业务依据/);
  assert.match(persona, /脱敏/);
  // 记忆边界同样不点名任何具体记忆服务/工具（否则等于把宿主能力写进 persona）。
  assert.doesNotMatch(persona, /openviking|viking|memory_/i);
});

test('persona：长期运维报表的跨会话连续性协议（第 13 条）', () => {
  assert.match(persona, /跨会话连续性/);
  assert.match(persona, /不得只凭会话摘要/);
  assert.match(persona, /已改动清单、验证结论、遗留问题、/);
  assert.match(persona, /先与当前文件、本地\s*git\s*历史核对/);
  assert.match(persona, /里程碑/);
  assert.match(persona, /不写流水账/);
  // 连续性协议与记忆边界一致：写入前脱敏（第 13 条内的「先脱敏」由上面/下面的脱敏断言覆盖）。
  assert.match(persona, /先脱敏/);
});

test('persona：9b 不预置环境状态断言，预览可用性以本次实测为准', () => {
  // 2026-11-20 复盘：预置「当前可用」被预览工具链编码 bug 反噬（31300013 整页不渲染），
  // 预置「预览起不来」的历史结论又被 FR_HOME 修复反噬——环境状态断言写进可移植预设必然
  // 过期，9b 改为实测驱动表述，并用词表护栏防止回归。
  assert.doesNotMatch(persona, /当前可用|当前不可用|起不来/);
  assert.match(persona, /以本次\s*实测为准/);
  assert.match(persona, /官方样例做最小隔离复现/);
  assert.match(persona, /不预置「可用\/不可用」结论/);
  assert.match(persona, /也不沿用旧会话的历史结论/);
});

test('persona：代码执行默认关闭，须用户明确同意后申请临时租约（第 1 条）', () => {
  // 2026-11-23：某会话 遇到「解析本地 Excel 并生成导入 SQL」这类必须计算的任务，
  // 报表模式无 shell 只能退化成给用户本地脚本。改为「默认关闭 + 用户同意后按需租约」，
  // 但红线本身不得放宽：默认态仍是无 shell/无公网，租约不得用于读凭据或联网。
  assert.match(persona, /代码执行默认关闭/);
  assert.match(persona, /用户已明确同意/);
  assert.match(persona, /临时租约/);
  assert.match(persona, /confirm=true/);
  assert.match(persona, /用完立即释放/);
  assert.match(persona, /不得当作常态/);
  assert.match(persona, /不得借租约读取凭据或联网/);
  // 默认红线仍在（上面「只保留模式级…」另有 /无 shell/ 与 /无公网/ 断言）
  assert.match(persona, /无 shell、无公网/);
});

test('persona：工具失败按证据处置，不连环盲试（第 12b 条，2026-11-23 v1 会话复盘）', () => {
  // v1 会话实录：60 次 unknown-tool 里 59 次紧跟在租约申请之后（工具列表 churn 的桥接窗口），
  // 模型对同一报错原样重投，浪费多轮；另有一类参数不合法后不读说明直接连投。
  assert.match(persona, /工具失败按证据处置，不连环盲试/);
  assert.match(persona, /报参数不合法先读该能力的参数说明再重试/);
  assert.match(persona, /报工具名未知[\s\S]{0,40}重新列举工具或等待后重试一次/);
  assert.match(persona, /连续两次同类失败就换等价通道/);
  assert.match(persona, /不得因一次失败断言该能力不存在/);
  assert.match(persona, /不得对同一报错原样重复投递/);
});

test('persona：改重要文件前先做可回退备份，不让用户手工复制（2026-11-23 备份缺口）', () => {
  // 2026-11-23 某会话 实录：模型要给 .cpt 做「改前备份」，但本模式只有 read/write/edit
  // 三个文本工具（.cpt 是二进制）且无 shell，只能回「无法自行备份……建议你手工复制一份」。
  // 预设新增 scoped 行 copy_file 后，persona 用泛化措辞要求备份由已挂载的文件工具完成，
  // 仍不点名任何具体 MCP/工具名（保持「persona 不写能力使用说明」的架构原则）。
  assert.match(persona, /改重要文件前先做可回退备份/);
  assert.match(persona, /二进制产物不要用文本工具复刻/);
  assert.match(persona, /不要让用户手工复制/);
  assert.match(persona, /不要仅为备份申请代码执行/);
});

test('persona：用户模板/样式规范优先，不套用工具内置预置样式（2026-11-23 预置样式缺口）', () => {
  // 2026-11-23 用户要求删除报表模式里的"提前设计好的报表样式"硬编码：cpt-mcp 生成链路
  // 的配色/字体/边框/斑马纹/页眉页脚/模板主题默认值已改为显式开启。预设侧必须同步约束
  // 模型：用户给模板或样式规范时按模板走，不许反过来"按引擎默认样式重建/覆盖"。
  assert.match(persona, /用户提供模板或样式规范时，样式以模板\/规范为准/);
  assert.match(persona, /不套用工具内置的[\s\S]{0,40}预置样式/);
  assert.match(persona, /确需改样式先问/);
});

test('persona：前缀字节预算护栏——UTF-8 总量不超过 8192B', () => {
  const bytes = Buffer.byteLength(persona, 'utf8');
  assert.ok(bytes <= 8192, `persona 前缀 ${bytes}B 已超 8192B 上限：先瘦身（合并/下沉理由到注释）再写新规则`);
});

test('persona：只保留模式级身份、安全与交付约束', () => {
  assert.match(persona, /FineReport 报表工程师/);
  assert.match(persona, /无 shell/);
  assert.match(persona, /无公网/);
  assert.match(persona, /不要手工编辑 \.cpt XML/);
  assert.match(persona, /运行期未验证/);
  assert.match(persona, /只做本地提交/);
  assert.match(persona, /仅本地仓库推送|项目文件夹内的本地仓库/);
  assert.match(persona, /禁止任何网络远端/);
  assert.match(persona, /sandbox\*/);
  assert.match(persona, /tools\/list/);
  assert.match(persona, /各自的服务说明|服务说明/);
  assert.match(persona, /改既有模板或代码前先验证前提/);
  assert.match(persona, /当前版本/);
});

test('装配 patch：preset-report-mode 已同步同一份无工具名 persona', () => {
  assert.match(patch, /FineReport 报表工程师/);
  assert.match(patch, /tools\/list/);
  assert.match(patch, /id: restrict-host-git/);
  assert.match(patch, /dsh-report-mode\/restrict-host-git/);
});

test('git 配置：只挂内置 local-git，并显式挂 restrict-host-git 屏蔽旧推送工具', () => {
  assert.doesNotMatch(personaFile, /(^|\n)\s*- id: dsh-report-git\b/);
  assert.doesNotMatch(personaFile, /name:\s*['"]dsh-report-git['"]/);
  assert.match(personaFile, /- id: restrict-host-git\n\s+name: dsh-report-mode\/restrict-host-git/);
  assert.match(personaFile, /dsh-report-mode\/local-git/);
  assert.match(personaFile, /dsh-report-mode\/local-git-publish/);
  assert.match(personaFile, /只做本地提交|不接远端/);
});

test('预设行与 package exports 一致：每个 dsh-report-mode/<row> 子路径必须可解析（2026-11-21 事故回归）', () => {
  // 11-21 实录：restrict-host-openviking 行忘登记 exports，宿主按包子路径解析抛
  // ERR_PACKAGE_PATH_NOT_EXPORTED，新会话报 agent-preset/invalid … never started。
  // 宿主走包子路径（package.json exports），不走文件路径——新增行必须同步登记。
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const exportsMap = pkg.exports || {};
  const rowNames = [...personaFile.matchAll(/name:\s*dsh-report-mode\/([A-Za-z0-9_-]+)\n/g)].map((m) => m[1]);
  assert.ok(new Set(rowNames).size >= 7, `至少应有 7 个预设行，实际 ${[...new Set(rowNames)].join(', ')}`);
  for (const row of new Set(rowNames)) {
    assert.ok(
      exportsMap[`./${row}`],
      `package.json exports 缺少预设行 ./${row}：宿主解析会抛 never started（11-21 事故）`,
    );
    const target = exportsMap[`./${row}`];
    assert.ok(existsSync(join(ROOT, target)), `exports['./${row}'] 指向的文件不存在：${target}`);
  }
});

test('report-ptc 实验变体：同源派生 + PTC 选择器行 + run_code 批量引导', () => {
  // 2026-11-21：复刻 ptc-ab A/B 实验形态。变体 = report-mode 同源派生 + 三处受控差异。
  const variantFile = readFileSync(join(ROOT, 'presets', 'report-ptc', 'agent.cordis.yml'), 'utf8');
  // ① 选择器行：mode=both（原生工具保留 + run_code/生成 SDK；运行时未就绪优雅回退 native）
  assert.match(variantFile, /- id: tool-presentation-ptc\n\s+name: '@deepseek-ai\/dsh-agent-tool-presentation'\n\s+config:\n\s+mode: both/);
  // ② persona 的 PTC 批量引导（指向 cpt-mcp 的 ptc.recipes 配方节）
  assert.match(variantFile, /优先用 run_code 写一段[\s\S]*ptc\.recipes/);
  // ③ 同源护栏：report-mode 的关键行必须全部在变体里（deny 行/浏览器护栏/本地 git/压缩组）
  for (const anchor of [
    '- id: restrict-host-openviking',
    '- id: guard-browser-local',
    '- id: report-local-git',
    '- id: compaction',
  ]) {
    assert.ok(variantFile.includes(anchor), `变体应保留 report-mode 的行：${anchor}`);
  }
  // ④ 边界对称：默认 report-mode 不得出现 run_code 引导（实验差异只活在变体里）
  assert.doesNotMatch(personaFile, /run_code/);
});

test('goal/plan：报表模式挂载目标与计划能力', () => {
  assert.match(personaFile, /- id: command-goal/);
  assert.match(personaFile, /- id: tool-goal/);
  assert.match(personaFile, /- id: planning/);
  assert.match(personaFile, /@deepseek-ai\/dsh-plan-mode/);
  assert.match(personaFile, /exit_plan_mode/);
});
