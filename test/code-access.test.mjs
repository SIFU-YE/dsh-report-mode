// test/code-access.test.mjs —— 报表模式「按需代码执行」租约的护栏（2026-11-23）
//
// 目标：在不启动宿主的前提下（仓库内 @deepseek-ai/dsh-tools 不可解析），用可执行的
// 单测覆盖安全语义：环境清洗、凭据文件护栏、租约 TTL、真实进程执行与超时；
// 行模块（code-access.mjs）用源码级断言锁定「常态不注册 run_script」。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  BLOCKED_PROXY, DEFAULT_TIMEOUT_MS, DEFAULT_TTL_MIN, LeaseStore, MAX_TTL_MIN,
  MAX_TIMEOUT_MS, buildEnv, clampTimeoutMs, clampTtlMinutes, deniedReason,
  resetInterpreterCache, resolveInterpreter, runProcess,
} from '../lib/code-access-core.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROW_SRC = readFileSync(join(ROOT, 'lib', 'code-access.mjs'), 'utf8');

test('环境清洗：不向子进程透传任何 harness/MCP/凭据变量', () => {
  const env = buildEnv({
    PATH: '/opt/bin',
    SystemRoot: '/sys-root',
    TEMP: '/tmp-area',
    LITELLM_MASTER_KEY: 'sk-secret',
    REPORT_HOME: '/report-home',
    CPT_DB_CONNECTIONS: 'host=1',
    DSH_PROFILE: 'desktop',
    OPENVIKING_TOKEN: 'ov-token',
    GITHUB_TOKEN: 'gh-token',
    HTTP_PROXY: 'http://real-proxy:8080',
    RANDOM_UNLISTED: 'x',
  });
  // 运行时必需变量保留（Windows 大小写不敏感，按原样保留）
  assert.equal(env.PATH, '/opt/bin');
  assert.equal(env.SystemRoot, '/sys-root');
  assert.equal(env.TEMP, '/tmp-area');
  // 凭据/业务变量一律不出现
  for (const key of ['LITELLM_MASTER_KEY', 'REPORT_HOME', 'CPT_DB_CONNECTIONS', 'DSH_PROFILE', 'OPENVIKING_TOKEN', 'GITHUB_TOKEN', 'RANDOM_UNLISTED']) {
    assert.equal(env[key], undefined, `${key} 不得透传给子进程`);
  }
  // 编码与网络阻断变量由我们注入（不继承外部代理）
  assert.equal(env.PYTHONUTF8, '1');
  assert.equal(env.PYTHONIOENCODING, 'utf-8');
  assert.equal(env.HTTP_PROXY, BLOCKED_PROXY);
  assert.equal(env.HTTPS_PROXY, BLOCKED_PROXY);
});

test('凭据文件护栏：引用 .env / 实例键 / ssh 配置的代码被拒', () => {
  for (const code of [
    "open('.env').read()",
    "json.load(open('dsh-instance-keys.json'))",
    "cat ~/.ssh/id_rsa",
    "readFileSync('credentials.json')",
    "os.environ['OPENVIKING_TOKEN']",
  ]) {
    assert.notEqual(deniedReason(code), null, `应拒绝：${code}`);
  }
  // 正常计算型代码不被误伤（os.environ 含 ".env" 子串，必须不误判）
  for (const code of [
    'print(2 + 3)',
    "const fs = require('fs'); console.log(fs.readdirSync('.').length)",
    "open('需求清单.xlsx','rb')",
    "env = os.environ.get('PATH')",
  ]) {
    assert.equal(deniedReason(code), null, `不应拒绝：${code}`);
  }
});

test('上限夹取：TTL 与超时都有默认值与硬上限', () => {
  assert.equal(clampTtlMinutes(undefined), DEFAULT_TTL_MIN);
  assert.equal(clampTtlMinutes(0), DEFAULT_TTL_MIN);
  assert.equal(clampTtlMinutes(-5), DEFAULT_TTL_MIN);
  assert.equal(clampTtlMinutes(1), 1);
  assert.equal(clampTtlMinutes(9999), MAX_TTL_MIN);
  assert.equal(clampTimeoutMs(undefined), DEFAULT_TIMEOUT_MS);
  assert.equal(clampTimeoutMs(10), 1_000);
  assert.equal(clampTimeoutMs(9_999_999), MAX_TIMEOUT_MS);
});

test('租约状态机：授予、按会话隔离、TTL 过期、撤销', () => {
  let now = 1_000;
  const store = new LeaseStore(() => now);
  const lease = store.grant('s1', 60_000, { reason: 'xlsx->sql', workspace: '/ws' });
  assert.equal(store.get('s1').token, lease.token);
  assert.equal(store.get('s2'), null, '不同会话互不可见');
  assert.equal(store.remainingMs('s1'), 60_000);
  now += 59_999;
  assert.notEqual(store.get('s1'), null);
  now += 1;                              // 到期
  assert.equal(store.get('s1'), null, '到期后不得再用');
  assert.equal(store.revoke('s1'), false, '过期租约撤销返回 false');
  store.grant('s3', 1_000);
  assert.equal(store.revoke('s3'), true);
  assert.equal(store.get('s3'), null);
});

test('解释器解析：node 用宿主自带可执行文件（不依赖 PATH）', () => {
  resetInterpreterCache();
  const node = resolveInterpreter('node');
  assert.ok(node, 'node 解释器必须始终可用');
  assert.equal(node.cmd, process.execPath);
});

test('真实执行：脚本在指定 cwd 运行，stdout/exitCode/耗时可用', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'code-access-test-'));
  try {
    await writeFile(join(dir, 'data.txt'), 'hello', 'utf8');
    const node = resolveInterpreter('node');
    const result = await runProcess(node.cmd, ['-e', "process.stdout.write(require('fs').readFileSync('data.txt','utf8'))"], {
      cwd: dir, env: buildEnv(), timeoutMs: 15_000,
    });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, 'hello', 'cwd 必须是调用方指定的工作区');
    assert.equal(result.timedOut, false);
    assert.ok(result.durationMs >= 0);
    assert.equal(result.truncated, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('真实执行：超时强杀并标记 timedOut', async () => {
  const node = resolveInterpreter('node');
  const result = await runProcess(node.cmd, ['-e', 'setTimeout(() => {}, 60000)'], {
    cwd: tmpdir(), env: buildEnv(), timeoutMs: 1_000,
  });
  assert.equal(result.timedOut, true, '超时必须被标记');
  assert.ok(result.durationMs < 15_000, '不得无限等待');
});

test('行模块：每个 defineTool 都必须显式给 parameters（宿主空参数工具也强校验）', () => {
  // 2026-11-23 线上事故：release_code_access 漏写 parameters，宿主抛
  // "code-access (...): unsupported JSON schema: parameters must be an object of value schemas"，
  // 整个 code-access 行 never started，报表模式直接起不来。
  const toolCount = (ROW_SRC.match(/defineTool\(\{/g) || []).length;
  const paramCount = (ROW_SRC.match(/^\s+parameters:/gm) || []).length;
  assert.equal(toolCount, 3, `code-access 应定义 3 个工具，实际 ${toolCount}`);
  assert.equal(paramCount, toolCount, `每个 defineTool 都必须有 parameters（${paramCount}/${toolCount}）；空参数工具写 parameters: {}`);
  assert.match(ROW_SRC, /parameters: \{\}/, '无参数工具（release_code_access）必须显式写 parameters: {}');
  // 参数类型只允许宿主 value-schema 支持的字面量（string/number/boolean/array/object）。
  // 只看参数规格形态（带 required/description），避免误伤 render 里的 content block（type:'text'）。
  const allowed = new Set(['string', 'number', 'boolean', 'array', 'object']);
  for (const match of ROW_SRC.matchAll(/type: '([a-z]+)',\s*(?:required: true|description)/g)) {
    assert.ok(allowed.has(match[1]), `未知 value-schema 类型 ${match[1]}（宿主会拒绝）`);
  }
});

test('行模块：常态只注册申请/释放工具，run_script 仅在租约内动态注册', () => {
  // 包名/依赖契约
  assert.match(ROW_SRC, /export const name = 'dsh-report-mode-code-access'/);
  assert.match(ROW_SRC, /export const inject = \['tools'\]/);
  assert.match(ROW_SRC, /from '@deepseek-ai\/dsh-tools'/);
  // 工具名集中定义
  assert.match(ROW_SRC, /run: 'run_script'/);
  assert.match(ROW_SRC, /request: 'request_code_access'/);
  assert.match(ROW_SRC, /release: 'release_code_access'/);
  // 常态注册：只有 request/release 两处 + ensureRunTool 内一处（租约触发）
  const registerCalls = (ROW_SRC.match(/ctx\.tools\.register\(/g) || []).length;
  assert.equal(registerCalls, 3, '注册点只有 3 处：request、release、ensureRunTool 内的 run_script');
  assert.match(ROW_SRC, /const ensureRunTool = \(\) => \{/, 'run_script 必须由租约触发的 ensureRunTool 注册');
  // ensureRunTool 只允许在申请处理器里被调用（不在 apply 主体直接调用）
  const ensureCalls = (ROW_SRC.match(/ensureRunTool\(\)/g) || []).length;
  assert.equal(ensureCalls, 1, 'ensureRunTool() 只能在申请成功后调用一次');
  // 释放/到期必须注销动态工具
  assert.match(ROW_SRC, /const dropRunTool = \(\) => \{/);
  assert.match(ROW_SRC, /setTimeout\(\(\) => \{[\s\S]{0,180}dropRunTool\(\)/, '租约到期定时器必须注销 run_script');
  // 申请必须显式确认
  assert.match(ROW_SRC, /args\?\.confirm !== true/, 'confirm 必须强校验');
  // 敏感逻辑不重复实现：复用 core 的清洗/护栏
  assert.match(ROW_SRC, /from '\.\/code-access-core\.mjs'/);
  assert.match(ROW_SRC, /buildEnv/);
  assert.match(ROW_SRC, /deniedReason/);
});
