# 批次65a 执行记录：外部声明型插件正式第一波（2026-11-02）

> 工单：[pinax-electron-next-m2-batch65a-ticket-20261102.md](./pinax-electron-next-m2-batch65a-ticket-20261102.md)。执行方：Qoder CLI。
> 一句话：`.pinax/plugins/<id>/manifest.json` 的声明型外部插件已能从盘上随 openProject 装入——**宿主零执行第三方 JS**（带 impl.mjs 的目录整份拒装并有探针实证），竖条可枚举、可停用、可卸载进回收站，doctor 有外部态，acceptance／bundle 各多一条在链上的记账与门禁。

## 1. 交付清单（文件 → 干了什么）

| 文件 | 动作 | 要点 |
|---|---|---|
| `next/kernel/declarativeImpl.mjs` | 新（76 行） | 声明式 impl 工厂＋拒接闸：`gateDeclarativeManifest`（tools/services/mcp/entry/commands 有内容即拒，一条列全所有被拒字段与理由）、`createDeclarativeImpl`（setup 返回空 disposer，满足批次51 效应合同）、`DECLARATIVE_REFUSED_CODE=PINAX_DECLARATIVE_FIELD_REFUSED` |
| `next/kernel/pluginLoader.mjs` | 扩（88→145 行） | 两个装载器并存不混用：`loadCarriersFromDir`（批次64 桩，带 impl.mjs，只在 acceptance/tests 里继续验可行性结论）；`loadDeclarativeFromDir`（本批正式：只收 manifest.json，点目录不扫，impl.mjs 在场＝stage:'form' 拒装，绝不 import）。装机幂等：同 id 同目录 → `alreadyInstalled`，不重装也不脏 `registry.rejected`；同 id 异目录 → 装载器自拒（DUPLICATE 不进注册表长账） |
| `next/project/externalPlugins.mjs` | 新（197 行） | 打开路径入口 `registerExternalPluginsOnOpen`（装载→ledger 判新→自动启用落盘，全程乐观并发）＋ `uninstallExternalPlugin`（先验形态：只动 `.pinax/plugins/` 直下一层；主载体不许卸；registry.uninstall 跑完 dispose 链才把目录移进 `.pinax/plugins/.trash/<UTC时间戳>/<id>`——EEXIST 撞名换后缀重试，永远不真删） |
| `next/project/openProject.mjs` | 接线 | 在 migrateLegacyCarrierIds 之后、`registry.activate` 之前调用装载（外部 pane 随第一次 activate 进竖条）；返回载荷多一个 `external`（loaded/skipped/addedToEnabled/notes）；空货架＝零副作用早退 |
| `next/doctor.mjs` | 扩 | `DOCTOR_STATES` 六态**不动**（doctor.test.mjs:52 深比较守卫）；另表 `EXTERNAL_PLUGIN_STATES=['external-declarative','external-rejected']` ＋ `diagnoseExternalLoads`（复用 result() 骨架；拒装修复文案直接列字段理由，form 态指「删掉 impl.mjs 只留 manifest.json」） |
| `next/testing/fixtures/external-plugins/` | 新（11 份夹具） | 好清单 2（ext.fieldnotes 全字段样例含 settings/agentMd；ext.quotes 最小样例）；字段级拒接 5（tools/services/mcp/entry/commands 各一）；地盘争用 2（clasha/clashb）；坏 JSON 1（ext.broken）；**impl 执行探针 1**（ext.implprobe：清单合法＋impl 一被 import 就把 `globalThis.__pinaxImplProbe` 加一并抛错） |
| `next/tests/external-declarative.test.mjs` | 新（6 用例） | 逐字段拒接、form 拒装且探针恒 0、坏清单只跳过、registry.rejected 零脏账、工厂 impl 的效应合同与卸载回卷、幂等重跑、activate 竖条枚举、闸单测（空数组/null 是合法声明）、DOCTOR_STATES 六态不动＋外部态读数 |
| `next/tests/external-plugins-project.test.mjs` | 新（5 用例） | openProject 全流程（addedToEnabled／落盘 revision+1／ledger／fileService 越界拒写／同 session 重开幂等）、ledger 分得开「新装」与「停用过」（DIR_CONFLICT_NOT_ENABLED 只记账，手动启用撞真闸）、卸载进 .trash 后重开不扫回收站、内置载体与主载体不许走本通道、settings 白名单吃到外部声明（volatile 经 GUI 可写，未声明拒） |
| `next/tests/plugin-loader.test.mjs` | 守卫更新 | pluginLoader 上限 60→150 行（理由写在测试注释：两个装载器共用校验/记账骨架，拆两个文件＝第二份事实源）；新守卫断言 `loadDeclarativeFromDir` 导出与 `stage: 'form'` 在册 |
| `next/testing/acceptance.mjs` | 记账 | 新增「批次65a 外部声明型装载：fixture 装入→竖条可枚举→停用释放」——真走 openProject 主链：装入 3、自动启用 ext.clasha/ext.quotes、拒 ext.implprobe(form)、探针未执行、停用后竖条 3→2、卸载进回收站且效应栈清零。总账 **41/41** |
| `next/testing/bundleAssertions.mjs` | 门禁 w | 「w 批次65a 声明型装载链进产物」：主进程 bundle 带 `PINAX_DECLARATIVE_FIELD_REFUSED`／`declarative-load:`／`external-declarative` 三个标记，工厂/装载器/项目层导出在位，5 份字段级拒接夹具在册。**计数不动**：工具面 44、清单 11 份、M1/M2 各账零变化（外部装载是运行期新增路径，不新增装载期计数），故只查标记 |

## 2. 验证

`npm run verify:next` 五段全绿（2026-11-02，作者机器）：
- acceptance：**41/41 通过**（含本批新记账条）
- node --test `next/tests/*.test.mjs`：**710/710 通过**（本批 +11 用例）
- vitest shell config：**14 文件 / 200 用例全过**
- `lint:next`：`--max-warnings 0` 零告警
- bundleAssertions：a–w 全部通过（新门禁 w 在册）

## 3. 关键裁决与为什么

- **ledger（`.pinax/plugins/ledger.json`）**：启停的唯一真源仍是 project.json 的 `carriers.enabled`，ledger 只回答「是不是新插件」。没有它，作者停用过的外部插件下次打开会被当成新插件重新塞回启用集——停用等于没停。有它，「新装自动启用并落盘」与「停用保持停用」才分得开。落盘写 project.json 走 nextCarriers 乐观并发（与批次16「@1 打开即升代」同先例：结构登记，不是猜默认值）。
- **自动启用按 id 字典序裁决**：readdir 顺序不保证，而「地盘冲突时谁先占上」必须是可复现的答案——与 claims 同一「同样的清单永远得到同样的赢家」纪律。撞地盘的不自动启用（否则 activate 的 DIR_CONFLICT 会把整项目打不开顶出去），只记 `DIR_CONFLICT_NOT_ENABLED` 账，处理冲突后手动启用走原闸。
- **impl.mjs 在场＝整目录拒（stage:'form'），不是静默忽略**：忽略等于告诉作者「放了代码没生效是我心情好」；拒装带理由，红线可解释。探针夹具让「没执行第三方 JS」不是口头保证——一旦被 import，计数与抛错当场露馅（acceptance 与新测试都在读这个探针）。
- **doctor 六态不动、外部态另表**：`DOCTOR_STATES` 有深比较守卫，把外部态硬塞进六态会把守卫改成迁就实现——反向断言的纪律反过来用。
- **卸载没有 IPC 通道**（`ipcContract.mjs` 不在允许清单）：机制与回滚用例完整落在 project 层（`uninstallExternalPlugin`），按钮接线是宿主层一笔小账，交调度方（见 limitations）。

## 4. 记账指标：@4 字段对外部的覆盖矩阵（工单§「记账指标（不进闸）」）

| @4 字段 | 对外部声明型 | 承接方／理由 |
|---|---|---|
| `id/version/title/minKernel/tier` | 开放 | @4 校验器本体（validateCarrierManifest，同一把闸） |
| `primary`（projectKind/defaultPane/contextProfile） | 开放 | 激活与上下文档案，内核既有链路 |
| `dataDirs` | 开放 | fileService 三道闸同权写查（grant 只认 `file:<own dir>:r|rw`，scopes 越界即拒——项目层测试①实证） |
| `contributes.panes` | 开放（宿主八视图词表内 view+kind） | 竖条与开窗走 shellView←registry.list() 自动出现；@4 的 view 必须命中宿主词表，命不中在装清单那步就被 @4 拒 |
| `contributes.settings` | 开放（volatile 闸照旧） | settingsStore 从活注册表现收声明（collectSettingDeclarations），外部节自动进白名单；非 volatile 经 GUI 写仍拒 |
| `license` / `agentMd` | 开放 | @4 校验＋AGENTS 注入链路既有 |
| `context`（providers 须空）/ `scopes` / `capabilities` / `requires` / `preview` / `subscriptions` / `renderers`（custom 除外）/ `minKernel`/`maxKernel` | 随 @4 校验器 | 本批不新增语义：能过 @4 就照装，拒因文案来自校验器 |
| `tools` | **拒** | 工具需要 JS 实现：外部声明型插件没有代码，声明了无人应答 |
| `services` | **拒** | 服务需要宿主起子进程：沙箱未裁 |
| `mcp` | **拒** | 外部 MCP 要起进程或连端点：沙箱未裁 |
| `entry` | **拒** | 自带面板是第三方 HTML：沙箱未裁 |
| `commands` | **拒（本批暂空，工单要求登记理由）** | 声明型命令没有执行路径，声明了不执行即拒——「静默收下不执行」是最坏的合同 |
| `impl.mjs`（非 @4 字段，形态位） | **拒（stage:'form'）** | 宿主不执行第三方 JS；impl 一律由内核声明式工厂生成 |

## 5. limitations（做不到／没做的，如实报）

1. **竖条图标缺省名破图**：@4 归一器对未声明 icon 的 pane 缺省 `'plugin'`（carrierManifest.mjs:609），但 WorkbenchIcon.vue 的在册字形表没有 `'plugin'`（最接近的是 `extensions`＝Puzzle 拼图），缺省会渲染成 FileQuestion 兜底问号。改缺省名或补字形都在禁止清单（协议归一层／`src/**`），本批未动——夹具已显式声明 `"icon": "extensions"`，外部插件作者要显式挑在册图标。建议在 65b 或宿主小批里裁：`pluginLoader` 无关，改一处字表或改一处缺省。
2. **外部 pane 开窗为空态**：CarrierPaneHost 不认识外部插件的 dataDirs，panes 出现在竖条并可开、但内容区暂无渲染（宿主 shell 其余文件不在允许清单，AppNext.vue 无需动）。开窗接线交调度方。
3. **卸载无 UI/IPC 按钮**：机制＋测试完整（project 层），`ipcContract.mjs` 不在允许清单，通道与按钮接线交调度方。
4. **真窗口实拍验收归调度方**（工单完成定义写明接管）；本批未起 Electron、未执行 git、未动 `server/**`、`src/**`、协议 schema、写族闸语义、内置 11 块装载方式。
5. **同秒双卸载**靠时间戳后缀重试兜底（≤60 次），极端并发下仍可能撞名报 `IO_FAILED`——「卸载已生效但目录没进回收站」，此时注册表已干净、目录还在原位，重跑一次即可；未上文件锁（锁的归属层不在本批允许清单）。

## 6. 下一批（65b）接手时要紧的事

- 内置 11 块迁同路径时，装载器不许再长第三份骨架——`loadCarriersFromDir` 的桩语义（带 impl）届时要么收编要么退役，判定权在调度方。
- `registry.rejected` 是长账（每次 activate 重读）：65b 若改装载入口，保持「同 id 同目录＝alreadyInstalled」这条幂等语义，否则验收 41/41 里的重开幂等条会红。
- 沙箱裁定落地（tools/services/mcp/entry 开闸）时，`DECLARATIVE_REFUSED_FIELDS` 是唯一写入口——把对应行删掉即开闸，拒接闸测试（逐字段 5 条）会同步变红提醒补新语义。

## §8 调度方验收（Zcode）

- 门禁独立复跑 exit 0（五段全绿）；执行方记录自落盘。
- 评审 2 条：①low 守卫 60→150 行放宽（测试注释与记录均写明，追认）；②low **真边界 bug**——ledger 修剪把「本次拒装但目录还在」的插件误剪，停用过的插件坏清单再修好会被当新装自动启用，击穿「停用保持停用」立账。**调度方补刀修正**（prune 只剪盘上目录已消失的 id，保留拒装在场的）＋补 ⑥ 测试（坏清单→拒装不剪账→修好重开仍不自动启用；初版测试抓到补刀自身的条件反写，已复测 6/6 双版本过）。
- 外部声明型矩阵落账：开放 dataDirs/panes(宿主视图)/settings/license/agentMd；拒 tools/services/mcp/entry（沙箱未裁）。
