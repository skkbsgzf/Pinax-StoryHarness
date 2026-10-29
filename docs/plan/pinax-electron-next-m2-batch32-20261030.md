# Pinax-Electron-Next M2 批次32：富渲染迁移第一档——marked＋DOMPurify 渲染基座（2026-10-30）

> 作者指令：旧组件是 Web 实现（Vue3＋marked＋DOMPurify），「中心区域支持 Web 和 MD 的这部分尽可能迁移」。本批把 MD 渲染基座换成旧线同款，为 wiki 视图/关系图画布（批次33+）铺底。
> 执行方式：CreateWorkflow 编排＋Codebuddy CLI（deepseek-v4.1-flash，196 轮 / 约 7 分钟）。

## 1. 交付

**mdRender 内核换 marked**（`next/shell/mdRender.mjs`）：`marked.parse`（gfm:true, breaks:false——与旧线 DocumentReader 同口径）＋ 双档清洗：有 DOM → DOMPurify＋allow-list（与 `src/utils/sanitize.js` 同源的表复制，唯一差异是收 `input`＋`checked/disabled`——GFM 任务列表的惰性标记）；无 DOM → `fallbackSanitize`（regex，协议归一化补洞：`java\nscript:` 判掉）。手写解析器退役，`renderMarkdown(text)` 签名不变，四处调用方零改动。

**能力对齐**：表格／图片／任务列表／自动链接／h4–h6／行内 HTML（白名单内）全部获得——批次26 手写版认不出的东西现在都认。`.nx-rendered-md` 补表格（`--hairline-soft` 边框＋`--surface-workbench-input` 表头）、图片 max-width、任务列表 checkbox、mark/kbd/sub/sup、代码块样式，全 token。

**测试**：md-render.test.mjs（node 轨 5 例）＋ md-render.spec.mjs（jsdom 轨 3 例：DOMPurify 档剥 script/onclick/javascript:，双档一致性抽查）＋ export-service ＋1（md→doc 走同一渲染，表格进 Word 且危险内容剥）。

## 2. 调度方补刀：切断主进程对 marked 的依赖（评审高危发现）

评审员实测：mdRender 顶层 import marked/dompurify 后，主进程链 `main.mjs → exportService.mjs → mdRender.mjs` 把两者**内联进了主进程 bundle**（外壳 1716→1837.8 kB，+112.8，含 marked 报错串与 createDOMPurify），违反本批「主进程不许 import marked」。修复：`fallbackSanitize` 拆出独立模块 `next/shell/sanitizeFallback.mjs`（零第三方依赖），exportService 改从那里拿清洗，mdRender 只在渲染层用。复跑：needle 清零，外壳回 **1716.2 kB**。另按评审提示把 carrier-pane.spec.mjs 行尾翻回 CRLF（批次31 已做）。

## 3. 门禁（调度方独立复跑，含补刀后复跑）

验收 **16/16** · 内核单测 **402/402**（＋6）· 外壳界面测 **107/107**（＋3）· eslint 0 警 · 打包 a–l 全过（外壳 1716.2 kB／渲染 816.3 kB／CSS 138.3 kB——渲染层因 marked/dompurify 入包 +133.8 kB，记账无硬上限）。

## 4. 截图

`png/78-light-marked-table.png`（条目阅读态：GFM 表格带表头底/边框，格内 `**已核**` 粗体渲染；执行方另交 headless 双拍 `next-batch32-shots/`）。

## 5. 诚实边界

- `breaks:false`：正文单换行不折 `<br>`（旧线 DocumentReader 同默认；要旧手写版的段内换行手感，一处开关可开）。
- HTML_CONFIG 是复制不是 import（渲染层不许拖旧轨 src/，打包门禁 f）——表更新需两边一起改（同源注释已写）。
- fallbackSanitize 比 DOMPurify 松（不做 allow-list，只灭危险面）：已知未覆盖 `srcdoc`、style 属性里的 `url()`；仅用于 node 测试轨与主进程的兜底清洗。
- 批次26 的 `pre.md-code` 死样式未删（CarrierPaneHost scoped 样式不在本批允许清单）。
- 执行方交了 headless 静态页双拍（next-batch32-shots/）；真窗口证据为调度方截图 78。
