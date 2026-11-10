# M2.5-B 执行工单：技能包、模式真值、会话落盘（2026-10-29）

> 执行方：Qoder
> 调度方：作者（逐批点头）
> 作者指令：「确认工具、skill、思维链能契合作者的实际操作」；病根见诊断文档结论 3、4、7。

## 0. 现状锚点

- `next/shell/AssistantDialog.vue:41-42,300-304`：模式徽章 `default: 'review'`，点击 `emit('update:mode')`。
- `next/shell/RuntimeDock.vue:287-300`：挂载 `AssistantDialog` 时**没有** `:mode`，也**没有** `@update:mode`；`runQuestion` 的载荷只有 `{ question, askId }`（`:217-219`）。
- `next/shell/slashCommands.mjs:24-42`：四条命令＝固定提示词模板 ＋ `context.omit`，没有工具绑定、没有产物合同。
- `next/shell/agentSessions.mjs:19-20`：会话存 `localStorage['agentSessions.<projectRoot>']`，30 会话 / 200 条上限。
- 批次29 已交付：五段运行事件、`ask-event` IPC 推送、答后折叠层、trail 封顶 32、askId 分桶。
- 批次27 已交付：会话管理弹层、slash 真路由、`@` 引用解析。

## 1. 任务一：技能是包（`next/skills/`）

- 目录：`next/skills/<name>/SKILL.md`，frontmatter 四字段：`name`（与目录同名）、`description`（一句话，进系统提示的可用清单）、`tools`（数组，必须都在当前工具面）、`output`（`proposal` / `checklist`）。
- 加载器 `next/skills/loadSkills.mjs`：只做三件事——解析 frontmatter、校验 tools 全在面里（缺的该技能不装载并记账）、把 `name/description` 排成一行清单。
- 渐进披露：系统提示只注入一行描述；模型要正文时调新增工具 `pinax_skill_read({ name })`（**新增工具**，归内核 `kernel.runtime`，只读，annotations.readOnlyHint:true）。
- 首批五个技能，全部对应真实操作，不做「万能写作助手」：`outline-restructure`（合并/拆分/重排节点）、`chapter-rewrite`（整章重写走提案）、`worldbook-refactor`（条目拆分/合并/关系补边）、`continuity-check`（连续性核对，只出清单）、`scene-expand`（场景扩写，只出提案）。
- 与 slash 的关系：slash 命令保留为「快捷问句」，技能是「方法说明书」；slash 选中后把 `skill` 名随 ask 带上，`selectTools` 优先按技能声明披露（A 批任务一已留口）。**两者不合并**，一个是入口，一个是方法。

## 2. 任务二：模式是真值

- 会话层状态：`{ write: 'review' | 'auto' | 'blocked' }`，随每次 ask 进载荷 `{ question, askId, writeMode }`。
- `RuntimeDock` 持有真值并绑 `:mode` / `@update:mode`；切到 `auto` 需一次显式确认（对话框内二次点击或确认条），且**只对当前项目生效**，不写全局偏好。
- 每次切换写一条会话事件（谁、何时、从什么切到什么），随会话落盘；徽章显示会话真值，不显示组件默认值。
- 主进程侧：`agentRuntime.ask(question, context, { onEvent, writeMode })` → runner 用它构造 `writePolicy`；未知值一律回落 `review`，不猜测。

## 3. 任务三：会话落盘（JSONL）

- 新模块 `next/sessionStore.mjs`：`.pinax/sessions/<id>.jsonl`，一行一条 `{ type: 'session'|'message'|'event'|'proposal'|'tombstone' }`。
- 迁移：首次打开时把 `localStorage['agentSessions.<projectRoot>']` 读进来写一遍 JSONL，成功后**删除**该键；失败保留并提示，不静默丢。
- 门禁：`visual-contract.test.mjs` 的 localStorage 例外清单同步收紧（会话键从例外里去掉，只剩主题迁移与两条过渡例外）。
- 与 git：`.pinax/sessions/` 不进快照（R10 待裁；默认不进，单独备份）。

## 4. 测试

- `next/tests/skills.test.mjs`：frontmatter 缺字段不装载；tools 不在面里不装载并记账；`pinax_skill_read` 未知技能返回 INVALID_INPUT。
- `next/tests/write-mode.test.mjs`：徽章两点切换到 auto 需确认；载荷带 `writeMode`；主进程未知值回落 review；切换事件进会话。
- `next/tests/session-store.test.mjs`：JSONL 往返一致；迁移后 localStorage 键消失；坏行跳过并记账；父子会话墓碑规则。
- `shell-ui.spec.mjs` 扩：`:mode` 绑定后徽章点击改变真值。

## 5. 门禁

`npm run test:next` → `npm run test:next:ui` → `npm run lint:next` → `npm run verify:next`。

## 6. 边界

- 不改 `server/**`、`src/**`；不新增依赖。
- 不做子代理与 hook 的假显示。
- `blocked` 模式保留但默认不暴露到 UI（R2 未裁前只作为策略值存在）。
