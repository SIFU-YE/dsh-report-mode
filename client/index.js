/**
 * dsh-report-mode —— 浏览器半区。
 *
 * 唯一职责：当**当前会话就是某个 AgentTeams 团队的队长会话**时，给界面加一个
 * 视觉标识（深色背景 + 右上角角标），避免在报表模式下分不清「我现在是在和队员
 * 对话还是和队长对话」。
 *
 * 这段能力原本写在 AgentTeams 的 fork 里（src/client/index.tsx）。它只用公开接口
 * ——`/plugins/dsh-agent-teams/state` 路由 + `ctx.sessions` + `ctx.effect`，
 * 拿不到也不需要上游内部状态，因此可以完全外移到本插件，让补丁再小一块。
 *
 * 容错：任一环节取不到数据都只是不显示标识，绝不抛出或影响页面。
 *
 * ## 为什么必须是 `__ModuleLoader__` bundle，不能用顶层 export
 *
 * DSH 的 `dsh-client-modules` 读取 `package.json` 的 `exports["./client"]`，把那个
 * 文件的**原始字节**原样拼接进一个经典 `<script>`（`buildComboScript` →
 * `prepareSource`，只剥离 source-map/sourceURL 尾巴，不做任何转译）。
 *
 * 所以这里若写成裸 ESM（顶层 `export`），浏览器会直接抛
 * `SyntaxError: Unexpected token 'export'`——而且脚本是**拼接**的，一个插件出语法
 * 错误会让同一 combo 里的**其它插件也一起**不激活，最终触发
 * `web boot: N entries did not activate` 让整个 Web 启动失败。
 *
 * 同理，顶层 `const STYLE_ID` / `function apply` 会落到全局作用域，与同 combo 里
 * 其它插件撞名（`Identifier ... has already been declared`）。因此所有标识符都必须
 * 收在 `factory()` 闭包里。
 *
 * 目标格式见 DSH 官方模板：
 * `@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development/templates/decoration/client.js`
 * @module dsh-report-mode/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-report-mode',
  factory() {
    /** `sessions` 由 @deepseek-ai/dsh-client-ui-session 提供（见 package.json dsh.client.inject）。 */
    const inject = ['sessions']

    const STYLE_ID = 'dsh-report-mode-teams-style'
    const BODY_CLASS = 'agent-teams-active'
    /** AgentTeams host 插件注册的团队快照路由。 */
    const STATE_ROUTE = '/plugins/dsh-agent-teams/state'
    const POLL_MS = 5000

    function installStyle() {
      if (typeof document === 'undefined') return
      if (document.getElementById(STYLE_ID) !== null) return
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = [
        `body.${BODY_CLASS} { background: #0f1a2b !important; }`,
        `body.${BODY_CLASS}::after { content: ' AgentTeams'; position: fixed; top: 8px; right: 12px; z-index: 99999; color: #ffd700; font-weight: 700; font-size: 13px; background: rgba(0,0,0,0.55); padding: 4px 10px; border-radius: 12px; pointer-events: none; }`,
      ].join('\n')
      document.head.appendChild(style)
    }

    function setActive(active) {
      if (typeof document === 'undefined') return
      document.body.classList.toggle(BODY_CLASS, active)
    }

    /** 当前会话 id（拿不到就当作没有团队，标识不显示）。 */
    function currentSessionId(ctx) {
      try {
        return ctx.sessions?.list?.getSnapshot?.().current
      } catch {
        return undefined
      }
    }

    async function pollOnce(ctx) {
      try {
        const res = await fetch(STATE_ROUTE)
        if (!res.ok) {
          setActive(false)
          return
        }
        const data = await res.json()
        const current = currentSessionId(ctx)
        const teams = Array.isArray(data?.teams) ? data.teams : []
        setActive(current !== undefined && teams.some((team) => team?.captainSessionId === current))
      } catch {
        // 路由不存在（未安装 agent-teams）或页面正在卸载：静默关闭标识。
        setActive(false)
      }
    }

    /**
     * 注册标识：注入样式、立即判定一次，然后每 5 秒跟一次团队状态。
     * @param ctx - 客户端插件上下文。
     */
    function apply(ctx) {
      installStyle()
      setActive(false)
      void pollOnce(ctx)
      const timer = window.setInterval(() => {
        void pollOnce(ctx)
      }, POLL_MS)
      ctx.effect(() => () => window.clearInterval(timer))
    }

    return { inject, apply }
  },
})
