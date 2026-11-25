// test/local-tools.test.mjs —— 预设内文件工具（copy_file / delete_file）护栏与二进制安全（2026-11-23）
//
// 2026-11-23 会话实录（某会话）：模型要给 .cpt 做「改前备份」时，发现报表模式只有
// read/write/edit 三个**文本**文件工具（.cpt 是二进制），且无 shell，只能回「无法自行备份，
// 建议你手工复制一份」。于是新增预设内 scoped 行 copy_file（lib/copy-file.mjs）。
//
// 本测试不启动宿主、不依赖 @deepseek-ai/dsh-tools：
//   · copy-file-core / fs-guards 是纯 Node 逻辑，可直接跑；
//   · 覆盖默认时间戳备份名、工作区与保护段护栏、覆盖策略、二进制安全（含非 UTF-8 字节）、
//     以及与 delete_file 共用同一套判定。
// 另含两条静态契约：新增行的 package.json exports 登记（11-21 never-started 事故）、
// lib 下每个 defineTool 都显式给 parameters（11-23 never-started 事故泛化）。
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { backupNameFor, CopyFileError, copyFileSafely, planCopy } from '../lib/copy-file-core.mjs'
import { PROTECTED_SEGMENTS, protectedSegmentOf, withinWorkspace } from '../lib/fs-guards.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
/** 固定时间戳：2026-11-23 16:35:01（本地时间）。 */
const FIXED = new Date(2026, 10, 23, 16, 35, 1)
/** 只在内存里用的假工作区（planCopy 不碰文件系统）。 */
const FAKE_WS = join(tmpdir(), 'report-mode-test-ws')
/** 工作区外的绝对路径（用同一父目录构造，跨盘符时也不会误判）。 */
const OUTSIDE = join(tmpdir(), 'report-mode-outside.cpt')

/**
 * 断言某次同步调用抛出指定错误码的 CopyFileError。
 * @param {() => unknown} fn - 触发调用的函数。
 * @param {string} code - 期望的 CopyFileError.code。
 */
function assertCopyError(fn, code) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof CopyFileError, `应抛 CopyFileError，实际：${error}`)
    assert.equal(error.code, code, `错误码应为 ${code}，实际：${error.code}（${error.message}）`)
    return true
  })
}

/**
 * 断言某个异步调用以指定错误码的 CopyFileError 拒绝（copyFileSafely 是 async）。
 * @param {() => Promise<unknown>} fn - 触发调用的函数。
 * @param {string} code - 期望的 CopyFileError.code。
 */
async function assertCopyErrorAsync(fn, code) {
  await assert.rejects(fn, (error) => {
    assert.ok(error instanceof CopyFileError, `应抛 CopyFileError，实际：${error}`)
    assert.equal(error.code, code, `错误码应为 ${code}，实际：${error.code}（${error.message}）`)
    return true
  })
}

test('copy_file：默认备份名 = <原名>.bak-YYYYMMDD-HHmmss.<扩展名>，落在源同目录', () => {
  assert.equal(backupNameFor(join('ws', 'a.cpt'), FIXED), 'a.bak-20261123-163501.cpt')
  assert.equal(backupNameFor(join('ws', 'noext'), FIXED), 'noext.bak-20261123-163501')
  // 尖括号/多扩展名：只按最后一个扩展名处理，其余保留在原名里。
  assert.equal(backupNameFor(join('ws', 'a.b.cpt'), FIXED), 'a.b.bak-20261123-163501.cpt')
  const plan = planCopy({ ws: FAKE_WS, source_path: 'a.cpt', now: FIXED })
  assert.equal(plan.mode, 'backup', '缺省 target_path 时 mode 应为 backup')
  assert.equal(plan.target, join(resolve(FAKE_WS), 'a.bak-20261123-163501.cpt'))
  assert.equal(plan.overwrite, false, '默认不得覆盖目标')
})

test('copy_file：显式目标按工作区解析，mode=copy', () => {
  const plan = planCopy({ ws: FAKE_WS, source_path: join('sub', 'a.cpt'), target_path: join('backup', 'a.cpt'), now: FIXED })
  assert.equal(plan.mode, 'copy')
  assert.equal(plan.target, resolve(FAKE_WS, 'backup', 'a.cpt'))
  assert.equal(plan.source, resolve(FAKE_WS, 'sub', 'a.cpt'))
})

test('copy_file：工作区外、受保护路径段、同路径、工作区根一律拒绝（不碰文件系统）', () => {
  // 源在工作区外（相对路径上跳 / 绝对路径）
  assertCopyError(() => planCopy({ ws: FAKE_WS, source_path: join('..', 'outside.cpt') }), 'outside-workspace')
  assertCopyError(() => planCopy({ ws: FAKE_WS, source_path: OUTSIDE }), 'outside-workspace')
  // 目标在工作区外
  assertCopyError(() => planCopy({ ws: FAKE_WS, source_path: 'a.cpt', target_path: OUTSIDE }), 'outside-workspace')
  // 受保护路径段：源与目标都拦
  assertCopyError(() => planCopy({ ws: FAKE_WS, source_path: join('reports', '.git', 'config') }), 'protected-path')
  assertCopyError(
    () => planCopy({ ws: FAKE_WS, source_path: 'a.cpt', target_path: join('node_modules', 'a.cpt') }),
    'protected-path',
  )
  // 同路径 / 目标为工作区根 / 源为空
  assertCopyError(() => planCopy({ ws: FAKE_WS, source_path: 'a.cpt', target_path: 'a.cpt' }), 'same-path')
  assertCopyError(() => planCopy({ ws: FAKE_WS, source_path: 'a.cpt', target_path: '.' }), 'invalid-target')
  assertCopyError(() => planCopy({ ws: FAKE_WS, source_path: '   ' }), 'invalid-source')
})

test('copy_file：二进制安全——含非 UTF-8 字节的文件逐字节一致', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'copy-file-test-'))
  try {
    // .cpt 是二进制：NUL、0xFF、0xFE、0x80 以及 CRLF 都不能被文本编解码改写。
    const bytes = Buffer.from([0x00, 0xff, 0xfe, 0x80, 0x41, 0x0d, 0x0a, 0x25, 0x50, 0x44, 0x46])
    await writeFile(join(dir, 't.cpt'), bytes)
    const result = await copyFileSafely(planCopy({ ws: dir, source_path: 't.cpt', target_path: join('copy', 't.cpt') }))
    assert.equal(result.mode, 'copy')
    assert.equal(result.bytes, bytes.length, 'bytes 应为实际写入字节数')
    assert.deepEqual(await readFile(result.target), bytes, '目标字节必须与源逐字节一致')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('copy_file：缺省目标生成同目录时间戳备份，且不覆盖既有备份', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'copy-file-backup-'))
  try {
    const bytes = Buffer.from([0x00, 0xde, 0xad, 0xbe, 0xef])
    await writeFile(join(dir, 'report.cpt'), bytes)
    const result = await copyFileSafely(planCopy({ ws: dir, source_path: 'report.cpt', now: FIXED }))
    assert.equal(result.mode, 'backup')
    assert.equal(result.target, join(dir, 'report.bak-20261123-163501.cpt'))
    assert.deepEqual(await readFile(result.target), bytes)
    // 同一秒再备份一次：目标已存在 → 默认拒绝覆盖（保护既有备份）。
    await assertCopyErrorAsync(
      () => copyFileSafely(planCopy({ ws: dir, source_path: 'report.cpt', now: FIXED })),
      'target-exists',
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('copy_file：目标已存在默认拒绝且不改动原文件，overwrite=true 才替换', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'copy-file-overwrite-'))
  try {
    await writeFile(join(dir, 'src.cpt'), Buffer.from('v2-bytes'))
    await writeFile(join(dir, 'dst.cpt'), Buffer.from('v1-bytes'))
    await assertCopyErrorAsync(
      () => copyFileSafely(planCopy({ ws: dir, source_path: 'src.cpt', target_path: 'dst.cpt' })),
      'target-exists',
    )
    assert.equal((await readFile(join(dir, 'dst.cpt'))).toString('utf8'), 'v1-bytes', '拒绝后目标内容不得变化')
    const result = await copyFileSafely(
      planCopy({ ws: dir, source_path: 'src.cpt', target_path: 'dst.cpt', overwrite: true }),
    )
    assert.equal(result.bytes, Buffer.byteLength('v2-bytes'))
    assert.equal((await readFile(join(dir, 'dst.cpt'))).toString('utf8'), 'v2-bytes')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('copy_file：源不存在 / 源是目录 / 目标是目录都给出明确错误码', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'copy-file-errors-'))
  try {
    await assertCopyErrorAsync(() => copyFileSafely(planCopy({ ws: dir, source_path: 'missing.cpt' })), 'source-not-found')
    await mkdir(join(dir, 'folder'))
    await assertCopyErrorAsync(() => copyFileSafely(planCopy({ ws: dir, source_path: 'folder' })), 'source-not-file')
    await writeFile(join(dir, 'ok.cpt'), 'x')
    await mkdir(join(dir, 'dst-dir'))
    await assertCopyErrorAsync(
      () => copyFileSafely(planCopy({ ws: dir, source_path: 'ok.cpt', target_path: 'dst-dir' })),
      'target-is-directory',
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('护栏与 delete_file 共用同一套判定（fs-guards 单源）', () => {
  for (const segment of ['.git', 'node_modules', '.trash', '.dsh', '.bak']) {
    assert.ok(PROTECTED_SEGMENTS.has(segment), `受保护路径段应包含 ${segment}`)
  }
  assert.equal(withinWorkspace(resolve(FAKE_WS), FAKE_WS), true, '工作区根自身算工作区内')
  assert.equal(withinWorkspace(resolve(FAKE_WS, '..', 'out'), FAKE_WS), false)
  assert.equal(protectedSegmentOf(join(FAKE_WS, '.git', 'config')), '.git')
  assert.equal(protectedSegmentOf(join(FAKE_WS, 'reports', 'a.cpt')), undefined)

  const deleteSrc = readFileSync(join(ROOT, 'lib', 'delete-file.mjs'), 'utf8')
  assert.match(deleteSrc, /from '\.\/fs-guards\.mjs'/, 'delete_file 必须复用 fs-guards（否则两份保护段会漂移）')
  assert.doesNotMatch(deleteSrc, /const PROTECTED_SEGMENTS = new Set\(/, 'delete_file 不得再维护第二份保护段清单')
})

test('行契约：lib 下每个 defineTool 都显式给 parameters（11-23 never-started 事故泛化）', () => {
  // 2026-11-23 实录：code-access 的 release_code_access 漏写 parameters，宿主抛
  // "unsupported JSON schema: parameters must be an object of value schemas"，
  // 整行 never started，报表模式起不来。此前测试只锁定 code-access 一个文件，此处扫描全部行模块。
  const dirs = [join(ROOT, 'lib'), join(ROOT, 'lib', 'local-git')]
  let toolCount = 0
  let rowFiles = 0
  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    for (const file of readdirSync(dir)) {
      if (!/\.(mjs|js)$/.test(file)) continue
      const src = readFileSync(join(dir, file), 'utf8')
      const tools = (src.match(/defineTool\(\{/g) || []).length
      if (tools === 0) continue
      rowFiles += 1
      const params = (src.match(/^\s+parameters:/gm) || []).length
      assert.equal(params, tools, `${file}：每个 defineTool 都必须有 parameters（${params}/${tools}）；空参数工具写 parameters: {}`)
      toolCount += tools
    }
  }
  assert.ok(rowFiles >= 3, `应至少扫描到 3 个含 defineTool 的行模块，实际 ${rowFiles}`)
  assert.ok(toolCount >= 5, `应覆盖 code-access(3) + delete_file + copy_file 共 ≥5 个工具，实际 ${toolCount}`)
})

test('copy_file 行：exports 已登记、两个预设都挂载（11-21 never-started 事故回归）', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  assert.equal(pkg.exports['./copy-file'], './lib/copy-file.mjs', '漏登记 exports 会让整行 never started')
  assert.ok(existsSync(join(ROOT, 'lib', 'copy-file.mjs')))
  const rowPattern = /- id: copy-file\n\s+name: dsh-report-mode\/copy-file/
  for (const preset of ['report-mode', 'report-ptc']) {
    const text = readFileSync(join(ROOT, 'presets', preset, 'agent.cordis.yml'), 'utf8')
    assert.match(text, rowPattern, `${preset} 应挂载 copy-file 行（两个预设同源派生）`)
  }
})
