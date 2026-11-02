# 批次65b 工单：内置 11 块迁装载同路径（Obsidian 框架轮·桩2 第二波·高风险）（2026-11-02）

> 调度方：Zcode。执行方：Qoder CLI（Qwen3.8-Flash）。前置：批次65a 已收口（`8156271`＋EOF 修 `2fcd87d`，CI 绿）。
> **风险声明（作者知悉）**：本批动 boot 路径＋打包＋验收 harness 三处联动，是整轮最高风险批。**回退路径＝git revert 本批提交即回批次65a 静态装载**，执行方与调度方都按此预案。
> 目标（框架计划 J2）：一切从磁盘装载，内置只是「随包已安装」——加一块载体不再改 9 个文件，门禁里不再有载体数量断言。

## 任务（五条）

1. **载体资产进包**：打包步把 `next/carriers/<id>/`（manifest.mjs／impl.mjs／context.mjs 等运行时件）拷进 `.build/carriers/<id>/`（ui/AGENT.md 的拷贝已有，扩运行时件）；bundleAssertions n 系同步扩断言（运行时件逐一份在包）。
2. **装载路径统一**：主进程 boot 改经 `pluginLoader`——从 `.build/carriers/`（打包态）与 `next/carriers/`（dev 态，按 `PINAX_NEXT_ROOT`/bundle 相对定位，双态定位写一个函数）装载 11 块；`BUILT_IN_CARRIER_PLUGINS` 冻结数组退化为**随包 id 清单**（只列 id 供 doctor/文案，不再 import 实现）；`carriers/index.mjs` 的静态 import 全撤。
3. **验收 harness 跟随**：acceptance 的 in-process 验收改经装载路径（toolCount=40 等计数**保持不变**——同实现换装载方式，计数不该变；变了就是丢东西，逐条查）；d/d2 打包断言改为「装载后列工具」而非「bundle 静态含实现」。
4. **数量断言删除**：`acceptance.mjs` 的 `BUILT_IN_CARRIER_PLUGINS.length===11` 类断言删（J2 判据）；doctor 改从装载实况取数。
5. **回归红线**：12 份清单校验/逐字段消费点/写族闸/拦截点/命令面——批次45–62 全部既有断言**一条不许少**（装载方式变了，行为断言一个不丢）。

## 允许文件

`next/kernel/pluginLoader.mjs`（扩多态定位）、`next/carriers/index.mjs`（重写为 id 清单）、`next/index.mjs`（再导出跟随）、`next/shell/main.mjs`（boot 装载接线）、`next/testing/acceptance.mjs`、`next/testing/bundleAssertions.mjs`（重构断言，逐条写理由）、打包配置（`vite.*.config.mjs` 拷贝规则）、`next/tests/`＋受影响 spec、`docs/plan/` 本工单 §7＋批次记录（执行方落盘）。

## 禁止边界

不改 12 份清单本体与其实现语义；不动协议/写族闸/窗口系统/命令面行为；不改 `server/**`、`src/**`；不加 npm 依赖；**impl 文件格式保持 .mjs 直出**（不打包器转译——loader 动态 import 的是源码形态）；不起 Electron、不执行 git。

## 守卫标记

批次45–65a 全清单继承；本批新守卫：静态 import 载体零命中、装载路径单一函数、随包 id 清单与盘上目录一致断言。

## 验收判据（完成定义）

`npm run next:build:main && npm run next:build:shell && npm run next:build:renderer && npm run verify:next` 五段全绿；`grep -rn "from '../carriers/" next/index.mjs next/shell/main.mjs` 归零（除 id 清单）；真窗口（调度方）竖条 11 块照常。

## 回退预案

git revert 本批 → 回批次65a 静态装载（全绿基线）；`.build/carriers` 拷贝规则随 revert 一并回退。

---

## §7 执行方回填 ／ §8 调度方验收

（批次记录执行方落盘 `docs/plan/pinax-electron-next-m2-batch65b-20261102.md`；§8 调度方补；**遇硬障碍如实停报，不硬推**——批次64 桩纪律沿用。）
