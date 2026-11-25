/**
 * `copy_file` 的纯逻辑（可单测）：路径规划、默认备份名、二进制安全复制（2026-11-23）。
 *
 * 为什么需要这个工具（会话实录，2026-11-23 某会话）：
 *   报表模式只有 read/write/edit 三个**文本**文件工具，`.cpt` 是二进制；模型想「改前
 *   备份」时既无 shell 也无文件复制能力，只能回「无法自行备份……建议你手工复制一份」，
 *   把本可自动完成的事推给用户。code-access 租约虽能跑脚本，但常态关闭、需用户同意，
 *   日常备份不该每次都申请代码执行。因此新增 scoped 行 `copy_file`：
 *   `fs.copyFile` 直接复制字节（不经过文本编解码），默认生成同目录时间戳备份名。
 *
 * 分层：本文件不 import `@deepseek-ai/dsh-tools`，测试可直接跑；
 * `lib/copy-file.mjs` 只做 defineTool 包装与工作区取用。
 * @module dsh-report-mode/copy-file-core
 */
import { copyFile, mkdir, stat } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { protectedSegmentOf, withinWorkspace } from './fs-guards.mjs'

/** 带机器可读 code 的复制错误；行模块原样抛给模型，便于按证据处置。 */
export class CopyFileError extends Error {
  /**
   * @param {string} code - 稳定错误码（outside-workspace / protected-path / ...）。
   * @param {string} message - 面向模型的说明。
   */
  constructor(code, message) {
    super(message)
    this.name = 'CopyFileError'
    this.code = code
  }
}

/** 两位补零。 */
function pad2(value) {
  return String(value).padStart(2, '0')
}

/** 本地时间戳 YYYYMMDD-HHmmss（备份名用；不做时区转换，用户看到的是本机时间）。 */
export function formatStamp(now = new Date()) {
  return `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`
    + `-${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`
}

/** 默认备份名：`<原名>.bak-YYYYMMDD-HHmmss.<扩展名>`（无扩展名时直接追加）。 */
export function backupNameFor(sourcePath, now = new Date()) {
  const base = basename(sourcePath)
  const ext = extname(base)
  const stem = ext ? base.slice(0, -ext.length) : base
  return `${stem}.bak-${formatStamp(now)}${ext}`
}

/**
 * 规划一次复制：解析源/目标为绝对路径并做完全部静态护栏校验（不碰文件系统）。
 * @param {object} input
 * @param {string} input.ws - 会话工作区根。
 * @param {string} input.source_path - 源文件路径（绝对或相对工作区）。
 * @param {string} [input.target_path] - 目标路径；缺省时自动生成同目录时间戳备份名。
 * @param {boolean} [input.overwrite] - 目标已存在时是否覆盖（默认 false）。
 * @param {Date} [input.now] - 时间戳来源（测试注入）。
 * @returns {{source: string, target: string, mode: 'backup'|'copy', overwrite: boolean}}
 */
export function planCopy({ ws, source_path, target_path, overwrite = false, now = new Date() }) {
  const root = resolve(ws)
  if (typeof source_path !== 'string' || source_path.trim() === '') {
    throw new CopyFileError('invalid-source', 'copy_file: source_path 必填（源文件路径）')
  }
  const source = resolve(root, source_path)
  if (!withinWorkspace(source, root)) {
    throw new CopyFileError('outside-workspace', `copy_file: 源路径在工作区外，拒绝复制: ${source}`)
  }
  const sourceHit = protectedSegmentOf(source)
  if (sourceHit !== undefined) {
    throw new CopyFileError('protected-path', `copy_file: 拒绝访问受保护路径段 "${sourceHit}": ${source}`)
  }

  const autoBackup = typeof target_path !== 'string' || target_path.trim() === ''
  const target = autoBackup ? join(dirname(source), backupNameFor(source, now)) : resolve(root, target_path)
  if (!withinWorkspace(target, root)) {
    throw new CopyFileError('outside-workspace', `copy_file: 目标路径在工作区外，拒绝复制: ${target}`)
  }
  const targetHit = protectedSegmentOf(target)
  if (targetHit !== undefined) {
    throw new CopyFileError('protected-path', `copy_file: 拒绝写入受保护路径段 "${targetHit}": ${target}`)
  }
  if (target === root) {
    throw new CopyFileError('invalid-target', 'copy_file: 目标不能是工作区根目录')
  }
  if (target === source) {
    throw new CopyFileError('same-path', 'copy_file: 源与目标是同一路径，拒绝自复制')
  }
  return { source, target, mode: autoBackup ? 'backup' : 'copy', overwrite: overwrite === true }
}

/**
 * 执行复制：源必须是普通文件；目标存在且未显式 overwrite 时拒绝；字节级复制。
 * @param {ReturnType<typeof planCopy>} plan - planCopy 的返回值。
 * @returns {Promise<{source: string, target: string, bytes: number, mode: string}>}
 */
export async function copyFileSafely(plan) {
  let sourceStat
  try {
    sourceStat = await stat(plan.source)
  } catch {
    throw new CopyFileError('source-not-found', `copy_file: 源文件不存在: ${plan.source}`)
  }
  if (!sourceStat.isFile()) {
    throw new CopyFileError('source-not-file', `copy_file: 源必须是文件（不支持目录）: ${plan.source}`)
  }

  try {
    const existing = await stat(plan.target)
    if (existing.isDirectory()) {
      throw new CopyFileError('target-is-directory', `copy_file: 目标已是目录，拒绝覆盖: ${plan.target}`)
    }
    if (!plan.overwrite) {
      throw new CopyFileError(
        'target-exists',
        `copy_file: 目标已存在，拒绝覆盖（需要覆盖请显式 overwrite=true）: ${plan.target}`,
      )
    }
  } catch (error) {
    if (error instanceof CopyFileError) throw error
    // ENOENT：目标不存在，继续复制。
  }

  await mkdir(dirname(plan.target), { recursive: true })
  // 二进制安全：fs.copyFile 原样复制字节，不经过任何文本编解码。
  await copyFile(plan.source, plan.target)
  return {
    source: plan.source,
    target: plan.target,
    bytes: (await stat(plan.target)).size,
    mode: plan.mode,
  }
}
