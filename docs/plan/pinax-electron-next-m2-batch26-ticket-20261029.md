# 批次26 执行工单：剧本载体（M6 提前）＋MD 原生渲染＋导出（2026-10-29）

> 执行方：Codebuddy CLI（DeepSeek v4.1 Flash）
> 调度方：Zcode（验收、门禁、提交）
> 来源：原批次25 草稿工单（未执行）改号重排——批次25 已被 Agent 对话面升级占用。
> 作者指令：M6 剧本提前；剧本与小说都要支持 md 原生渲染、支持导出成 doc/txt。

## 0. 执行指令

```bash
# 在仓库根目录 D:\Pinax-main\Pinax-main 下执行
codebuddy -p "请阅读 docs/plan/pinax-electron-next-m2-batch26-ticket-20261029.md 工单文件，按照工单要求完成全部三个任务的代码实现。完成后运行 npm run verify:next 确认全绿。" --model deepseek-v4.1-flash --dangerously-skip-permissions
```

## 1. 任务一：剧本载体（pinax.carrier.script）

**参考文件**：`next/carriers/setting/manifest.mjs`（manifest 合同）、`next/carriers/novel/tools.mjs`（工具先例）、`next/carriers/index.mjs`（注册表）、`D:/Projects/大梦/资料/章节衍生/第001章/剧本.md`（真实剧本格式样例）。

新建 `next/carriers/script/`：
- `manifest.mjs`：id `pinax.carrier.script`、title `剧本`、dataDirs `{ script: '剧本' }`、scopes `['file:剧本:rw', 'agent:ask']`、capabilities `['script.scenes']`、tools `['pinax_script_list', 'pinax_script_read', 'pinax_script_save']`、context providers `['script']`、panes 照 worldbook（左树＋中栏编辑）。
- `tools.mjs`：照 novel 的 chapter_list/read/save 模式——list 列 `剧本/` 下 .md，read 随手带全文，save 带修订号并发。
- `context.mjs`：script 上下文块——把剧本篇目作为素材（照 reference 惯例）。

在 `next/carriers/index.mjs` 注册（新载体，排在 worldbook 之后）。

**测试**：`next/tests/carrier-script.test.mjs`（manifest 校验/list/read/save 用例，照 carrier-setting 惯例）。

## 2. 任务二：MD 原生渲染

**现状**：所有编辑面用 textarea（纯文本），不支持 MD 语法。

**任务**：为阅读态加 MD → HTML 渲染（编辑态仍用 textarea）。

实现：在 `next/shell/CarrierPaneHost.vue` 的阅读态分支加一个 `v-html` 渲染层——
- 手写轻量 MD 解析（标题/粗体/斜体/列表/代码块/引用/链接，够用就行，**不引第三方依赖**——npm install 需要网络且打包体积受限）
- 阅读态：`<div class="nx-rendered-md" v-html="renderedHtml">` 替代 `<pre>` 纯文本
- 编辑态不变（textarea 纯文本）
- 样式：`.nx-rendered-md` 用 token（标题用 `--archive-ink`、代码块用 `--surface-workbench-input`）；字号若 Next 新增样式须走 `--nx-*` 刻度（visual-contract 门禁管 Next 新增块；参考 AssistantDialog.vue 的双 style 块做法）
- 安全：`v-html` 前做基本 sanitize（去 `<script>`/`<iframe>`/事件属性）

适用范围：章节阅读态、条目阅读态、资料阅读态、约束阅读态、剧本阅读态——**所有 carrier 的阅读态都走 MD 渲染**（编辑态仍 textarea）。

**测试**：carrier-pane.spec 补「阅读态 v-html 含 `<strong>` 标签（MD 粗体渲染后的产物）」断言。

**允许文件**：`next/shell/CarrierPaneHost.vue`、`next/shell/mdRender.mjs`（新，如拆独立模块）、`next/shell/styles/next-shell.css`（860px 区不碰）、`next/tests/carrier-pane.spec.mjs`。**不许改 package.json**。

## 3. 任务三：导出为 txt/doc

**任务**：在统一二级页「文档」组加「导出」节——
- 导出范围：当前打开的文档（章节/条目/构思/资料/约束/剧本）
- 导出格式：txt（纯文本）与 doc（HTML 包 .doc 后缀，Word 可打开——零依赖做法）
- 导出方式：`dialog.showSaveDialog` 选目标路径 → `fs.writeFile` 写入
- UI：导出节列当前文档＋格式选择（txt/doc）＋「导出」按钮＋成功/失败提示

实现：`next/shell/exportService.mjs`（新）——`exportDocument({ content, format, targetPath })`；txt 直接写文本，doc 写 HTML 包裹（`<html><body>` + content，Word 识别为 doc）。

**测试**：`next/tests/export-service.test.mjs`——txt 导出内容一致、doc 导出含 HTML 包裹、路径安全校验。

**允许文件**：`next/shell/exportService.mjs`（新）、`next/shell/settings/ExportSection.vue`（新）、`next/shell/SettingsModal.vue`、`next/shell/AppNext.vue`、`next/shell/ipcContract.mjs`、`next/shell/main.mjs`、`next/tests/export-service.test.mjs`（新）。

## 4. 门禁

每张工单完成后：`npm run verify:next` 五段全绿。

## 5. 边界

- 不做 PDF 导出（需要额外依赖）
- 不做自动保存
- 不做多标签页
- 不改 fileService 的 scope/grant 语义
- 不动内核 MCP 19 工具面
- 不引任何新 npm 依赖（MD 解析手写，导出用 HTML 包 .doc 零依赖做法）
