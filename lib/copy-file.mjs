/**
 * 报表模式的「工作区文件复制/备份」工具（预设内 scoped 行，2026-11-23）。
 *
 * 动机（会话实录）：报表模式只有 read/write/edit 三个文本文件工具，`.cpt` 是二进制，
 * 模型无法用文件工具安全复制；改前备份只能让用户手工复制，或退化去申请代码执行租约。
 * 本行提供 `copy_file`：工作区内二进制安全复制，默认生成时间戳备份名。
 *
 * 挂载方式与 `delete-file` 一致：按 `<包名>/copy-file` 导出，由 `cordis.patch.yml`
 * 的预设 plugins 列表以 `- id: copy-file / name: dsh-report-mode/copy-file` 挂载；
 * `ctx.tools.register` 在预设 scoped context 注册，只有报表模式的 agent 能看到。
 *
 * 安全语义（与 `delete_file` 共用 `lib/fs-guards.mjs` 的判定）：
 *   · 源与目标都必须在会话工作区内（绝对路径同样解析后判定）；
 *   · 源与目标都拒绝受保护路径段（.git / node_modules / .reasonix / .agent-teams /
 *     .trash / .decompiled / .bak / .dsh / artifacts）；
 *   · 源必须是普通文件（不支持目录）；目标已存在且未显式 `overwrite=true` 时拒绝；
 *   · 默认目标为源同目录的 `<原名>.bak-YYYYMMDD-HHmmss.<扩展名>`。
 * 返回 `{ source, target, bytes, mode }`，mode ∈ {backup, copy}。
 * @module dsh-report-mode/copy-file
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { copyFileSafely, planCopy } from './copy-file-core.mjs'
import { workspaceOf } from './fs-guards.mjs'

/** 本行在 Cordis 组合里的插件名。 */
export const name = 'dsh-report-mode-copy-file'

/** 依赖的工具注册表。 */
export const inject = ['tools']

export function apply(ctx) {
  // 预设是 standing mount，register 的返回 disposer 交给 Cordis 预设 fiber 生命周期
  // （与 delete-file / report-local-git 的既有做法一致）。
  ctx.tools.register(defineTool({
    name: 'copy_file',
    description: 'Copy a file inside the session workspace with binary-safe bytes (no text re-encoding). Use it to back up report artifacts before editing (e.g. a .cpt). Omit target_path to copy to a timestamped sibling named `<name>.bak-YYYYMMDD-HHmmss<ext>`; pass target_path for an explicit destination, and overwrite=true to replace an existing file. Safety guards: source and target must stay inside the workspace and must not contain a protected path segment (.git, node_modules, .reasonix, .agent-teams, .trash, .decompiled, .bak, .dsh, artifacts); the source must be a regular file; an existing target is refused unless overwrite=true.',
    parameters: {
      source_path: { type: 'string', required: true, description: 'Absolute or workspace-relative path of the source file.' },
      target_path: { type: 'string', description: 'Optional absolute or workspace-relative destination. Defaults to a timestamped backup name next to the source.' },
      overwrite: { type: 'boolean', description: 'true = replace an existing target file; default false refuses to overwrite.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          source: { type: 'string', required: true, description: 'Absolute source path that was copied.' },
          target: { type: 'string', required: true, description: 'Absolute destination path written.' },
          bytes: { type: 'number', required: true, description: 'Bytes written to the target file.' },
          mode: { type: 'string', required: true, description: 'backup (auto timestamped name) | copy (explicit target).' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `${value.mode}: ${value.source} -> ${value.target} (${value.bytes} bytes)` }],
    },
    async execute(args, exec) {
      const ws = workspaceOf(exec)
      const plan = planCopy({
        ws,
        source_path: args.source_path,
        target_path: args.target_path,
        overwrite: args.overwrite,
      })
      return await copyFileSafely(plan)
    },
  }), 'dsh-report-mode: copy_file')
}
