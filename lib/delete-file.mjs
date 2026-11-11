/**
 * 报表模式的文件删除工具（预设内 scoped 行）。
 *
 * 为什么内置在预设行里、而不是装一个 host 级插件：
 *   `delete_file` 只应在「报表模式」出现。host 级插件注册的工具对**所有**预设可见，
 *   而 `ctx.tools.register` 在预设内的 scoped context 调用时注册为 scoped 工具，
 *   只有该预设的 agent 能看到 —— 与 `restrict-host-git` / `report-git` 同一机制。
 *   因此本文件按 `<包名>/delete-file` 导出，由 `cordis.patch.yml` 的预设 plugins 列表
 *   以 `- id: delete-file / name: dsh-report-mode/delete-file` 一行挂载。
 *
 * 安全语义（与 persona「删除文件（delete_file，安全受控）」一节逐条一致）：
 *   · 只允许会话工作区内的路径；工作区外一律拒绝（绝对路径同样会被解析后判定）。
 *   · 受保护路径段（.git / node_modules / .reasonix / .agent-teams / .trash /
 *     .decompiled / .bak / .dsh）一律拒绝，避免误删仓库元数据与回收站自身。
 *   · 默认 `use_trash: true`：移动到目标同级的 `.trash/`（可恢复）；
 *     只有显式 `use_trash: false` 才做不可恢复的硬删。
 *   · 目标不存在时返回 `not_found`，不抛错（幂等，便于模型安全重试）。
 *
 * 工具返回值：`{ path, mode }`，mode ∈ { trashed, deleted, not_found }。
 * @module dsh-report-mode/delete-file
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve, sep } from 'node:path'

/** 本行在 Cordis 组合里的插件名。 */
export const name = 'dsh-report-mode-delete-file'

/** 依赖的工具注册表。 */
export const inject = ['tools']

/** 受保护的路径段：出现任意一段即拒绝删除（大小写不敏感）。 */
const PROTECTED_SEGMENTS = new Set([
  '.git', 'node_modules', '.reasonix', '.agent-teams', '.trash', '.decompiled',
  '.bak', '.dsh', 'artifacts',
])

/** 会话工作区：优先取 agent 会话 cwd，回退 process.cwd()（与 tool-fs 的 sessionCwd 同源）。 */
function workspaceOf(exec) {
  return exec?.agent?.session?.header?.cwd ?? process.cwd()
}

/** 目标是否落在会话工作区内（含工作区根自身）。 */
function withinWorkspace(abs, ws) {
  const root = resolve(ws)
  return abs === root || abs.startsWith(root + sep)
}

export function apply(ctx) {
  // 预设是 standing mount，register 的返回 disposer 与同仓 report-git / restrict-host-git
  // 的既有做法一致：交给 Cordis 的预设 fiber 生命周期处理即可。
  ctx.tools.register(defineTool({
    name: 'delete_file',
    description: 'Delete a file (or an empty directory) inside the session workspace. Safety guards: refuses paths outside the workspace and any path containing a protected segment (.git, node_modules, .reasonix, .agent-teams, .trash, .decompiled, .bak, .dsh). By default moves the target to a `.trash` sibling instead of permanent deletion; pass use_trash=false only for a hard delete.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'Absolute or workspace-relative path of the file/directory to delete.' },
      use_trash: { type: 'boolean', description: 'true = move to <parent>/.trash (default, recoverable); false = permanent delete.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          mode: { type: 'string', required: true, description: 'trashed | deleted | not_found' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `${value.mode}: ${value.path}` }],
    },
    async execute(args, exec) {
      const ws = workspaceOf(exec)
      const abs = resolve(ws, args.file_path)
      if (!withinWorkspace(abs, ws)) {
        throw new Error(`delete_file: 路径在工作区外，拒绝删除: ${abs}`)
      }
      const parts = abs.split(/[\\/]/).map((s) => s.toLowerCase())
      const hit = parts.find((p) => PROTECTED_SEGMENTS.has(p))
      if (hit !== undefined) {
        throw new Error(`delete_file: 拒绝删除受保护路径段 "${hit}": ${abs}`)
      }
      let isDir = false
      try {
        const st = await stat(abs)
        isDir = st.isDirectory()
      } catch {
        return { path: abs, mode: 'not_found' }
      }
      const trash = args.use_trash !== false
      if (trash) {
        const trashDir = join(dirname(abs), '.trash')
        await mkdir(trashDir, { recursive: true })
        await rename(abs, join(trashDir, basename(abs)))
        return { path: abs, mode: 'trashed' }
      }
      await rm(abs, { recursive: isDir, force: true })
      return { path: abs, mode: 'deleted' }
    },
  }), 'dsh-report-mode: delete_file')
}
