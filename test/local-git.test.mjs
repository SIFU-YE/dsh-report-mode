// test/local-git.test.mjs —— 报表模式内置本地 git 工具（vendored 自 dsh-plugin-git-workflow）
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { apply, inject, name } from '../lib/local-git/index.mjs';

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

    const diff = tools.find((t) => t.name === 'git_diff');
    const invalid = await diff.execute({ workdir: dir, paths: ['../escape'] }, exec);
    assert.equal(invalid.ok, false);
    assert.equal(typeof invalid.exitCode, 'number', '失败结果必须满足 exitCode:number schema');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

