# 批次50 记录：工具执行拦截点＋写族判定去启发化（Cordis 线A）（2026-10-31）

> Cordis 路线（甲＋乙，丙否）落地的第一批。执行：Qoder CLI（DeepSeek-Flash，110 轮/约 15 分钟，退出码 0），Zcode CreateWorkflow 编排。工单源：[roadmap §2](./pinax-carrier-kernel-roadmap-tickets-20261031.md)→[执行工单](./pinax-electron-next-m2-batch50-ticket-20261031.md)；立项依据：[Cordis/dsh 评估](./pinax-cordis-dsh-kernel-evaluation-20261031.md)（两份随本批入库）。

## 交付

1. **`next/runtime/toolInterceptors.mjs`（新）**：`createInterceptorChain`——`runBefore` 顺序执行、`veto` 短路且后续拦截器拿不到被否决调用；`runAfter` 只记账不改结果；接进 toolLoop/toolTurn 既有执行路（不建第二条路）。两个内置消费者：写族闸（返回 `guardDecision`）＋写审计（提交类工具进 serviceLogPool）。
2. **写族三级优先**：annotations（readOnlyHint→读／destructiveHint 或非只读→写）优先，两者全无才回落 `EXTERNAL_WRITE_HINT` 后缀并经池记 `warn`（作者设置节可见）。EXTERNAL_WRITE_HINT 收敛为 kernelWriteGuard 定义＋writePolicy 兜底支函数引用（新守卫达成）。
3. 测试：`tool-interceptors.test.mjs`（含「annotations 与后缀不一致以 annotations 为准」「全无声明回落并记账」两条反向断言）；内核 **569/569**（+7）。

## 调度方验收

- 门禁独立复跑 exit 0；验收 23/23、内核 569/569、界面 179/179、eslint 0 警、a–n3＋l 系全过；真实改动 14 文件 +1041/−81（10 代码＋4 文档）零行尾翻转。
- 评审 4 条裁定：①**high（非本批问题）——「基线漂移之谜」破案**：blob 哈希取证证明工作树 src/server 文件＝批次41 快照 `36b0fe2`（旧），feat 分支非 next 轨＝主线 tip `c2d1e5a`（新），两边从未对齐；merge-base 证实。执行方零越界（只对 next/** 10 文件负责）。**教训入册：整树 add -A 会静默回退主线 src/server（约 1317 行测试），永远只准 next/＋docs/＋根白名单**——commit-worktree 设计本来就对，验收命令也只用临时索引限定路径。②medium 6 个 tmp-* 演示脚本（批次42 期遗留，scripts/ 下不在提交轨）——不入库，留在树里。③low「替掉 console 记账」表述失实——既有记账是 surfaceAggregate 内存环形账（批次45），本批池记账与其**双轨并存**，无害；合并归入 56① 工具契约批顺手处理。④low 四份计划文档在允许清单外＝调度方/前置调研所有，随批入库符合预期。
- 本批工单 §7 前置「工作树干净」表述不准（next/** 干净、全树不干净）——调度方措辞欠账，记自己账上。

## 已知边界

1. 现网 comfy 桥三工具均无 annotations → 全走后缀兜底＋池 warn（comfy_submit 无写后缀判读＝直执行，**批次58 摘 allow 收掉**）；annotations 缺失计数见池。
2. 双轨记账（环形账＋池）暂存，56① 合并。
3. 「外部工具必须声明 annotations」是否升拒装级＝作者点名（调度方建议先记账一个周期）。

## 复现

```bash
cd D:/Pinax-main/Pinax-main && npm run next:build:main && npm run next:build:shell && npm run verify:next
```
