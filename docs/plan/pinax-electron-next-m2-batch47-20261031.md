# 批次47 记录：标杆1 协议标杆化＋统一开发者指导（2026-10-31）

> 本批为调度方亲写批（文档与验收性工作，无代码实现——novel manifest 核查结论是零改动，见下），与批次48 的执行派发并行。

## 交付

1. **统一开发者指导**：[pinax-plugin-author-guide-20261031.md](./pinax-plugin-author-guide-20261031.md)——底层法（文件→插件→MCP→agent kit，不注册不行动）、v3 字段速查全表（四张牌 entry/services/mcp/agentMd＋settings 命名空间）、五步接入（含 acceptance 硬编码计数同步义务）、形态三档×五态（document/board/app × dock/split/overlay/fullscreen/immersive）、novel 活样板拆解、纪律清单（评审员五查）、挂账边界。以批次46A 态为基线。
2. **novel manifest 全协议面检查**：五态 forms 全声明、settings 声明、agentMd、context（writing-chapter 档→authoring.review.chapter 只读任务）、8 把工具、provides ['text.chapters'] 全在——**结论零改动**。`commands` 不补：v3 的 commands 只进聚合表无面板 UI，为标杆而塞即协议空转（反例进了指南）。
3. **小说套件功能对账总表**：[pinax-electron-next-novel-suite-audit-20261031.md](./pinax-electron-next-novel-suite-audit-20261031.md)——写作核心/章节文件管理/Agent 协议面三组逐功能对照老线证据与落点批次；标杆1 达成结论＋挂账清单（PM 系、校对批次会话、拖拽排序、M4 域、商业化声明位、v3.1 跨板授权）。
4. **《大梦》真窗口实拍**（作者真实工作副本，`D:\Pinax-e2e\next-batch47-shots\png\`，正文 md5 前后一致 `173293f8`）：
   - 100 大梦正文阅读态（批次43 md 渲染）；101 沉浸态（菜单含「沉浸」、活动栏收起）；
   - 102 沉浸编辑态＋动作带[续写，审查本章]——**同时抓到一个行为实证**：Esc 没退沉浸，因为工作区有一枚收起的大纲浮窗（右缘侧标签），按批次45 的 Esc 优先级（先浮窗后沉浸）这是**按设计行为**，jsdom 用例 :2614 钉的就是它；调度方误判风险记一笔；
   - 103 顶栏「退出沉浸」按钮出口验证＋**沉浸态跨重启持久化**实证（重启后 rail 仍收起，退出后 workspace.json 的 novel.editor#1 回 dock，作者的大纲收起标签原样保留）。

## 验收口径

无门禁变化（零代码改动）；47 的四项交付随批次48 收口一笔提交（工作树含 48 执行中改动，不单独切提交）。

## 已知边界

1. 开发者指南的「外部插件目录发现」一节待标杆2 真接批后补（当前插件只有内置与代码注入两条路）。
2. 对账表老线行号沿用 10-30 盘点口径，未逐行复核漂移。
3. 大梦实拍只覆盖只读动作＋沉浸进出（未做删改——真实书不动）。
