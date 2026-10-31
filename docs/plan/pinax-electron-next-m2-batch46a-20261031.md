# 批次46A 记录：标杆1 写作核心——章节管理＋审查本章＋五动作信封升级（2026-10-31）

> 标杆插件计划第二批（上半）。执行：Qoder CLI（DeepSeek-Flash，258 轮/约 19 分钟，退出码 0），Zcode CreateWorkflow 编排派发＋独立复核。工单与执行方 §7 详见 [工单](./pinax-electron-next-m2-batch46a-ticket-20261031.md)。

## 交付（细节以工单 §7 回填为准）

1. **章节管理**：fileService 受控 `deleteFile`/`renameFile`（归属闸＋写权限、**删改前强制历史快照**、修订账清理/迁移、未审提案拒并点名、同目录改名）；novel 载体 +2 写工具 `pinax_chapter_delete`/`pinax_chapter_rename`；`CARRIER_WRITE_CLASS` 两行、toolSelect 写族正则扩入 `_delete|_rename`；IndexWindow 右键四项（删除两步确认/行内重命名/上移/下移＝NNN 前缀交换）。
2. **审查本章**：动作带新增入口（聚焦浮出，随批次41 动作带），固定问句走既有 runtimeAsk（命中 `authoring.review.chapter` 只读轨）；结果卡渲染 summary/issues/actions，每条 issue「转改写」预填改写动作。
3. **五动作信封升级**：`writingComplete` 组信封带【本书参考】段（大纲/世界书/约束块，envelope 裁剪）；参考缺席**降级为裸补全并如实标注**；`references` 清单回传；提示词预览口（最近一次 system+user，结果卡折叠层）。

## 调度方验收（含验收期补刀）

- 门禁独立复跑 exit 0；**验收期补刀一处**（评审员 medium 发现，调度方亲修）：`pendingProposalsFor` 原实现只拦 MCP 内容提案轨（status:'proposed'），漏了 agent 工具循环 review 档经 proposalStore 落盘的 `status:'pending'` 提案（路径在 `args.file` 不在 `target.file`）——改为**两轨通拦**（非 adopted/discarded 即拦＋双路径匹配），补 agent 轨测试用例（`file-service.test.mjs`，含弃用后放行）。执行方偏离未申报此收窄，记信用账。
- 评审员另核：**执行窗口触碰的 31 文件与允许清单一一重合，零越界**（103 个清单外文件全是 10-20 基线漂移，mtime 归因；评审同时确认调度方给的 diff 命令被 Pinax-pr 陈旧索引失真，改用临时索引 read-tree 重算——该坑第二次咬人，派发工单里的 diff 指引以后直接写临时索引版命令）。
- 门禁（补刀后调度方复跑）：验收 20/20（toolCount 39/24）·内核 **530/530**（+13）·界面 **168/168**（+11）·eslint 0 警·打包 a–n3 全过（主 1,711.0 kB/外壳 1,962.6 kB/渲染 js 989.2 kB）。
- **真窗口实拍**（dameng-px，`D:\Pinax-e2e\next-batch46-shots\png\`）：93 章节右键菜单四项；94/95 行内重命名「延迟→延迟（验收）→延迟」全链两遍（快照前置＋修订账迁移＋树刷新）；96 聚焦浮出动作带＝[续写，审查本章]＋额外要求输入框；97 审查本章点击→**「运行时执行失败：fetch failed」如实展示**（本机无模型凭据——不挂起不造假）；Agent 卡工具面 39 把（+2 实锤进面）。

## 已知边界（如实记）

1. 真模型下的审查结果卡内容未验（本机无凭据）；失败路径已验。
2. 停用清理/快照依赖 history.git 可用——历史仓库损坏时删改如实中止（设计如此）。
3. 上移/下移只做相邻交换，拖拽排序挂账；跨目录 move 不做。
4. 审查本章无批次会话管理（一次一报）；提示词预览是最近一次快照非实时。

## 复现

```bash
cd D:/Pinax-main/Pinax-main && npm run next:build:main && npm run next:build:shell && npm run verify:next
node D:/Pinax-e2e/capture-b46a.mjs
```
