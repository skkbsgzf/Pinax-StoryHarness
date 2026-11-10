# 批次65b 记录：内置 11 块迁装载同路径（Obsidian 框架轮·桩2 第二波）（2026-11-02）

> 执行：Qoder CLI（Qwen3.8-Flash，163 轮/约 83 分钟，退出码 1——收口未竟，调度方补刀后全绿）。工单：[65b](./pinax-electron-next-m2-batch65b-ticket-20261102.md)。

## 交付（以评审与门禁实证为准）

1. **装载路径统一**：boot（main.mjs）与 createNextSession 均经 pluginLoader 从盘上装载内置 11 块；BUILT_IN_CARRIER_PLUGINS 冻结数组退役为随包 id 清单（BUILT_IN_CARRIER_IDS）；carriers/index.mjs 静态 import 全撤。
2. **打包**：载体运行时件拷至 .build/next/carriers/<id>/（带 next/ 层——载体件相对导入按仓库深度写死，落 .build/carriers/ 会让 ../ 爬出产物目录；偏离有据）；bundleAssertions n/n3/n4/n5/n6/o 全链对齐新落点。
3. **双态定位**：新增 PINAX_NEXT_CARRIERS_DIR 显式覆盖口（工单字面的 PINAX_NEXT_ROOT 语义已被「自动打开的项目根」占用）＋装机轨/开发轨候选。
4. **数量断言删除**：acceptance 的载体数量断言退役（J2）；acceptance/d2 计数实维持（21/40/46/44、d2=21——同实现换装载，计数不该变）。
5. 评审三处偏离（环境口/落点/记录缺失）调度方**追认**前两处；记录缺失由本文件补。

## 调度方补刀（65b 收口未竟的真因）

- real-session spec（carrier-pane-real）经 createRequire 拉 index.mjs（jsdom 规避路径），65b 把 NOVEL_*/DOSSIER_* 再导出全撤且 grep 只查静态 import 漏了 createRequire 动态消费者——require(esm) 对缺失命名导出给 undefined 不抛错 → buildProjectDocument(primaryCarrier: undefined) → PRIMARY_CARRIER_MISSING（2 条真会话测试红）。
- 修：index.mjs 补两个字面常量再导出（不引载体本体，零静态 import 纪律不破）——真会话测试 3/3 恢复。

## 已知边界

1. 装机态依赖 .build/next/carriers/ 拷贝规则——vite 配置改名会静默断链（n 系门禁兜着）。
2. PINAX_NEXT_CARRIERS_DIR 为验收/自定安装位覆盖口，未进文档正文（spec v2 附录待补）。

## 复现

cd D:/Pinax-main/Pinax-main 后依次 npm run next:build:main、next:build:shell、next:build:renderer、npm run verify:next。

## §8 调度方验收（Zcode）

- 全量门禁 exit 0（五段全绿）；真实改动 30 文件 +861/−498 零行尾翻转。
- 评审 3 条偏离（PINAX_NEXT_CARRIERS_DIR 环境口／.build/next/carriers/ 落点／验收 harness 跟随）均有技术理由且全链一致——**追认**；记录缺失由调度方代落（本文件）。
- **调度方补刀两笔**：①index.mjs 补 NOVEL_/DOSSIER_CARRIER_ID 字面常量再导出——65b 过度修剪再导出，漏了 createRequire 动态消费者（carrier-pane-real 的 jsdom 规避路径），require(esm) 缺失命名导出给 undefined 不抛错→PRIMARY_CARRIER_MISSING 假红；②n6 断言的装机轨装载补 order 参数（字母序≠随包 id 清单序的假红）＋导入去重。
- 执行方收口未竟（exit 1 空自报）记信用账；装载迁移主体质量可用。
