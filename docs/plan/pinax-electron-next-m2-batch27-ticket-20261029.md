# 批次27 执行工单：Agent 会话管理＋slash 命令路由＋@ 引用参考（2026-10-29）

> 执行方：Codebuddy CLI（DeepSeek v4.1 Flash）
> 调度方：Zcode（验收、门禁、提交）
> 作者指令：「参考 dsh，需要有会话管理……底部输入框的 / 弹出 skill，@ 弹出参考」。批次25 已交付模式标签＋slash 提示＋findings/actions 显示；本批接上剩下三件：会话真管理、slash 真路由、@ 真引用。

## 0. 现状锚点（先读这些再动手）

- `next/shell/RuntimeDock.vue`：messages 是内存 ref（刷新即丢），单会话，无持久化。ask 走 `IPC_CHANNELS.runtimeAsk`。
- `next/shell/AssistantDialog.vue`：批次25 已有 slash 提示（输入 `/` 弹四条，**纯提示不路由**）、模式徽章（review/auto）。
- `next/runtime/contextProfiles.mjs`：`buildRuntimeEnvelope` 的任务档由 `view.contextProfile` 定，`context.omit` 可按块种跳过素材块（块种清单见 `shared/agentContextProfiles.js` 的 blocks：rules/selection/references/worldbook/location/history/memory/style/scene/outline/character）。
- `next/shell/AppNext.vue`：持有 useBoardData 的 data（chapters/entries/documents/scripts 都在这）。
- IPC 通道合同：`next/shell/ipcContract.mjs`（本批**不需要新通道**——解析引用走已有 `runtimeToolCall`）。

## 1. 任务一：会话管理（多会话＋持久化）

新建 `next/shell/agentSessions.mjs`：

```js
// 会话存储：按项目根隔离，localStorage 持久化（与 paneForm.<paneId> / overlay.<paneId> 同一先例）
//   key: `agentSessions.<projectRoot>`
//   值:  { sessions: [{ id, title, createdAt, updatedAt, messages: [...] }], activeId }
// 消息 schema 沿用 RuntimeDock 现有字段：{ id, role:'user'|'agent', text, findings, actions, failed, at }（全部 JSON 安全）
createSessionStore(projectRoot) → {
  list(), active(), switchTo(id), create(), rename(id, title), remove(id),
  append(message), updateLast(patch), setBusy(busy)   // busy 不持久化
}
```

规则：
- 标题自动取会话第一条 user 消息前 24 字，手动 rename 覆盖后不再自动改
- 上限：30 个会话、每会话 200 条消息（超限丢最旧）
- 无会话时首启自动建一个空会话；projectRoot 变化（换项目）各自独立
- 存储写失败（隐私模式等）不崩：降级为内存会话，界面照常

`RuntimeDock.vue` 接 store；`AssistantDialog.vue` toolbar 加一个「会话」按钮（现有 toolbar 里，与模式徽章同排），点开一个**轻量弹层**：
- 列表：标题＋相对时间，当前会话高亮，点击切换
- 「新建会话」一项置顶
- 每项 hover 出删除（或 ✕）；重命名走双击改标题（或省略——若交互成本高就只做删除，在 limitations 里说明）
- Esc 关闭弹层；统一二级页打开时不抢 Esc（照 FloatingWidget 的 suspendEsc 先例）

**测试**：`next/tests/agent-sessions.test.mjs`——建/切/删/改名、上限截断、标题自动生成、存储失败降级、projectRoot 隔离。

## 2. 任务二：slash 命令路由

新建 `next/shell/slashCommands.mjs`：

```js
// 四条命令 = 预设问句模板 + context.omit 组合（诚实剪裁：omit 的块种只是跳过，不假装"专注模式"）
export const SLASH_COMMANDS = [
  { name: '/审阅', template: '请以审稿人视角审阅当前正文：问题按严重度列出，每条配一句可执行动作。', omit: [] },
  { name: '/大纲', template: '请梳理当前项目的大纲结构：主线走向、悬而未决的线头、结构上的风险。', omit: ['scene', 'memory', 'history'] },
  { name: '/总结', template: '请总结当前项目的核心内容：一句话主线＋各板块要点。', omit: ['style'] },
  { name: '/资料', template: '请只依据本书资料（世界书/资料/规则）回答：', omit: ['scene', 'memory', 'outline'] }
]
resolveSlash(draft) → { command, rest } | null   // 识别草稿开头的命令词，rest 是命令后的正文
```

行为（批次25 的提示层升级为真路由）：
- 输入 `/` 弹出的四条提示**可点击/可 Enter 选中**：选中把预设模板填进草稿（命令词本身不留在草稿里），作者可改可补再发送；Esc 关闭
- 发送时 RuntimeDock 若识别到草稿以命令词开头：剥掉命令词，把 `omit` 并进 `runtimeAsk` 的 `context.omit`，消息流里 user 那行显示带命令徽章（如 `/资料`）＋正文
- omit 里的块种在当前档案没有时无害（信封那头本来只是 warning），不许为此改内核

**测试**：`next/tests/slash-commands.test.mjs`——resolveSlash 识别/不误伤正文里的 `/`、模板填入、omit 组装、命令徽章字段。

## 3. 任务三：@ 引用参考

新建 `next/shell/agentReferences.mjs`：

```js
// 引用解析：@《标题》 → 运行时已有工具取摘要，拼进问题
export function parseRefs(text)            // 抽出 @《…》 token 数组
export async function resolveRefs(refs, tool)  // kind→工具映射：
//   chapter → pinax_chapter_read { file }   entry → pinax_worldbook_read { path }
//   document → pinax_document_read { path } script → pinax_script_read { file }
//   每条截前 600 字；最多 4 条；工具失败的那条如实标注「（引用取不到：…）」，不静默丢
export function withRefs(question, resolved)   // 拼成 问题原文 + 每条一段【参考·kind《title》】
```

- `AppNext.vue` 从 board data 组一份引用清单（chapters/entries/documents/scripts 的 { kind, title, path }），经 prop 传给 RuntimeDock → AssistantDialog
- 输入框 `@` 触发弹层（与 slash 同一套弹层样式）：分类列出当前项目内容（每类最多 8 条，标题＋kind 徽章），点击把 `@《标题》` token 插进草稿光标处
- 发送时解析 token：取不到内容（项目里已删等）就在回答流里如实标注，不编内容
- 解析走已有 `runtimeToolCall` 通道，**不新增 IPC 通道**

**测试**：`next/tests/agent-references.test.mjs`——parseRefs/withRefs/截断/上限/失败标注。

## 4. 门禁

每张工单完成后：`npm run verify:next` 五段全绿。

## 5. 边界

- **不新增任何 npm 依赖**
- **不新增 IPC 通道**（会话持久化在渲染层 localStorage；引用解析走 runtimeToolCall）
- **不改内核**（agentRuntime/contextProfiles/信封组装一律不动——omit 是既有能力）
- 不做思维链/子Agent/hook 显示（runner 合同升级，另行排期）
- 不做会话云同步/导出
- 核心工作区不进任何新按钮（U13）：会话入口在 Agent 对话框自己的 toolbar 里
- 新增 CSS 全走 token（--nx-* 字号刻度），legacy-copied 块须显式标注
- 执行方不 commit/push、不启停 electron
