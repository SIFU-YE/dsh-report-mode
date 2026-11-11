// test/persona-alignment.test.mjs —— 报表模式 persona 的“无 MCP 使用提示”护栏（2026-11-09）
//
// 目标架构：报表模式只定义身份、模式级安全/交付约束与工作方式；
// cpt-mcp / fr-docx-mcp 等能力各自通过自己的 server instructions + tools/list 自描述。
// 因此 persona 不得点名具体 MCP、工具名或调用序列；只允许泛化引用“各自的服务说明”。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

test('persona：只保留模式级身份、安全与交付约束', () => {
  assert.match(persona, /FineReport 报表工程师/);
  assert.match(persona, /无 shell/);
  assert.match(persona, /无公网/);
  assert.match(persona, /不要手工编辑 \.cpt XML/);
  assert.match(persona, /运行期未验证/);
  assert.match(persona, /只做本地提交/);
  assert.match(persona, /不 push/);
  assert.match(persona, /sandbox\*/);
  assert.match(persona, /tools\/list/);
  assert.match(persona, /各自的服务说明|服务说明/);
});

test('装配 patch：preset-report-mode 已同步同一份无工具名 persona', () => {
  assert.match(patch, /FineReport 报表工程师/);
  assert.match(patch, /tools\/list/);
});

test('git 配置：只挂内置 local-git，不再挂 dsh-report-git/远端工具', () => {
  assert.doesNotMatch(personaFile, /dsh-report-git|restrict-host-git/);
  assert.match(personaFile, /dsh-report-mode\/local-git/);
  assert.match(personaFile, /只做本地提交|不接远端/);
});

test('goal/plan：报表模式挂载目标与计划能力', () => {
  assert.match(personaFile, /- id: command-goal/);
  assert.match(personaFile, /- id: tool-goal/);
  assert.match(personaFile, /- id: planning/);
  assert.match(personaFile, /@deepseek-ai\/dsh-plan-mode/);
  assert.match(personaFile, /exit_plan_mode/);
});
