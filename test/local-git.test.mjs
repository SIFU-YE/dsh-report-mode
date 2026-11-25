// test/local-git.test.mjs —— 报表模式内置本地 git 工具（vendored 自 dsh-plugin-git-workflow）
import test from 'node:test';
import assert from 'node:assert/strict';
import { exec } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { apply, inject, name } from '../lib/local-git/index.mjs';
import * as publishRow from '../lib/local-git-publish/index.mjs';
import { parseBranches } from '../lib/local-git/git.mjs';

const execAsync = promisify(exec);

test('parseBranches：兼容默认输出与 --format=%(HEAD)%(refname:short) 两种形态', () => {
  // 默认 git branch 输出（* 后带空格）
  assert.deepEqual(parseBranches('* main\n  dev\n  feature/x\n').branches, [
    { current: true, name: 'main' },
    { current: false, name: 'dev' },
    { current: false, name: 'feature/x' },
  ]);
  // --format 输出（HEAD 与名字之间无空格）——历史上把 main 读成 ain
  assert.deepEqual(parseBranches('*main\n dev\n').branches, [
    { current: true, name: 'main' },
    { current: false, name: 'dev' },
  ]);
  // CRLF 与空行
  assert.deepEqual(parseBranches('* main\r\n\r\n  dev\r\n').branches, [
    { current: true, name: 'main' },
    { current: false, name: 'dev' },
  ]);
});

function fakeCtx() {
  const tools = [];
  return {
    tools,
    ctx: {
      effect(fn) { return fn(); },
      get() { return undefined; },
      tools: { register(def) { tools.push(def); return () => {}; } },
    },
  };
}

/**
 * 伪装**当前宿主契约**的 shell 服务（2026-11-23 生产事故回归）：
 *   resolve(request) -> spec；execute(spec) -> 句柄；handle.result() -> ShellRunResult
 * 刻意**不提供 run()**：谁再写回旧 API 就会在这里立刻失败，而不是等用户在报表模式里报障。
 * 命令真跑（node:child_process 的 exec），因此验证的是 resolve→execute→result→解析 全链。
 */
function fakeShellCtx({ legacyResultShape = false } = {}) {
  const tools = [];
  const calls = [];
  const shell = {
    resolve(request) {
      calls.push({ kind: 'resolve', request });
      return {
        command: request.command,
        workdir: request.workdir ?? process.cwd(),
        timeoutMs: request.timeoutMs ?? 30000,
        onExpiry: request.onExpiry ?? 'kill',
        stdoutMaxBytes: request.stdoutMaxBytes ?? 1 << 20,
        signal: request.signal,
        sandboxPolicy: undefined,
      };
    },
    async execute(spec) {
      calls.push({ kind: 'execute', spec });
      const run = async () => {
        try {
          const { stdout, stderr } = await execAsync(spec.command, {
            cwd: spec.workdir, windowsHide: true, timeout: spec.timeoutMs,
          });
          return { exitCode: 0, signal: null, timedOut: false, aborted: false, timeoutMs: spec.timeoutMs, stdout: { text: stdout, truncated: false }, stderr: { text: stderr, truncated: false } };
        } catch (error) {
          const code = typeof error.code === 'number' ? error.code : 1;
          return { exitCode: code, signal: null, timedOut: Boolean(error.killed), aborted: false, timeoutMs: spec.timeoutMs, stdout: { text: String(error.stdout ?? ''), truncated: false }, stderr: { text: String(error.stderr ?? error.message ?? ''), truncated: false } };
        }
      };
      if (legacyResultShape) return run();       // 异形实现：execute 直接给结果
      return { status: 'running', exitCode: null, signal: null, result: run };
    },
  };
  return {
    tools,
    calls,
    ctx: {
      effect(fn) { return fn(); },
      get(key) { return key === 'shell' ? shell : undefined; },
      tools: { register(def) { tools.push(def); return () => {}; } },
    },
  };
}

test('local-git：只注册 6 个本地工具，不含 push / 远端', () => {
  const { tools, ctx } = fakeCtx();
  apply(ctx);
  assert.equal(name, 'report-mode-local-git');
  assert.deepEqual(inject, ['tools']);
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    'git_branch', 'git_commit', 'git_diff', 'git_init', 'git_log', 'git_status',
  ]);
  for (const t of tools) {
    assert.equal(typeof t.description, 'string');
    assert.equal(typeof t.execute, 'function');
  }
  assert.ok(!tools.some((t) => /push|remote|fetch|pull/i.test(t.name)), '不应注册远端 git 工具');
});

test('local-git：git_init 能在空工作区建仓，且重复调用幂等', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-report-git-'));
  try {
    const { tools, ctx } = fakeCtx();
    apply(ctx);
    const init = tools.find((t) => t.name === 'git_init');
    const exec = { agent: { session: { header: { cwd: dir } } } };

    const first = await init.execute({ workdir: dir }, exec);
    assert.equal(first.ok, true);
    assert.equal(first.initialized, true);
    assert.equal(first.branch, 'main');
    assert.ok(existsSync(join(dir, '.git')), '应创建 .git 目录');

    const second = await init.execute({ workdir: dir }, exec);
    assert.equal(second.ok, true);
    assert.equal(second.initialized, false);
    assert.equal(second.branch, 'main');

    const status = tools.find((t) => t.name === 'git_status');
    const state = await status.execute({ workdir: dir }, exec);
    assert.equal(state.ok, true);
    assert.equal(typeof state.state.branch, 'string');
    assert.equal(typeof state.state.upstream, 'string', 'upstream 必须是 string（宿主 outputSchema 校验）');

    const diff = tools.find((t) => t.name === 'git_diff');
    const invalid = await diff.execute({ workdir: dir, paths: ['../escape'] }, exec);
    assert.equal(invalid.ok, false);
    assert.equal(typeof invalid.exitCode, 'number', '失败结果必须满足 exitCode:number schema');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('local-git：无上游仓库 git_status 输出满足 schema（branch/upstream 均为字符串）', async () => {
  // 2026-11-24 报表模式实测：本地仓没有远端时 parsePorcelainStatus 返回上游 null，
  // 宿主按 outputSchema 校验后把整次 git_status 判为
  // `tool "git_status" returned invalid output: "value.state.upstream" must be a string`。
  const dir = mkdtempSync(join(tmpdir(), 'dsh-report-git-upstream-'));
  try {
    const { tools, ctx } = fakeShellCtx();
    apply(ctx);
    const exec2 = { agent: { session: { header: { cwd: dir } } } };
    const init = tools.find((t) => t.name === 'git_init');
    const first = await init.execute({ workdir: dir, branch: 'main' }, exec2);
    assert.equal(first.ok, true, JSON.stringify(first));

    const status = tools.find((t) => t.name === 'git_status');
    const state = await status.execute({ workdir: dir }, exec2);
    assert.equal(state.ok, true, JSON.stringify(state));
    assert.equal(typeof state.state.branch, 'string', 'branch 必须是 string');
    assert.equal(typeof state.state.upstream, 'string', 'upstream 必须是 string');
    assert.equal(state.state.upstream, '', '无上游时归一为空串');

    // 同类回归：空 diff 的 --stat 曾返回 {files:null,insertions:null,deletions:null}，
    // 宿主按 outputSchema 校验会报 "must be a number"，整次 git_diff 失败。
    const diff = tools.find((t) => t.name === 'git_diff');
    const emptyStat = await diff.execute({ workdir: dir, stat: true }, exec2);
    assert.equal(emptyStat.ok, true, JSON.stringify(emptyStat));
    for (const key of ['files', 'insertions', 'deletions']) {
      assert.equal(typeof emptyStat.stat[key], 'number', `${key} 必须是 number`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('local-git：向宿主 shell 传入会话 sandboxPolicy（否则部署只读兜底会拒绝建 .git）', async () => {
  // 2026-11-24 某会话/v1 复盘：DSH SandboxBashExecutor.resolve() 是
  // `request.sandboxPolicy ?? 部署默认策略`；local-git 不传会话策略时 git 在部署默认
  // （常见 read-only）沙箱里跑 → 读命令正常、创建 .git 被拒 Permission denied。
  const dir = mkdtempSync(join(tmpdir(), 'dsh-report-git-policy-'));
  try {
    const { tools, calls, ctx } = fakeShellCtx();
    const session = { header: { cwd: dir } };
    const policy = { mode: 'danger-full-access', root: dir };
    const baseGet = ctx.get.bind(ctx);
    ctx.get = (key) => {
      if (key === 'sandboxPolicy') return { resolve(arg) { assert.equal(arg?.session, session); return policy; } };
      if (key === 'agents') return { currentInitiator() { return { session }; } };
      return baseGet(key);
    };
    apply(ctx);
    const init = tools.find((x) => x.name === 'git_init');
    const first = await init.execute({ workdir: dir, branch: 'main' }, { agent: { session } });
    assert.equal(first.ok, true, JSON.stringify(first));
    const resolved = calls.filter((c) => c.kind === 'resolve').map((c) => c.request);
    assert.ok(resolved.length > 0);
    assert.ok(resolved.every((r) => r.sandboxPolicy === policy), JSON.stringify(resolved.map((r) => r.sandboxPolicy)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('local-git：走宿主 shell 服务主路径（resolve → execute → result）能建仓并提交', async () => {
  // 2026-11-23 生产事故回归：此前主路径调用 shell.run()（宿主没有该方法），
  // 报表模式里 git_status/git_init 全报 "shell.run is not a function"；
  // 旧测试只桩了「无 shell」兜底，所以门禁一直绿。本用例锁定真实契约。
  const dir = mkdtempSync(join(tmpdir(), 'dsh-report-git-shell-'));
  try {
    const { tools, calls, ctx } = fakeShellCtx();
    apply(ctx);
    const exec2 = { agent: { session: { header: { cwd: dir } } } };

    const init = tools.find((t) => t.name === 'git_init');
    const first = await init.execute({ workdir: dir, branch: 'main' }, exec2);
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(first.initialized, true);
    assert.ok(existsSync(join(dir, '.git')), '应通过 shell 服务建仓');

    // 契约证据：先 resolve 再 execute，且永远不出现 run
    const kinds = calls.map((c) => c.kind);
    assert.deepEqual(kinds.slice(0, 2), ['resolve', 'execute']);
    assert.ok(!kinds.includes('run'), '不得再调用 shell.run');

    // 真实提交文件，再核对 status/log。刻意带中文与空格：命令串要经 PowerShell 引号，
    // 这是 shellQuote 的真实风险点（2026-11-23 一并回归）。
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(dir, 'IT数据部需求清单.cpt'), 'placeholder', 'utf8');
    writeFileSync(join(dir, '填报 可复制粘贴 V8.js'), 'console.log(1)', 'utf8');
    const commit = tools.find((t) => t.name === 'git_commit');
    const committed = await commit.execute({ workdir: dir, message: 'test: 首次提交', paths: ['.'] }, exec2);
    assert.equal(committed.ok, true, JSON.stringify(committed));

    const status = tools.find((t) => t.name === 'git_status');
    const state = await status.execute({ workdir: dir }, exec2);
    assert.equal(state.ok, true, JSON.stringify(state));
    assert.equal(state.state.branch, 'main');
    assert.equal(typeof state.state.upstream, 'string', '本地仓无上游时 upstream 仍须是 string');
    assert.deepEqual(state.state.staged, [], '提交后不应有暂存改动');
    assert.deepEqual(state.state.unstaged, [], '提交后不应有未暂存改动');
    assert.deepEqual(state.state.untracked, [], '提交后不应有未跟踪文件');

    const log = tools.find((t) => t.name === 'git_log');
    const history = await log.execute({ workdir: dir, count: 5 }, exec2);
    assert.equal(history.ok, true);
    assert.match(JSON.stringify(history.commits), /test: 首次提交/);

    // 2026-11-23 真实场景发现：`%(HEAD)%(refname:short)` 输出无分隔空格，
    // 旧解析器 slice(2) 会把 main 读成 ain。
    const branches = tools.find((t) => t.name === 'git_branch');
    const listed = await branches.execute({ workdir: dir }, exec2);
    assert.equal(listed.ok, true, JSON.stringify(listed));
    assert.equal(listed.branches.length, 1);
    assert.equal(listed.branches[0].name, 'main', '分支名不得被截断');
    assert.equal(listed.branches[0].current, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('local-git：execute 直接返回结果的异形实现同样可用（形状容错）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-report-git-legacy-'));
  try {
    const { tools, ctx } = fakeShellCtx({ legacyResultShape: true });
    apply(ctx);
    const exec2 = { agent: { session: { header: { cwd: dir } } } };
    const status = tools.find((t) => t.name === 'git_status');
    const result = await status.execute({ workdir: dir }, exec2);
    // 非仓库：应结构化失败而不是抛异常
    assert.equal(result.ok, false);
    assert.equal(typeof result.exitCode, 'number');
    assert.ok(typeof result.message === 'string' && result.message.length > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('local-git-publish：仅允许推送到项目文件夹内本地仓库，网络/越界目标被拒', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-report-git-publish-'));
  try {
    const { tools, calls, ctx } = fakeShellCtx();
    apply(ctx);
    publishRow.apply(ctx);
    const exec2 = { agent: { session: { header: { cwd: dir } } } };
    const baseGet = ctx.get.bind(ctx);
    ctx.get = (key) => key === 'sandboxPolicy'
      ? { resolve() { return { mode: 'danger-full-access', root: dir }; } }
      : key === 'agents'
        ? { currentInitiator() { return exec2.agent; } }
        : baseGet(key);

    const init = tools.find((t) => t.name === 'git_init');
    const first = await init.execute({ workdir: dir, branch: 'main' }, exec2);
    assert.equal(first.ok, true, JSON.stringify(first));
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(dir, 'report.cpt'), 'placeholder', 'utf8');
    const commit = tools.find((t) => t.name === 'git_commit');
    const committed = await commit.execute({ workdir: dir, message: 'test: 本地推送基线', paths: ['.'] }, exec2);
    assert.equal(committed.ok, true, JSON.stringify(committed));

    const push = tools.find((t) => t.name === 'git_local_push');
    assert.ok(push, '应注册 git_local_push');
    const pushed = await push.execute({ workdir: dir, target: '.git-archive/report.git' }, exec2);
    assert.equal(pushed.ok, true, JSON.stringify(pushed));
    assert.equal(typeof pushed.target, 'string');
    assert.equal(typeof pushed.branch, 'string');
    assert.equal(typeof pushed.commit, 'string');
    assert.match(pushed.target, /git-archive/);
    assert.ok(calls.some((c) => c.kind === 'resolve' && c.request.sandboxPolicy?.mode === 'danger-full-access'),
      'push 的 shell.resolve 必须携带会话 sandboxPolicy');

    // bare 仓库确实收到提交
    const { stdout: bareLog } = await execAsync(
      `git --git-dir "${join(dir, '.git-archive', 'report.git')}" rev-parse refs/heads/main`,
      { cwd: dir, windowsHide: true },
    );
    assert.equal(bareLog.trim().length, 40, 'bare 仓库应有提交');

    // 网络目标拒绝
    const net = await push.execute({ workdir: dir, target: 'https://github.com/x/y.git' }, exec2);
    assert.equal(net.ok, false);
    assert.match(net.message, /本地路径|网络/);
    // 越界目标拒绝
    const escape = await push.execute({ workdir: dir, target: '../escape.git' }, exec2);
    assert.equal(escape.ok, false);
    // create:false 且目标不存在时拒绝
    const missing = await push.execute({ workdir: dir, target: '.git-archive/none.git', create: false }, exec2);
    assert.equal(missing.ok, false);
    // workdir 越出项目文件夹（会话工作区）拒绝
    const outsideDir = mkdtempSync(join(tmpdir(), 'dsh-report-git-outside-'));
    try {
      const escaped = await push.execute({ workdir: outsideDir, target: 'archive.git' }, exec2);
      assert.equal(escaped.ok, false);
      assert.match(escaped.message, /项目文件夹|越界/);
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('local-git-publish：行模块自包含（不跨模块引用新导出）且注册失败不拖垮预设', async () => {
  // 2026-11-18/24 事故回归：运行宿主会缓存旧模块实例；预设行 import 某模块当天新增的导出
  // → 链接失败 → agent-preset/invalid: <row> (…): never started → 整个报表模式起不来。
  // 本行必须完全自包含，且 apply 内的失败不得向外抛。
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../lib/local-git-publish/index.mjs', import.meta.url), 'utf8');
  assert.ok(!/from\s+['"]\.\.\/local-git\//.test(src), '不得 import lib/local-git（旧实例可能缺新导出）');
  assert.ok(!/from\s+['"]dsh-report-mode\//.test(src), '不得用包名子路径 import 自身');
  const ctx = {
    effect: (fn) => fn(),
    get: () => undefined,
    tools: { register() { throw new Error('boom'); } },
    logger: { warn() {} },
  };
  assert.doesNotThrow(() => publishRow.apply(ctx), '注册失败只告警，不能抛出导致预设 Invalid');
});
