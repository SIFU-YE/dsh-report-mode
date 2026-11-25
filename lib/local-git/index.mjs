/**
 * dsh-report-mode/local-git — 报表模式内置的本地 Git 工具。
 *
 * 由 dsh-plugin-git-workflow（MIT，© sifu-ye fork）vendored 进本包，避免报表
 * 模式再依赖一个 global/host 插件。只注册本地能力：
 *
 *  - `git_init`   — initialize a local repository when the workdir is not one yet
 *  - `git_status` — branch, ahead/behind, staged / unstaged / untracked / conflicts
 *  - `git_diff`   — unstaged or staged diff (with optional --stat summary)
 *  - `git_log`    — recent commits (optionally with touched files)
 *  - `git_commit` — stage paths and create a commit from a validated message
 *  - `git_branch` — list local branches
 *
 * 没有 push / 建远端 / fetch / pull；报表产物只做本地提交。
 * 本地仓库推送由同级模块 lib/local-git-publish 单独提供（仅项目文件夹内路径）。
 *
 * Every `git` invocation goes through the harness shell executor (`ctx.shell`)
 * so sandbox/approval semantics of the normal shell stack apply. The executor's
 * public contract is `resolve(request)` → `execute(spec)` → `handle.result()`
 * (there is no `run()`; using it broke every git tool in production on
 * 2026-11-23). Paths are validated to stay inside the repository, and commit
 * messages are validated and passed with `-m`.
 *
 * @module dsh-report-mode/local-git
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isAbsolute, resolve } from "node:path";
import {
	clampLogCount,
	clampMaxLines,
	parseBranches,
	parseDiffStat,
	parseLog,
	parsePorcelainStatus,
	renderFailure,
	renderStatus,
	truncateLines,
	validateCommitMessage,
	validatePaths
} from "./git.mjs";

/** Stable Cordis plugin name. */
const name = "report-mode-local-git";
/** Hard dependency: the tool registry. */
const inject = ["tools"];

const MAX_BUFFER = 8 * 1024 * 1024;

/** Resolve the tool workdir: explicit arg (relative to session cwd) or the session cwd. */
export function resolveWorkdir(workdir, exec) {
	const headerCwd = exec?.agent?.session?.header?.cwd;
	const fallback = headerCwd ?? process.cwd();
	if (workdir === undefined) return fallback;
	return isAbsolute(workdir) ? workdir : resolve(fallback, workdir);
}

/**
 * Run `git` through the harness shell executor (`ctx.shell`) so the
 * sandbox/approval semantics of the normal shell stack apply — a bare
 * `child_process.execFile` would bypass them (e.g. a read-only session
 * could still `git commit`). Falls back to execFile only when the shell
 * service is absent (defensive; the composition always mounts it).
 * Resolves instead of throwing so the tool can return a structured,
 * model-readable failure.
 */
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

export async function runGitTool(ctx, args, workdir, options = {}) {
	const { timeoutMs = 30000, input, signal } = options;
	const shell = ctx.get("shell");
	if (shell === undefined) {
		// defensive fallback — keeps the plugin working without ctx.shell,
		// but note this path is NOT sandboxed.
		try {
			const { stdout, stderr } = await promisify(execFile)("git", args, {
				cwd: workdir,
				timeout: timeoutMs,
				maxBuffer: MAX_BUFFER,
				windowsHide: true,
				encoding: "utf8",
				input,
				signal
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
			signal,
			...sandboxPolicy !== undefined ? { sandboxPolicy } : {}
		});
		// 2026-11-23 修复（生产报障：`shell.run is not a function`）：
		// 宿主 shell 服务的公开契约是 resolve() → execute(spec) → 句柄.result()，
		// 没有 run()。此前误用旧 API，导致报表模式下 git_status/git_init 全部失败
		// （而仓库测试只桩了「无 shell」兜底路径，所以门禁一直是绿的）。
		// 这里同时兼容「execute 直接解析为结果」的旧/异形实现：有 result() 就再取一次。
		const execution = await shell.execute(spec);
		const result = typeof execution?.result === "function" ? await execution.result() : execution;
		const stdout = result?.stdout?.text ?? "";
		const stderr = result?.stderr?.text ?? "";
		const ok = result?.exitCode === 0;
		// 失败时也要带 message：调用方（各工具）用 result.message 拼结构化失败，
		// 少了它模型只看到空错误，无法定位（2026-11-23 主路径测试暴露）。
		const message = ok
			? undefined
			: (result?.timedOut
				? `git timed out after ${spec.timeoutMs}ms`
				: (stderr || stdout || `git exited with code ${result?.exitCode ?? -1}`)
			).trim().slice(0, 2000);
		return {
			ok,
			exitCode: typeof result?.exitCode === "number" ? result.exitCode : -1,
			stdout,
			stderr,
			timedOut: Boolean(result?.timedOut),
			message
		};
	} catch (error) {
		return { ok: false, exitCode: -1, message: String(error?.message || "git failed").trim() };
	}
}

/**
 * Build a failure result that always satisfies the output schema (`exitCode`
 * must be a number). Git/shell failures are normalized to -1 instead of null;
 * a null previously made DSH reject the whole tool result with
 * "value.exitCode must be a number" before the model could read the message.
 */
function failure(message, exitCode = -1) {
	return {
		ok: false,
		exitCode: typeof exitCode === "number" ? exitCode : -1,
		message: String(message ?? "git failed").trim()
	};
}

/** Reject branch names that could escape the local-only git command. */
export function validateBranchName(branch) {
	if (typeof branch !== "string" || branch.length === 0 || branch.length > 200) {
		return "branch must be a non-empty string (max 200 characters)";
	}
	if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch)) {
		return "branch may only contain letters, digits, '.', '_', '/' and '-' (must start alphanumeric)";
	}
	return "";
}

/** Shell-quote one argument for the `git ...` command line (POSIX + Windows cmd). */
function shellQuote(arg) {
	const s = String(arg);
	if (s === "") return '""';
	// single-quote on POSIX; the shell service runs bash/pwsh per platform
	if (process.platform === "win32") {
		// SECURITY (fork patch): the shell service runs PowerShell on Windows, where the
		// escape character is a backtick, not a backslash. Upstream bash-style escaping
		// left a real command-injection hole: an argument containing '"; <cmd>; "' closed
		// the quoted string and executed <cmd>. Escape ", $ and the backtick so the whole
		// argument stays inside one double-quoted token.
		let out = '';
		for (const ch of s) {
			if (ch === '"' || ch === '$' || ch === '\x60') out += '\x60';
			out += ch;
		}
		return '"' + out + '"';
	}
	return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Shared schema helper: a string parameter. */
const strParam = (description) => ({ type: "string", description });

/** Shared schema helper: an array of repository-relative paths. */
const pathsParam = (description) => ({
	type: "array",
	items: { type: "string" },
	description
});

/**
 * Register the five git tools. All execution and validation logic lives in
 * pure functions (lib/git.js); this wrapper is a thin adapter over execFile.
 */
function apply(ctx) {
	const definitions = [
		{
			name: "git_init",
			description: "Initialize a local-only git repository in a working directory when it is not already inside one. Never creates a remote, never pushes, never fetches. Use this first when the report workspace has no .git directory, then use git_status/git_commit for local version control. Tip: write a .gitignore first to keep runtime/tooling directories (.trash, .openviking, .fr-engine-check, node_modules) out of history.",
			parameters: {
				type: "object",
				properties: {
					workdir: strParam("Repository directory. Defaults to the session working directory; relative paths resolve against it."),
					branch: { type: "string", description: "Initial local branch name (default 'main')." }
				}
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						ok: { type: "boolean" },
						initialized: { type: "boolean" },
						branch: { type: "string" },
						path: { type: "string" },
						exitCode: { type: "number" },
						message: { type: "string" }
					}
				},
				render: (args, value) => {
					if (!value.ok) return [{ type: "text", text: renderFailure(value, "git_init") }];
					return [{
						type: "text",
						text: value.initialized
							? `initialized local git repository at ${value.path} (branch ${value.branch})`
							: `already a git repository at ${value.path} (branch ${value.branch || "unborn"})`
					}];
				}
			},
			timeoutMs: 30000,
			async execute(args, exec) {
				const branch = args?.branch ?? "main";
				const branchError = validateBranchName(branch);
				if (branchError) return failure(branchError);
				const workdir = resolveWorkdir(args?.workdir, exec);
				const probe = await runGitTool(ctx, ["rev-parse", "--is-inside-work-tree"], workdir, { session: exec?.agent?.session });
				if (probe.ok && probe.stdout.trim() === "true") {
					const current = await runGitTool(ctx, ["symbolic-ref", "--short", "HEAD"], workdir, { session: exec?.agent?.session });
					return {
						ok: true,
						initialized: false,
						branch: current.ok ? current.stdout.trim() : "",
						path: workdir
					};
				}
				let init = await runGitTool(ctx, ["init", "-b", branch], workdir, { session: exec?.agent?.session });
				if (!init.ok) {
					// Older Git without `git init -b`: initialize, then point HEAD at
					// the requested branch before the first commit.
					init = await runGitTool(ctx, ["init"], workdir, { session: exec?.agent?.session });
					if (init.ok) {
						const head = await runGitTool(ctx, ["symbolic-ref", "HEAD", `refs/heads/${branch}`], workdir, { session: exec?.agent?.session });
						if (!head.ok) return failure(`git init failed: ${head.message}`, head.exitCode);
					}
				}
				if (!init.ok) return failure(`git init failed: ${init.message}`, init.exitCode);
				const current = await runGitTool(ctx, ["symbolic-ref", "--short", "HEAD"], workdir, { session: exec?.agent?.session });
				return {
					ok: true,
					initialized: true,
					branch: current.ok ? current.stdout.trim() : branch,
					path: workdir
				};
			}
		},
		{
			name: "git_status",
			description: "Inspect the git repository state in a working directory: current branch, upstream and ahead/behind counts, and the staged / unstaged / untracked / conflicted file lists. Returns structured, readable output instead of raw porcelain.",
			parameters: {
				type: "object",
				properties: {
					workdir: strParam("Repository directory. Defaults to the session working directory; relative paths resolve against it.")
				}
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						ok: { type: "boolean" },
						state: {
							type: "object",
							additionalProperties: false,
							properties: {
								branch: { type: "string" },
								upstream: { type: "string" },
								ahead: { type: "number" },
								behind: { type: "number" },
								staged: { type: "array", items: { type: "object" } },
								unstaged: { type: "array", items: { type: "object" } },
								untracked: { type: "array", items: { type: "object" } },
								conflicts: { type: "array", items: { type: "object" } }
							}
						},
						exitCode: { type: "number" },
						message: { type: "string" }
					}
				},
				render: (args, value) => [{ type: "text", text: value.ok ? renderStatus(value.state) : renderFailure(value, "git_status") }]
			},
			timeoutMs: 30000,
			async execute(args, exec) {
				const result = await runGitTool(ctx, ["status", "--porcelain", "-b"], resolveWorkdir(args?.workdir, exec));
				if (!result.ok) return { ok: false, exitCode: result.exitCode, message: result.message };
				const state = parsePorcelainStatus(result.stdout);
				// outputSchema 要求 branch/upstream 为 string；本地仓没有远端、detached HEAD 时
				// 解析器给 null——在工具边界归一为空串，避免宿主 schema 校验把整次调用判失败
				//（2026-11-24 报表模式实测 3 次 "value.state.upstream must be a string"）。
				state.branch ??= "";
				state.upstream ??= "";
				return { ok: true, state };
			}
		},
		{
			name: "git_diff",
			description: "Show the working-tree diff (unstaged by default) or the staged diff (--cached) of a git repository, with an optional --stat summary. Use paths to narrow the diff to specific files.",
			parameters: {
				type: "object",
				properties: {
					workdir: strParam("Repository directory. Defaults to the session working directory."),
					staged: { type: "boolean", description: "Show the staged (index) diff instead of the unstaged working-tree diff. Default false." },
					stat: { type: "boolean", description: "Only show a --stat summary (files changed, insertions, deletions). Default false." },
					paths: pathsParam("Optional repository-relative paths to narrow the diff."),
					maxLines: { type: "number", description: "Maximum diff lines to return (default 500, clamped to 10..2000)." }
				}
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						ok: { type: "boolean" },
						output: { type: "string" },
						truncated: { type: "boolean" },
						stat: {
							type: "object",
							additionalProperties: false,
							properties: {
								files: { type: "number" },
								insertions: { type: "number" },
								deletions: { type: "number" }
							}
						},
						exitCode: { type: "number" },
						message: { type: "string" }
					}
				},
				render: (args, value) => [{ type: "text", text: value.ok ? value.output : renderFailure(value, "git_diff") }]
			},
			timeoutMs: 30000,
			async execute(args, exec) {
				const pathsError = validatePaths(args?.paths);
				if (pathsError) return failure(pathsError);
				const gitArgs = ["diff", "--no-color"];
				if (args?.staged === true) gitArgs.push("--cached");
				if (args?.stat === true) gitArgs.push("--stat");
				if (args?.paths !== undefined && args?.paths !== null) gitArgs.push("--", ...args.paths);
				const result = await runGitTool(ctx, gitArgs, resolveWorkdir(args?.workdir, exec));
				if (!result.ok) return { ok: false, exitCode: result.exitCode, message: result.message };
				const { text, truncated } = truncateLines(result.stdout, clampMaxLines(args?.maxLines));
				return {
					ok: true,
					output: text,
					truncated,
					stat: args?.stat === true ? parseDiffStat(result.stdout) : undefined
				};
			}
		},
		{
			name: "git_log",
			description: "Show recent commit history of a git repository: hash, short date, and subject per commit, optionally with the files each commit touched. Useful for understanding what changed recently.",
			parameters: {
				type: "object",
				properties: {
					workdir: strParam("Repository directory. Defaults to the session working directory."),
					count: { type: "number", description: "Number of commits to show (default 10, clamped to 1..50)." },
					files: { type: "boolean", description: "Also list the files each commit touched (--name-status). Default false." },
					paths: pathsParam("Optional repository-relative paths to narrow the history.")
				}
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						ok: { type: "boolean" },
						commits: {
							type: "array",
							items: {
								type: "object",
								additionalProperties: false,
								properties: {
									hash: { type: "string" },
									date: { type: "string" },
									subject: { type: "string" },
									files: { type: "array", items: { type: "string" } }
								}
							}
						},
						exitCode: { type: "number" },
						message: { type: "string" }
					}
				},
				render: (args, value) => {
					if (!value.ok) return [{ type: "text", text: renderFailure(value, "git_log") }];
					const lines = value.commits.map((c) => {
						const head = `${c.hash}  ${c.date}  ${c.subject}`;
						return c.files && c.files.length > 0 ? `${head}\n${c.files.map((f) => `      ${f}`).join("\n")}` : head;
					});
					return [{ type: "text", text: lines.join("\n") }];
				}
			},
			timeoutMs: 30000,
			async execute(args, exec) {
				const pathsError = validatePaths(args?.paths);
				if (pathsError) return failure(pathsError);
				const count = clampLogCount(args?.count);
				const gitArgs = ["log", `-n ${count}`, "--date=short", "--pretty=tformat:%h%x09%ad%x09%s"];
				if (args?.files === true) gitArgs.push("--name-status");
				if (args?.paths !== undefined && args?.paths !== null) gitArgs.push("--", ...args.paths);
				const result = await runGitTool(ctx, gitArgs, resolveWorkdir(args?.workdir, exec));
				if (!result.ok) return { ok: false, exitCode: result.exitCode, message: result.message };
				return { ok: true, commits: parseLog(result.stdout, args?.files === true) };
			}
		},
		{
			name: "git_commit",
			description: "Create a git commit: optionally stage the given repository-relative paths first, then commit with the given message. The message is validated (non-empty, max 2000 chars, no NUL) and passed to git with -m so it can never be interpreted as shell syntax. Fails clearly when there is nothing to commit.",
			parameters: {
				type: "object",
				properties: {
					workdir: strParam("Repository directory. Defaults to the session working directory."),
					message: { type: "string", description: "Commit message (required, max 2000 characters, may contain newlines for a subject + body)." },
					paths: pathsParam("Optional repository-relative paths to stage before committing. Omit to commit whatever is already staged."),
					allowEmpty: { type: "boolean", description: "Allow an empty commit (--allow-empty). Default false." }
				},
				required: ["message"]
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						ok: { type: "boolean" },
						shortHash: { type: "string" },
						message: { type: "string" },
						exitCode: { type: "number" }
					}
				},
				render: (args, value) => {
					if (!value.ok) return [{ type: "text", text: renderFailure(value, "git_commit") }];
					return [{ type: "text", text: `committed ${value.shortHash}: ${value.message}` }];
				}
			},
			timeoutMs: 60000,
			async execute(args, exec) {
				const messageError = validateCommitMessage(args?.message);
				if (messageError) return failure(messageError);
				const pathsError = validatePaths(args?.paths);
				if (pathsError) return failure(pathsError);
				const workdir = resolveWorkdir(args?.workdir, exec);
				if (args?.paths !== undefined && args?.paths !== null && args.paths.length > 0) {
					const addResult = await runGitTool(ctx, ["add", "--", ...args.paths], workdir, { session: exec?.agent?.session });
					if (!addResult.ok) return { ok: false, exitCode: addResult.exitCode, message: `git add failed: ${addResult.message}` };
				}
				const commitArgs = ["commit", "-m", args.message];
				if (args?.allowEmpty === true) commitArgs.push("--allow-empty");
				const commitResult = await runGitTool(ctx, commitArgs, workdir, { session: exec?.agent?.session });
				if (!commitResult.ok) {
					const hint = /nothing to commit|no changes added|nothing added to commit/.test(commitResult.message)
						? " — stage paths with the `paths` argument (or pass allowEmpty: true for an empty commit)"
						: "";
					return { ok: false, exitCode: commitResult.exitCode, message: commitResult.message + hint };
				}
				const hashResult = await runGitTool(ctx, ["rev-parse", "--short", "HEAD"], workdir, { session: exec?.agent?.session });
				return {
					ok: true,
					shortHash: hashResult.ok ? hashResult.stdout.trim() : "?",
					message: args.message
				};
			}
		},
		{
			name: "git_branch",
			description: "List local git branches with a marker on the current branch. Useful before switching work or opening a pull request.",
			parameters: {
				type: "object",
				properties: {
					workdir: strParam("Repository directory. Defaults to the session working directory.")
				}
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						ok: { type: "boolean" },
						branches: {
							type: "array",
							items: {
								type: "object",
								additionalProperties: false,
								properties: {
									current: { type: "boolean" },
									name: { type: "string" }
								}
							}
						},
						exitCode: { type: "number" },
						message: { type: "string" }
					}
				},
				render: (args, value) => {
					if (!value.ok) return [{ type: "text", text: renderFailure(value, "git_branch") }];
					return [{ type: "text", text: value.branches.map((b) => `${b.current ? "*" : " "} ${b.name}`).join("\n") }];
				}
			},
			timeoutMs: 30000,
			async execute(args, exec) {
				const result = await runGitTool(ctx, ["branch", "--format=%(HEAD) %(refname:short)"], resolveWorkdir(args?.workdir, exec));
				if (!result.ok) return { ok: false, exitCode: result.exitCode, message: result.message };
				return { ok: true, branches: parseBranches(result.stdout).branches };
			}
		}
	];
	for (const definition of definitions) {
		ctx.effect(() => ctx.tools.register(definition), `git-workflow: ${definition.name}`);
	}
}

export { apply, inject, name };
