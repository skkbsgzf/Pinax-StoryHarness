# 批次32 执行工单：富渲染迁移第一档——marked＋DOMPurify 替换手写渲染器（2026-10-30）

> 执行方：Codebuddy CLI（DeepSeek v4.1 Flash），经 workflow 编排派发
> 调度方：Zcode（验收、门禁、提交）
> 作者指令：旧组件是 Web 实现（Vue3＋marked＋DOMPurify），「中心区域支持 Web 和 MD 的这部分尽可能迁移」。本批先把 **MD 渲染基座**换成旧线同款，后续批再迁 wiki 阅读视图与关系图画布。

## 0. 现状锚点（先读再动手）

- `next/shell/mdRender.mjs`（批次26）：手写轻量解析＋自带 regex `sanitizeHtml`。调用方四处：CarrierPaneHost 三处阅读面与提案两段（`nx-rendered-md` v-html）、ExportSection 的 doc 导出。**导出面只有 `renderMarkdown(text)`，本批不许改签名**。
- 旧线同款：`marked ^18.0.3`＋`dompurify ^3.4.7` **都已在 package.json**（旧线依赖，复用不算新增）；旧 sanitize 口径 `src/utils/sanitize.js`——DOMPurify＋严格 ALLOWED_TAGS/ALLOWED_ATTR/ALLOWED_URI_REGEXP（56 行，含同源注释）。
- 测试环境分两轨：vitest（jsdom，有 DOM）与 node --test（无 DOM——`export-service.test.mjs` 直接 import mdRender）。

## 1. 任务一：mdRender 内核换 marked，sanitize 双档

```js
// next/shell/mdRender.mjs 对外不变：renderMarkdown(text) → html 字符串
// 内部：
//   解析：marked.parse(text)（marked.setOptions 按 gfm:true, breaks:false 起步）
//   清洗双档：
//     window 在场（渲染层真环境）→ DOMPurify.sanitize(html, HTML_CONFIG)
//       HTML_CONFIG 照 src/utils/sanitize.js 的表（import 复用它，保持单一事实源；
//       若 import 会拉进不该进的依赖则同表复制并注明「与 src/utils/sanitize.js 同源」）
//     无 window（node 测试轨）→ 沿用现有 regex sanitizeHtml（改名 fallbackSanitize 保留）
// 两档都必须剥 <script>/事件属性/javascript:——一档松一档严就是漏洞。
```

调用方四处零改动。主进程**不许** import marked（doc 导出的 html 由渲染层生成后经通道传主进程写盘，现状已如此）。

## 2. 任务二：样式对齐（新能力要看得出来）

marked 自带而手写版没有的：**表格、图片、任务列表、自动链接、h4-h6、行内 HTML 白名单标签**。`.nx-rendered-md` 补齐这些元素的样式——全 token：表格边框用 `--hairline-soft`、表头底 `--surface-workbench-input`、图片 max-width:100%、任务列表 checkbox 原生。阅读面行高/字号不动（P18 已定）。

## 3. 任务三：断言

- node 轨（export-service/md-render 相关）：更新为 marked 输出口径——标题 `<h1>`、粗体 `<strong>`、代码 `<code>`、表格 `<table>`；fallbackSanitize 档仍剥 script（无 DOM 也要安全）。
- vitest 新增 jsdom 用例：DOMPurify 档剥 `<script>`、`onclick` 属性、`javascript:` href；表格渲染 `<table>`；与 fallback 档同输入的 allow-list 行为一致性抽查（两条输入两边跑，允许实现差异但禁 executable 内容穿透）。
- 现有 carrier-pane「阅读态含 `<strong>`」用例不动，应自然通过。

**允许文件**：`next/shell/mdRender.mjs`、`next/shell/styles/next-shell.css`、`next/tests/`（md-render/export-service/carrier-pane 相关测试）、`next/shell/settings/ExportSection.vue`（仅当断言需跟）。**不许改**：调用方接口、主进程、内核、package.json。

## 4. 门禁

`npm run verify:next` 五段全绿（基线：内核 396、界面 104、打包 a–l；渲染层体积因 marked/dompurify 入包会涨——记账即可，无渲染层硬上限）。

## 5. 边界

- **不新增 npm 依赖**（marked/dompurify 已在）；不引 katex/mermaid/语法高亮（后续批）
- 导出面签名不变；主进程零改动
- 安全同源性：两档 sanitize 的 allow-list 意图必须一致；缺口在 limitations 里写明
- 执行方不 commit/push、不启停 electron
