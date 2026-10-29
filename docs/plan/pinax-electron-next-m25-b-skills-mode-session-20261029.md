# M2.5-B 交付记录：技能包、模式真值、会话落盘（2026-10-29）

> 执行方：Qoder
> 工单：[pinax-electron-next-m25-b-skills-mode-session-ticket-20261029.md](./pinax-electron-next-m25-b-skills-mode-session-ticket-20261029.md)
> 结论：三项全部落地，门禁全绿。会话的真相已从 localStorage 搬到 `.pinax/sessions/<id>.jsonl`；
> 写模式成为会话真值（切 auto 需二次确认）；五个技能以「一行清单 + `pinax_skill_read` 正文」渐进披露。

## 1. 任务一：技能是包

| 文件 | 内容 |
| --- | --- |
| `next/skills/loadSkills.mjs` | frontmatter 解析（name/description/tools/output）、tools 必须在当前面里、缺的记账 `rejected`、`skillCatalogLines` 一行清单、`readSkillBody` |
| `next/runtime/skillTools.mjs` | `pinax_skill_read`（只读，`kernel.runtime.skill` 归属，不在内核 19 名单里） |
| `next/skills/{outline-restructure,chapter-rewrite,worldbook-refactor,continuity-check,scene-expand}/SKILL.md` | 五个真实操作技能，产物只认 `proposal` / `checklist` |
| `next/runtime/mcpSurface.mjs` | `createRuntimeSurface` 装载技能、挂 nativeMap；工具面＝内核 19 ∪ 载体 ∪ 技能读取＝20 起 |
| `next/runtime/runnerAdvisor.mjs` | 系统提示只加一行清单（“要用哪个先调 `pinax_skill_read`”） |

窄项目（只开了小说/剧本）里，大纲/世界书技能会因 `pinax_*` 工具不在面上而**不装载并记账**——这是预期，不假装列出。

## 2. 任务二：模式是真值

- `agentSessions`：每个会话带 `writeMode` 与 `events`；`setWriteMode` 未知值回落 `review`，变化写一条 `{kind:'mode', from, to, by:'author', at}`；`recordEvent` 缺 `at` 由存储补（测试抓到的真缺陷）。
- `RuntimeDock`：`:mode` / `@update:mode` 接线；载荷恒带 `writeMode`。
- `AssistantDialog`：点徽章一次只出确认条（`role=alertdialog`），确认后才切 auto；auto→review 直接切。`aria-pressed` 表达“确认条开着”。
- `agentRuntime.ask`：`normalizeWriteMode` 后交给 runner；未知技能返回 `PINAX_INVALID_INPUT` 并带 `rejected` 记账。
- `ipcContract.runtimeAsk`：`writeMode` / `skill` 只在载荷里有键时才透传（旧调用面不变）。

## 3. 任务三：会话落盘

| 文件 | 内容 |
| --- | --- |
| `next/sessionStore.mjs` | `.pinax/sessions/<id>.jsonl`；行类型 `session/message/event/proposal/tombstone`；`loadAll` 坏行跳过并记账；`appendMessage`/`setWriteMode`/`recordProposal`/`rename`/`tombstone`/`importLegacy`/`saveSnapshot` |
| `next/shell/sessionMigration.mjs` | `migrateLegacySessions`：读老键 → `sessions:import` → **成功才 removeItem**；坏 JSON/写盘失败保留旧键；`legacyLocalStorage()` 是 shell 里唯一碰 localStorage 的函数（只读） |
| `next/shell/agentSessions.mjs` | 不再碰 localStorage；状态机只经 `save(payload)` 异步落盘（同步抛/Promise 拒绝都只降级，`persistent=false`） |
| `next/shell/RuntimeDock.vue` | 换项目：迁移老键 → `sessions:load` 读回 → 之后每次变化串行交整份快照（拷贝后排队，旧快照不能盖新快照）；迁移失败在右栏底部如实说 |
| `next/index.mjs` / `next/shell/ipcContract.mjs` | 三条通道 `sessions:load / save / import`，只认当前项目根 |
| `next/testing/bundleAssertions.mjs` | d 恢复“纯内核面 19 把”；新增 d2 用真实运行时面核 20 把（含 `pinax_skill_read`） |

墓碑规则：删父会话写墓碑、文件不删；子会话**不陪葬**，`parent` 改回 `null`（隔代关系不动）。

## 4. 门禁（本机实测）

- `node next/testing/acceptance.mjs`：16/16。
- `node --test "next/tests/*.test.mjs"`：346/346（新增 `skills` 6、`write-mode` 5、`session-store` 8）。
- `vitest run --config next/vitest.next.shell.config.mjs`：99/99（shell-ui 62，新增模式二次确认、快照读回/回写、迁移删键两条半）。
- `npm run lint:next`：0 error / 0 warning。
- `node next/testing/bundleAssertions.mjs`：a–k 全过；主进程 986.3 kB、外壳 1686.1 kB、渲染层 js 657.6 kB。

## 5. 边界（没有做到／没有验证的）

1. **打包后技能目录没跟着走**：`next/skills/` 还没进 `next/.build`，装机后 `loadSkills` 找不到目录 → 清单为空（`pinax_skill_read` 工具仍在）。开发/测试轨正常。
2. **窗口关闭不保证冲刷最后一次快照**：保存按顺序异步发；关窗时在途的最后一份可能没写完。没有做 beforeUnload 同步冲刷（Electron 里也不可靠）。
3. **跨进程没有文件锁**：同一项目开两个窗口会各自按整份快照重写，后写者赢。单窗口路径已验证。
4. **会话不再有浏览器缓存兜底**：无桥（纯浏览器预览）时只活内存；这是把 localStorage 从真相源里拿掉的代价。
5. **`.pinax/sessions/` 是否进历史快照未改**：R10 仍待裁；本批没有动历史/备份的包含规则。
6. **真实模型链路未复测**：本批只跑确定性测试与打包门禁，没有起 Electron、没有真模型调用。

## 6. 踩坑账

1. `next/sessionStore.mjs` 里本地方法 `rename()` 与 `node:fs/promises` 的 `rename` 同名，函数声明提升把导入遮住，迁移的 tmp→正式文件重命名静默走成“会话改名”，`importLegacy` 报成功但文件留在 `.tmp`。修复：`rename as renameFile`。
2. `saveSnapshot` 首写不 `mkdir`，新项目第一次落盘 ENOENT；修复：写前 `mkdir(dir, {recursive:true})`。
3. 自动标题依赖 `autoTitled=false`：用显式标题建的会话会被判成“自动标题过”，之后不再跟着第一条 user 消息改——测试夹具一开始用显式标题，抓出来的正是这条既有语义。
4. 视觉门禁的 `stripComments` 只去 `/* */`，行注释里的 `localStorage` 字样也会被算成使用；`ipcContract` 的说明文字改成“老浏览器缓存”。
5. A 批曾把 bundle 断言 d 从 19 改成 20，但 d 用的是 `createMcpSurface`（纯内核面），真跑 verify 时才炸；本批恢复 d=19 并新增 d2 走 `createAgentRuntime`。
