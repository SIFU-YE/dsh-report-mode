#!/usr/bin/env node
/**
 * dsh-report-mode 运行时前置检查
 *
 * 目的：换电脑/换 DSH 安装位置后，先确认外部 MCP 命令和环境变量是否就位。
 * 不启动 DSH、不读 .env 内容，只检查命令是否存在。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const isWin = process.platform === 'win32';
const env = process.env;

function resolveCommand(command) {
  if (!command) return null;
  if (path.isAbsolute(command) || command.includes('/') || command.includes('\\')) {
    return fs.existsSync(command) ? command : null;
  }
  const probe = isWin ? 'where' : 'which';
  const result = spawnSync(probe, [command], { stdio: 'ignore' });
  return result.status === 0 ? command : null;
}

const checks = [
  {
    label: 'cpt-mcp',
    command: env.REPORT_CPT_MCP_COMMAND || 'cpt-mcp',
    required: true,
    envName: 'REPORT_CPT_MCP_COMMAND',
    hint: '安装 cpt-mcp（npm install -g <cpt-mcp 目录> 或 npm link），或把 REPORT_CPT_MCP_COMMAND 指向可执行文件',
  },
  {
    label: 'fr-docs-mcp',
    command: env.REPORT_FR_DOCS_MCP_COMMAND || 'fr-docs-mcp',
    required: true,
    envName: 'REPORT_FR_DOCS_MCP_COMMAND',
    hint: '安装 fr-docs-mcp（npm install -g <fr-docs-mcp 目录> 或 npm link），或把 REPORT_FR_DOCS_MCP_COMMAND 指向可执行文件',
  },
  {
    label: 'npx',
    command: 'npx',
    required: false,
    hint: 'mysql / browser MCP 默认通过 npx 启动；建议安装 Node.js 自带 npx',
  },
  {
    label: 'python',
    command: env.REPORT_EXCEL_MCP_PYTHON || 'python',
    required: false,
    envName: 'REPORT_EXCEL_MCP_PYTHON',
    hint: 'excel MCP 需要 Python；如不在 PATH，设置 REPORT_EXCEL_MCP_PYTHON',
  },
];

console.log('dsh-report-mode · 运行时前置检查');
console.log(`  DSH_HOME: ${env.DSH_HOME || '(未设置，按 DSH 默认)'}`);
console.log(`  工作目录: ${process.cwd()}`);
console.log(`  CPT_MCP_ALLOWED_ROOTS: ${env.CPT_MCP_ALLOWED_ROOTS || '(未设置，cpt-mcp 回退到会话工作区/用户主目录)'}`);
console.log('');

let failed = false;
for (const item of checks) {
  const resolved = resolveCommand(item.command);
  const envHint = item.envName ? `（${item.envName}）` : '';
  if (resolved) {
    console.log(`  ✓ ${item.label}${envHint}: ${resolved}`);
  } else if (item.required) {
    failed = true;
    console.log(`  ✗ ${item.label}${envHint}: 未找到`);
    console.log(`    ${item.hint}`);
  } else {
    console.log(`  ! ${item.label}${envHint}: 未找到（可选）`);
    console.log(`    ${item.hint}`);
  }
}

console.log('');
if (failed) {
  console.log('检查失败：请先安装/配置缺失的必需 MCP，再重试。');
  process.exit(1);
}
console.log('必需项已就位。启动 DSH 后可在报表模式会话里验证 MCP 工具是否出现。');
