/**
 * dsh-report-mode/local-git-publish — 报表模式的「仅本地仓库推送」能力。
 *
 * 与 lib/local-git 解耦：local-git 只负责本地提交（无 push / 无远端）；
 * 本模块单独提供 `git_local_push`，目标**必须**是项目文件夹内的本地仓库路径
 * （如 `.git-archive/report.git`），用于给报表产物做本地版本归档。
 *
 * 安全边界（与 persona 第 9 条一致，硬性拒绝）：
 *  - 拒绝任何网络协议：http(s)://、ssh://、git://、file://；
 *  - 拒绝 scp 形态（git@host:path）与 UNC（\\server\share）；
 *  - 目标解析（含符号链接）后必须仍位于项目文件夹内，且不能是项目文件夹本身
 *    或其中的 `.git` 目录；
 *  - workdir 必须在会话工作区（项目文件夹）内；
 *  - 只做普通 push（不带 --force、不配置 remote、不读任何凭据），推送后校验目标分支。
 *
 * 【为什么这里重复实现 git runner，而不是 import lib/local-git】
 * 2026-11-18/24 两次事故：运行中的宿主会缓存已加载模块的旧实例；预设行若
 * import 某模块**当天新增的导出**，链接会失败，loader 直接报
 * `agent-preset/invalid: <row> (…): never started`，整个报表模式都起不来。
 * 本行必须能独立加载，故自带最小 runner（shell 契约 resolve→execute→result，
 * 无 shell 时 execFile 兜底），不共享可变的跨模块导出。
 *
 * @module dsh-report-mode/local-git-publish
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";

/** Stable Cordis plugin name. */
export const name = "report-mode-local-git-publish";
/** Hard dependency: the tool registry. */
export const inject = ["tools"];

const MAX_BUFFER = 8 * 1024 * 1024;

/** Resolve the workdir: explicit arg (relative to session cwd) or the session cwd. */
function resolveWorkdir(workdir, exec) {
	const headerCwd = exec?.agent?.session?.header?.cwd;
	const fallback = headerCwd ?? process.cwd();
	if (workdir === undefined) return fallback;
	return isAbsolute(workdir) ? workdir : resolve(fallback, workdir);
}

/** Shell-quote one argument (the host shell runs PowerShell on Windows, bash elsewhere). */
function shellQuote(arg) {
	const s = String(arg);
	if (s === "") return '""';
	if (process.platform === "win32") {
		let out = "";
		for (const ch of s) {
			if (ch === '"' || ch === "$" || ch === "\x60") out += "\x60";
			out += ch;
		}
		return '"' + out + '"';
	}
	return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Run `git` through the host shell service when available (sandbox/approval apply). */
/**
 * 解析当前会话的沙箱策略。
 *
 * DSH 的 SandboxBashExecutor.resolve() 是 `request.sandboxPolicy ?? 部署默认策略`。
 * 若调用方不传，git 会在"部署默认（常见为 read-only）"沙箱里执行：read 类命令正常，
 * 但 `git init` / `git commit` 写 `.git` 会被拒（Permission denied）。
 * 报表模式会话自身是 danger-full-access 时，必须把会话策略传给 shell。
 */
function resolveSessionSandboxPolicy(ctx, session) {
  const sandbox = ctx.get("sandboxPolicy");
  if (sandbox === undefined) return undefined;
  try {
    const s = session ?? ctx.get("agents")?.currentInitiator?.()?.session;
    return sandbox.resolve(s ? { session: s } : undefined);
  } catch {
    return undefined;
  }
}

async function runGit(ctx, args, workdir, options = {}) {
	const { timeoutMs = 30000 } = options;
	const shell = ctx.get("shell");
	if (shell === undefined) {
		try {
			const { stdout, stderr } = await promisify(execFile)("git", args, {
				cwd: workdir,
				timeout: timeoutMs,
				maxBuffer: MAX_BUFFER,
				windowsHide: true,
				encoding: "utf8",
			});
			return { ok: true, stdout, stderr };
		} catch (error) {
			const code = error?.code !== undefined ? error.code : error?.exitCode ?? -1;
			return { ok: false, exitCode: typeof code === "number" ? code : -1, message: String(error?.stderr || error?.message || "git failed").trim() };
		}
	}
	try {
		const sandboxPolicy = options.sandboxPolicy ?? resolveSessionSandboxPolicy(ctx, options.session);
		const spec = shell.resolve({
			command: `git ${args.map((a) => shellQuote(a)).join(" ")}`,
			workdir,
			timeoutMs,
			stdoutMaxBytes: MAX_BUFFER,
			...sandboxPolicy !== undefined ? { sandboxPolicy } : {}
		});
		const execution = await shell.execute(spec);
		const result = typeof execution?.result === "function" ? await execution.result() : execution;
		const stdout = result?.stdout?.text ?? "";
		const stderr = result?.stderr?.text ?? "";
		const ok = result?.exitCode === 0;
		const message = ok
			? undefined
			: (result?.timedOut
				? `git timed out after ${spec.timeoutMs}ms`
				: (stderr || stdout || `git exited with code ${result?.exitCode ?? -1}`)
			).trim().slice(0, 2000);
		return { ok, exitCode: typeof result?.exitCode === "number" ? result.exitCode : -1, stdout, stderr, message };
	} catch (error) {
		return { ok: false, exitCode: -1, message: String(error?.message || "git failed").trim() };
	}
}

/** Reject anything that names a network remote instead of a local filesystem path. */
function isNetworkTarget(target) {
	return (
		/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(target)
		|| /^[A-Za-z0-9._-]+@[^\\/]+:/.test(target)
		|| /^\\\\/.test(target)
		|| /^\/\//.test(target)
	);
}

/** Nearest existing ancestor of `path` (symlink-safe containment checks). */
function nearestExisting(path) {
	let current = path;
	for (;;) {
		if (existsSync(current)) return current;
		const parent = dirname(current);
		if (parent === current) return null;
		current = parent;
	}
}

/** Resolve and validate the push target (must stay inside the project folder). */
function resolveTarget(workdir, target) {
	if (typeof target !== "string" || target.trim() === "") {
		return { error: "target 必填：项目文件夹内的本地仓库路径，例如 '.git-archive/report.git'" };
	}
	const raw = target.trim();
	if (isNetworkTarget(raw)) {
		return { error: "只允许项目文件夹内的本地路径；禁止网络 URL / git@ / UNC 远端（报表模式不推送任何网络仓库）" };
	}
	const root = resolve(workdir);
	if (!existsSync(root)) return { error: `项目文件夹不存在：${root}` };
	const absolute = isAbsolute(raw) ? raw : resolve(root, raw);
	const rel = relative(root, absolute);
	if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
		return { error: "target 必须位于项目文件夹内，且不能是项目文件夹本身" };
	}
	if (rel.split(/[\\/]+/).includes(".git")) {
		return { error: "target 不能位于 .git 目录内" };
	}
	const existing = nearestExisting(absolute);
	if (existing === null) return { error: "target 的父目录不存在" };
	const realRoot = realpathSync.native(root);
	const realExisting = realpathSync.native(existing);
	const realAbsolute = join(realExisting, relative(existing, absolute));
	const contained = relative(realRoot, realAbsolute);
	if (contained === "" || contained.startsWith("..") || isAbsolute(contained)) {
		return { error: "target 解析后越出项目文件夹（符号链接），拒绝推送" };
	}
	return { path: absolute, display: rel };
}

/** The session workdir is the project folder; a push may not run outside it. */
function insideProjectFolder(workdir, exec) {
	const headerCwd = exec?.agent?.session?.header?.cwd;
	if (typeof headerCwd !== "string" || headerCwd === "") return "无法确定项目文件夹（会话工作区），拒绝推送";
	try {
		const rootReal = realpathSync.native(headerCwd);
		const workdirReal = realpathSync.native(workdir);
		const rel = relative(rootReal, workdirReal);
		if (rel !== "" && (rel.startsWith("..") || isAbsolute(rel))) {
			return "只允许在项目文件夹（会话工作区）内推送；workdir 越界即拒绝";
		}
		return "";
	} catch (error) {
		return `无法解析项目文件夹：${String(error?.message || error)}`;
	}
}

/** Validate a branch name before it reaches the git command line. */
function validateBranchName(branch) {
	if (typeof branch !== "string" || branch.length === 0 || branch.length > 200) {
		return "branch must be a non-empty string (max 200 characters)";
	}
	if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch)) {
		return "branch may only contain letters, digits, '.', '_', '/' and '-' (must start alphanumeric)";
	}
	return "";
}

/** Build a failure result that always satisfies the output schema. */
function failure(message, exitCode = -1) {
	return {
		ok: false,
		exitCode: typeof exitCode === "number" ? exitCode : -1,
		message: String(message ?? "git push failed").trim()
	};
}

/** Ensure `directory` is a bare repository; create it (and parents) when missing. */
async function ensureBareRepository(ctx, directory, session) {
	if (existsSync(directory)) {
		const probe = await runGit(ctx, ["rev-parse", "--is-bare-repository"], directory, { session });
		if (probe.ok && probe.stdout.trim() === "true") return "";
		return `target 已存在但不是 bare 仓库，拒绝覆盖：${directory}`;
	}
	mkdirSync(dirname(directory), { recursive: true });
	const created = await runGit(ctx, ["init", "--bare", directory], dirname(directory), { session });
	if (!created.ok) return `创建本地 bare 仓库失败：${created.message}`;
	return "";
}

/** Register the single local-only push tool. */
export function apply(ctx) {
	try {
		/** @type {any} */
		const definition = {
			name: "git_local_push",
			description: "Push the current branch to a local git repository inside the project folder (e.g. '.git-archive/report.git'). Local filesystem paths only: network URLs, git@ remotes, UNC paths and targets outside the project folder are refused. Never force-pushes and configures no remote.",
			parameters: {
				type: "object",
				properties: {
					workdir: { type: "string", description: "Project directory. Defaults to the session working directory; relative paths resolve against it." },
					target: { type: "string", description: "Path of the local repository inside the project folder (created as a bare repo when missing), e.g. '.git-archive/report.git'." },
					branch: { type: "string", description: "Branch to push. Defaults to the current branch." },
					create: { type: "boolean", description: "Create a bare repository at target when it does not exist. Default true." }
				},
				required: ["target"]
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						ok: { type: "boolean" },
						target: { type: "string" },
						branch: { type: "string" },
						commit: { type: "string" },
						summary: { type: "string" },
						exitCode: { type: "number" },
						message: { type: "string" }
					}
				},
				render: (_args, value) => [{
					type: "text",
					text: value.ok
						? `本地推送完成：${value.summary}`
						: `本地推送失败：${value.message}`
				}]
			},
			timeoutMs: 60000,
			async execute(args, exec) {
				const workdir = resolveWorkdir(args?.workdir, exec);
				const session = exec?.agent?.session;
				const outside = insideProjectFolder(workdir, exec);
				if (outside) return failure(outside);
				const target = resolveTarget(workdir, args?.target);
				if (target.error) return failure(target.error);

				const head = await runGit(ctx, ["rev-parse", "--abbrev-ref", "HEAD"], workdir, { session });
				if (!head.ok) return failure(`当前目录不是可推送的 git 仓库：${head.message}`);
				const current = head.stdout.trim();
				if (current === "HEAD") return failure("当前处于 detached HEAD：请先切换到分支再推送");
				const branch = typeof args?.branch === "string" && args.branch.trim() !== "" ? args.branch.trim() : current;
				const branchError = validateBranchName(branch);
				if (branchError) return failure(branchError);

				const commit = await runGit(ctx, ["rev-parse", "--short", "HEAD"], workdir, { session });
				if (!commit.ok) return failure(`读取当前提交失败：${commit.message}`);
				const headFull = await runGit(ctx, ["rev-parse", "HEAD"], workdir, { session });
				if (!headFull.ok) return failure(`读取当前提交哈希失败：${headFull.message}`);

				if (args?.create === false && !existsSync(target.path)) {
					return failure(`target 不存在：${target.display}（先建 bare 仓库，或允许 create）`);
				}
				const ensureError = await ensureBareRepository(ctx, target.path, session);
				if (ensureError) return failure(ensureError);

				const pushed = await runGit(
					ctx,
					["push", "--porcelain", target.path, `${branch}:refs/heads/${branch}`],
					workdir,
					{ session },
				);
				if (!pushed.ok) return failure(`本地推送失败：${pushed.message}`, pushed.exitCode);

				const verify = await runGit(ctx, ["--git-dir", target.path, "rev-parse", `refs/heads/${branch}`], workdir, { session });
				if (!verify.ok || verify.stdout.trim() !== headFull.stdout.trim()) {
					return failure(`本地推送完成但校验失败：${target.display}#${branch} 未指向当前提交`);
				}

				return {
					ok: true,
					target: target.display,
					branch,
					commit: commit.stdout.trim(),
					summary: `${target.display}#${branch} ← ${commit.stdout.trim()}`
				};
			}
		};
		ctx.effect(() => ctx.tools.register(definition), "local-git-publish: git_local_push");
	} catch (error) {
		// 预设行绝不能把整个报表模式拖成 Invalid：注册失败只降级为"无该工具"。
		try { ctx.logger?.warn?.(`report-mode: local-git-publish 注册失败：${String(error?.message || error)}`); } catch { /* ignore */ }
		console.warn(`dsh-report-mode: local-git-publish 注册失败：${String(error?.message || error)}`);
	}
}
