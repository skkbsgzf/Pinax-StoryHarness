# 批次74 工单：词汇外泄与样式清账（2026-11-02）

> 调度方工单（独立可执行）。来源：审计 J 项（内部词汇外泄＋三重标题，明写「无批次号、风险低、观感收益高」）、批次63 遗留（状态栏度量抽不出 token）、批次65b/66 遗留（陈旧注释与死规则），以及一批「注释在打脸代码」的账。
> 基线：批次69 收口点（开工时以 git log 现查为准）。
> **红线**：这批**看得见变化**（chip 文案、标题降级、样式删行），所以每项都要改前/改后截图一组；「视觉零变化」不是本批口径，但「不改信息架构、不改色板」是。

## 任务（七条）

1. **内部词表不外泄**：`AppNext.vue:646` 的项目信息 chip 现在原样打印 `${name} · ${kind} · 第 ${revision} 版`——`kind` 是内部 id（`novel`／`script` 一类）。改中文词表映射（表外值兜底成「未识别」并记账，不许直接吐英文 id）；「第 N 版」这类修订号要不要给作者看，登记为一条待裁（我不自裁）。全仓 `next/shell` 文案位扫一遍同类外泄（载体 id、paneId、`group` 名进可见文本的都算）。
2. **同一标题多重渲染去重**：审计记的是「核心区 DOM 里渲染 3 次」【沿用】；【实测·静态】今天有**四个**打印点——页签 label `PaneTabStrip.vue:68`、窗题 `PaneWindow.vue:265`（`:234` 页签态按钮也用 `title || paneId`）、正文头 `CarrierPaneHost.vue:963 h2.doc-title`、状态栏 `AppNext.vue:2515 → StatusBar` 的 `docTitle`（`StatusBar.vue:30/86`）。同屏到底出现几次取决于形态（浮窗态窗题在、页签态换成按钮文字），**本批第一件事是在窗口实拍里数清楚「哪几个同时可见」**，再谈去重。择一保留为主标题，其余降级为 `aria-label`/`title` 或省略号截断——**择哪一个是设计裁量，先出对照截图给作者选，选定后再落代码**。
3. **状态栏样式进 `next-shell.css`**：`.nx-statusbar` 收在 `next/shell/StatusBar.vue:93` 的 `<style scoped>` 里（**不在 AppNext.vue**），代价是底栏 26px 这条度量就地写死**三处**（实测 `:106 flex: 0 0 26px`／`:107 height: 26px`／`:113 line-height: 26px`），抽不出 `--nx-*`。把这段样式移进外壳 CSS，度量走单值（批次67 立了 tokens.css 就进 tokens；未立则先落 `next-shell.css` 的 `:root`，并在记录里标明与 67 的合并点）。同一处还有 `min-height: 24px`（`:123`，批次63 那条命中区裁定的落点）——挪样式时别把它弄丢。
4. **死规则清账**：`next-shell.css:166` 的 `.nx-titlebar-immersive-exit` 全仓零消费者（批次66 记的），本批删。顺带扫外壳 CSS 里同类「规则在、选择器无命中」的死行——扫法要写成可复跑的命令（不能只说「看着删」），命中清单进记录。
5. **陈旧注释改正**：实测今天仍在的四处——`next/shell/paneForms.mjs:26`「缺省形态＝页（`form:'page'`）」对 `:27` `DEFAULT_PANE_FORM = 'dock'`（NOTE-2，指派批次66 未收）；`next/shell/ipcContract.mjs:110`「反向通道只有这三条」对【实测】`IPC_EVENT` **4** 条（`viewChanged`／`runtimeProgress`／`menuInvoked`／`projectEvent`）＋另册 `IPC_PUSH` 3 条（NOTE-3，同上）；`next/testing/exportHostDescriptor.mjs:20`「PANE_FORMS（五态）」对【实测】`next/shell/paneForms.mjs:17` 的三值 `['dock','split','overlay']`；裁定台账里 NOTE-2／NOTE-3 的去向。**注意别顺手改错**：`next/doctor.mjs:155` 的「五态」指 doctor 自己的五种判定态、`carrierManifest.paneSemantics.mjs:12` 的「第五态」是历史告诫，两处都与形态词表无关，不在本条范围内。逐处按**现状**改注释，不改逻辑（值该不该改成 `page` 是另一条待裁，别在注释批里偷偷改行为）。
6. **legacy-copied 区遗留样式**：老前端迁入的会话形态仍留 21px 大标题与 6/18/20px 散装圆角（UI-consistency §7 记的）。逐个收编到刻度值——**值不变的替换**；若某处收编必然改观感，登记为「待设计裁量」，不硬收。
7. **`PINAX_NEXT_CARRIERS_DIR` 进文档正文**：批次65b 记的欠账，spec v2 全文今天仍 0 命中该变量名。补进 [规范 v2](./pinax-electron-next-spec-v2-20261102.md) 附录的环境变量表。

## 允许文件

`next/shell/AppNext.vue`、`next/shell/PaneWindow.vue`、`next/shell/StatusBar.vue`（样式移出）、`next/shell/paneForms.mjs`（**只改注释**）、`next/shell/ipcContract.mjs`（只改注释）、`next/shell/styles/next-shell.css`、`next/shell/styles/tokens.css`（如已存在）、`next/testing/exportHostDescriptor.mjs`（只改注释）、`docs/plan/pinax-electron-next-spec-v2-20261102.md`、`docs/plan/pinax-ruling-ledger-20261102.md`（NOTE 收编登记）、`next/tests/**`、本批工单与记录。

## 禁止边界

`DEFAULT_PANE_FORM` 的**值**不许动（那是 D 类裁量）；不动窗口系统／命令面／协议／写族；不改色板语义与布局结构；不改 `server/**`、`src/**`；不加依赖；不起 Electron、不执行 git。

## 守卫标记

批次45–70 全清单继承；本批新守卫：chip 文本无内部 id 的断言（喂 `kind:'novel'` 出中文）、`.nx-titlebar-immersive-exit` 零命中（规则与选择器两侧都查）、状态栏 26px 走单一 token。

## 验收判据

`npm run verify:next` 五段全绿；每项改前/改后截图一组（第 2 条的对照要给作者择一）；死行清扫的复跑命令写进记录；NOTE-2／NOTE-3 在台账里标闭合并给出处。

## 记账指标（不进闸）

内部词表命中与处置清单（多少处、哪几处仍留待裁）；死 CSS 行清单；散装圆角/字号收编数量与豁免数量。

---

## §7 执行方回填 ／ §8 调度方验收

（批次记录执行方落盘 `docs/plan/pinax-electron-next-m2-batch74-20261102.md`；§8 调度方补。）
