# Pinax-Electron-Next M2 批次38：条目阅读态 Wiki 双链＋反向链接（2026-10-30）

> 执行：并行会话实现；**本记录由 Qoder 收口补记**（该批次未留独立工单，代码注释即范围凭据：
> `next/shell/wikiLinks.mjs:2`、`next/shell/CarrierPaneHost.vue:82/657/666`、`next/shell/styles/next-shell.css:1189`）。
> 收口动作：补 2 条界面级用例、复跑全门禁、记账。未改实现口径。

## 1. 交付

**Wiki 双链（条目阅读态）**：正文渲染成 HTML 之后做 DOM 后处理，把其它条目的名字包成 `.nx-wikilink` 链接；点击经委托跳条目。

- 纯函数 `next/shell/wikiLinks.mjs`：
  - `wikiLinkRanges(text, names)`：整串包含、**最长优先、互不重叠**、按出现顺序；短于 2 字的名字不参与（避免单字糊屏）。
  - `linkifyEntryNames(root, names, { firstOnly = true })`：TreeWalker 只改文本节点，**不碰 HTML 字符串**（正则改 HTML 是转义漏洞的温床）；`<a>/<code>/<pre>/.nx-wikilink` 子树整段跳过；`firstOnly` 默认全篇每 token 只链首现（维基惯例，通用词不把正文糊成蓝色）。
- 词表（`CarrierPaneHost.vue`）：全名＋「·」后的短名＋`keys`＋`tags`；**排除自己的全名与自己的 keys**（不自链）。同 token 撞多条目时先声明者赢。
- 点击：`onRenderedClick` 找 `closest('.nx-wikilink')` → `resolveEntryToken`（按全名或 keys 反查）→ `data.openEntry(item)`；不另开取数路径。

**反向链接（谁提到我）**：`computeBacklinks(entries, currentName, currentPath)` 在阅读态底部列成 `.entry-backlinks` chip 行，点一下 `openBacklink` 按 path（回退 name）跳过去。

- 判据：其它条目 `relations[].to` 包含我的名字，**或**正文包含我的名字；两者都算，不区分来源。
- 排除自己（path 与 name 双重排除）；空名不产生任何反向链接；编辑态不显示。
- 数据只吃 `data.entries`——与表格／图谱同源；关系由批次36 的 `enrichEntryRelations()`（按 path 走既有 read 工具）补齐。

**样式**：`.nx-wikilink` 虚线 wiki 下划线、hover 落实线；`.entry-backlinks` 与 `doc-meta-hint` 同档小字，chip 走 quiet 钮（`next/shell/styles/next-shell.css:1189`）。

## 2. 测试

- 纯函数 4 条：`next/tests/wiki-links.test.mjs`（最长优先／互不重叠；短名与空输入；relations 与正文两条命中路径且排除自己；空名／空清单）。
- 界面 2 条（本批收口补）：`next/tests/carrier-pane.spec.mjs`「Wiki 双链与反向链接（批次38）」——
  ① 全名进词表并点开，`pinax_worldbook_read` 收到 `{ path: '世界书/物品·怀表.md' }`，`data.entry` 真的换过去；自己的名字不自链。
  ② 反向链接行只列 relations 提到我的条目，不含只写短名／无关正文的条目；点 chip 同样跳条目。
- 既有 MD 渲染用例改容差：标题里的名字命中词表时被包成链接也算对（`carrier-pane.spec.mjs:1506`）。

## 3. 门禁（Qoder 收口复跑，`npm run verify:next`）

- 验收 **16/16**；内核单测 **433/433**（基线 412）；外壳界面测 **125/125**（批次36 基线 120，批次37 后 123，本批 +2）；eslint **0 警**。
- 打包 a–l＋m/m2/m3 全过：主进程 1018.2 kB／外壳 1751.1 kB／渲染 872.7 kB／preload 3.6 kB；技能 m 5 目录、m2 5/5 零拒装、m3 覆盖口在。

## 4. 诚实边界

- 双链只接**条目阅读态**；资料／剧本／提案审阅的阅读面不做链接化（那些面的正文不是世界书条目语境，需要时另批）。
- `firstOnly`：同一 token 全篇只链首现；正文里第二次出现的同名不再可点（有意，避免通用 tag 糊屏）。
- 反向链接是**前端计算**：列表条目的 `content` 与补齐后的 `relations` 都在现有载荷里，不新增工具调用；图谱与反向链接对「目标不存在的关系」处理一致——不计入。
- 词表含 `tags`（大梦真稿的触发词住 tags、keys 全空），所以通用 tag 可能进词表；靠 `firstOnly` 限噪。撞名先声明者赢，不做多目标消歧。
- 未起 Electron、未肉眼验收窗口；样式与点击行为只有 jsdom 证据，真机观感未核。
- 源 md 一个字节不改：链接化只发生在渲染后的 DOM 上，编辑态 textarea 仍是源文。
