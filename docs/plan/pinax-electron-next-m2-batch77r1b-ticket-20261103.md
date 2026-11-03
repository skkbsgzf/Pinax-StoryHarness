# 批次77-R1b 工单：AssistantDialog typeahead 合一收口（2026-11-03）

> 调度方：Zcode。执行方：Qoder CLI（Qwen3.8-Flash）。
> 现状：批次77-R1 执行方死于 provider 500（205 轮），AssistantDialog.vue 的「两套键盘逻辑合一」**只做了一半**——composerTypeahead.mjs 的 API 已 import（applyComposerToken/buildComposerMenu/detectComposerToken），但旧 slash 状态块（slashCommands/slashClosed/slashIndex/slashOpen/pickSlash）还在并行，且 `isSlashDraft` 引用悬空（调度方已补回 import，现值：`import { SLASH_COMMANDS, isSlashDraft } from './slashCommands.mjs'`）。**当前 vitest 75 条红**（3 文件失败：shell-ui.spec 为主＋carrier-pane 两条）。
> **规格＝测试**：shell-ui.spec 既有用例＋批次77 工单任务3 的验收条款就是完成定义；composerTypeahead.mjs 的 API（detectComposerToken/buildComposerMenu/applyComposerToken/extractSkillToken/skillNameList）是既定工具。工作树里你前任的全部半成品都在。

## 任务

1. **完成 AssistantDialog.vue 的合一**：旧 slash 状态块（pendingCommand/slashCommands/slashClosed/slashIndex/slashOpen/pickSlash 等）与 @ 引用弹层（refOpen/refQuery/refIndex/referenceGroups）统一收到 composerTypeahead 的判定与菜单构建上（`detectComposerToken` 管光标前 token 判定——含行首/空白前导边界；`buildComposerMenu` 出菜单；`applyComposerToken` 管选中回填）；触发符三类 `/`（技能与命令）、`@`（素材）、`#`（工作流角色——空态「暂无」）；**键位合一**：↑↓ 移动、Enter 选中、Tab 补全、Esc 关闭、Enter 发送（isComposing＋keyCode 229 兜底保持）；停止钮若已接（runtimeAskAbort）保持。
2. **既有用例全部恢复绿**（217 条）；批次77 工单任务3 的验收条款逐条落（typeahead 三类命中＋中文不误触负断言＋技能 token 回填形状＋payload.skill 不硬塞）。
3. **任务5（技能库设置面＋domain）照批次77 工单任务5 全文执行**（SkillsSection.vue/domain 四类/.pinax/skills.json 启停/导入校验——四条验收条款原样）。
4. 越界先补登记再动手（批次77 工单 §补登记 的既有格式）。

## 允许文件

批次77 工单「允许文件」全清单＋其补登记清单（composerTypeahead.mjs/agentRuntime.mjs/toolTurn.mjs/conversationTimeline.mjs 等已落件只读参照，若确需再改先登记）。

## 禁止边界

批次77 工单「禁止边界」全文有效（不动协议形态词表与 PANE/PAGE 状态轴语义、不动写族闸与 writePolicy、不加依赖、不自设阈值、server/src 不改、子代理与工作流产生逻辑归批次78、不 commit、窄屏不动）＋追加：**测试是规格不是被改对象**（除批次77 工单明载的判据反转两条外，不得为绿改断言）；**任务6 不做**（真分支/消息树/‹2/3›切换器归 R2）。

## 守卫标记

守卫⑥⑦⑧⑨⑪全部保持（⑧ typeahead 前导边界是本批主验收之一）；批次45–66 全清单继承。

## 验收判据（完成定义）

`npm run verify:next` 五段全绿（界面 217/217 全恢复＋新增用例）；§7 回填含「合一前后的结构对照」与「越界续表」。

---

## §7 执行方回填 ／ §8 调度方验收

（批次记录执行方落盘 `docs/plan/pinax-electron-next-m2-batch77r1b-20261103.md`；§8 调度方补。）
