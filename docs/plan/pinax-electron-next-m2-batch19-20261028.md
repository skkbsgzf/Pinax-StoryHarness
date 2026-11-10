# Pinax-Electron-Next M2 批次19：核心区去噪＋知识服务 all-in-one（2026-10-28）

> 作者指令：①「你加了很多不必要的按钮。比如说，保存到第二版，还有一些提示，这些应该是原版的代码里面没有的」；②「所有的服务全部 all in one……尽可能集成在一个底座里面」。
> 执行：workflow coder（DeepSeek flash）两单全绿；调度方验收（与批次20 合并态一起独立复跑）。

## 1. 交付

**H1 核心区去噪（对齐老版保存交互）**
- 老版基准取证：`src/pages/Authoring.vue:12-17` **无常驻保存按钮**——反馈是自动消失的小 chip（`wall__save-chip`），失败才出自救条。
- 四个编辑面（章节/构思/资料/约束）**移除常驻保存按钮**，改 **Ctrl+S 触发**；反馈改自动消失 chip（成功「已保存 · 第 N 版」2.5s 淡出、失败常驻＋重试；STALE 附「重新载入」）；chip 度量照老版（`Writing.scoped.css:213-250`，legacy-copied 标记）。
- 「已载入 N 字 · 第 N 版」notice 条在 open* 五处移除（字数版本在头部 meta 行）；「历史…」文字钮收敛为行尾图标钮；「新建构思/约束」常驻输入收敛进索引窗区标题「＋」钮。
- 断言同步：carrier-pane.spec 八处保存用例改键盘触发、notice 断言改 chip 断言、新增 chip 收起/重试/Esc 三用例；carrier-pane-real.spec 一处越界同步（常备授权）。

**H2 知识服务 all-in-one（进程内直调，RAG 检索桌面化）**
- `next/runtime/knowledgeService.mjs`：包装 `createKnowledgeRuntime`（`server/services/knowledgeRuntime.js` 的进程内服务——worker 线程执行 kb_search/kb_read/worldbook_search，**无 HTTP 无 Express**）；`search/collect` 全返回 ok/error 信封，KNOWLEDGE_* 码原样透传。
- 接线：五条通道中的两条（`knowledge:search`/`knowledge:index-status`），未注入如实报缺；资料载体 +`pinax_reference_search`（默认限定 `资料/`，聚合面 32→33）。
- 资料板检索 UI：输入→命中列表（readRef/片段，provenance 退路）→点击打开原文；三种空态如实（内核未装/服务忙/无命中）。
- **真实检索已跑通**（coder 实测）：临时项目真链路返回命中（「设定集」带 provenance 与摘录「…雪埋了半条街。」）。

## 2. 门禁

工单侧：测试套/lint/acceptance 各自实跑全绿。调度方独立复跑（与批次20 合并态）：内核单测 **203/203**、界面测 **70/70**、a–k 全过（内联 git＋知识服务后内核 bundle 910.9 kB）。

## 3. 诚实边界（执行方上报＋调度方核）

- **打包限制**：知识运行时经 worker 从 `server/services/` 源码懒加载（bundle 内联会丢 worker 文件）——从仓库运行 OK；**出安装包需拷 worker 两个文件到 bundle 旁**（本批受约束未做）。
- **python3 商店存根**（老坑）：检索需 `PINAX_PYTHON=python`，主进程未自动探测。
- 索引自动同步定时器、sync UI、全局知识面（entry 恒为当前项目）未做。
- H1 口径：大纲/条目编辑面保存按钮保留（不在四编辑面内）、接受 Ctrl+S 但无 chip（下批统一）；新建类/采纳类动作反馈仍走 notice（去噪≠删功能）。
- 未做自动保存（老版同为手动触发）。
