# 批次53 记录：12 载体迁 @4 ＋ 宿主真消费（Cordis 线B · 协议迁移）（2026-10-31）

> 执行：Qoder CLI（DeepSeek-Flash）。工单源：[执行工单](./pinax-electron-next-m2-batch53-ticket-20261031.md)。
> 不执行 git；不启动/不杀 electron；未改 `server/**`、`src/**`、`C:\` 原稿、`D:\CF2TF`、`D:\toonflow`、`D:\ComfyUI-0.39`；未加 npm 依赖；未改写族/revision/拦截点语义。

## 交付

1. **12 份载体清单全部升 `pinax-carrier@4`（manifestVersion: 4）**：每块 pane 补 `multiplicity`／`scope`（及 keyed 的 `keyField`）与认领四件（`claims`／`priority`／`canOpen`／`takes`），每份清单补 `license: { mode: 'free' }`。`tools/context/entry/services/mcp` 声明值一字未动（comfy allow 维持批次58 态）。
2. **宿主真消费（裁决）**：`next/shell/viewRegistry.mjs` 新增纯函数
   - `normalizeClaimPath` / `matchClaimPath`：项目内相对 glob（`**` 独占一段可零段、`*` 不跨目录）；
   - `resolveResourceClaim(panes, { path, kind })`：claims 命中 → `canOpen` 谓词（缺字段＝不命中）→ `takes`（extension > fallback）→ `priority` 降序 → `paneId` 升序；返回 `winner` 与全部参评者的 `status`／`reason`，测试可断言「谁赢了、别人为什么没赢」。
   `next/shell/useBoardData.mjs` 只做小切口：`claimPanes`／`claimDecision` 状态、`declareClaimPanes` 喂表、`noteClaim` 在九个打开路径（章节／构思／约束／资料／剧本／记录／提案／条目／大纲）记录裁决；裁决是旁路事实，不拦打开。
3. **双中栏 pane 呈现（批次58 实拍缺口）**：`next/shell/AppNext.vue` 按板记住作者选过的 center pane（`centerPaneChoice[boardId]`），一块板声明 ≥2 块中栏 pane 时核心区顶部出切换条（`data-test="center-pane-tabs"`，`role="tab"`／`aria-selected`），点第二块即换 `CenterSlotHost` 的内容面。comic.editor 与 comic.canvas 同板双 pane 由此可切换。样式只新增 `AppNext.vue` 的 scoped 块，全部走已定义 token（未改 `next/shell/styles/next-shell.css`，该文件不在允许清单内）。
4. **清批次44 例外表**：`KIND_OVERRIDES_BY_PANE_ID` 已删除（全仓零命中）；`carrier-v3-rollout.test.mjs` 改为直接断言世界书两块 pane 的 kind（`entries-categories`／`entries-workspace`），并新增等价断言：两块 pane 的槽位、`multiplicity/scope/keyField`、`claims`、`takes`、`canOpen` —— 形态一旦回退先红。
5. **打包断言（守卫 r）**：`next/testing/bundleAssertions.mjs` 新增
   - `r1` 12/12 `spec=pinax-carrier@4`、`manifestVersion=4`、`license` 显式（内置 free）；
   - `r2` 四组字段的清单面：槽语义齐、认领 pane 的 priority／takes／canOpen 合法、keyed 必带 keyField（认领 pane 24、keyed 1，数字变化须写理由）；
   - `r3` adopt 声明完整：走 adopt 的服务必须同时声明 port 与 healthPath（内置全为自起档，adopt=0）。
   `acceptance.mjs` 的批次52 零误拒记录同步改为「批次53 @4 落地：12 份清单 spec=@4」。

## 12 载体 multiplicity／scope 逐份理由表

| 载体 | pane | 槽位 | 槽语义 | 认领 | 理由 |
|---|---|---|---|---|---|
| novel | novel.shelf | left-dock | single／project | 正文/**，p30，fallback | 书架是全项目一份的导航面；只兜底认领，不抢正文。 |
| novel | novel.editor | center | single／entry | 正文/**/*.md，p70，extension，kind∈[chapter,proposal] | 一章一编辑位（key 即当前条目）；extension 接管 markdown 正文，提案审阅仍走同一块。 |
| outline | outline.tree | left-dock | single／project | 大纲/**，p30，fallback | 一个项目一棵大纲树，导航面单份。 |
| outline | outline.editor | center | single／project | 大纲/**，p70，extension，kind=outline | 大纲是项目级单文件（outline.json），不是按条目分文件；extension 接管。 |
| outline | outline.widget | overlay | list／session | —（不认领） | 悬浮小工具窗既有语义就是可多开、随会话记形态；不参与文件归属。 |
| notes | notes.list | left-dock | single／project | 构思/**，p30，fallback | 构思索引全项目一份。 |
| notes | notes.editor | center | single／entry | 构思/**/*.md，p70，extension，kind=note | 一篇构思一个编辑位；按条目路径区分。 |
| worldbook | worldbook.board | left-dock | single／project | 世界书/**，p30，fallback | 类别导航树整栏一份；批次44 形态由本行正面表达（兜底导航）。 |
| worldbook | worldbook.entries | center | keyed／entry，keyField=path | 世界书/**/*.md，p70，extension，kind∈[entry,proposal] | 条目按路径各开各的（keyed＋entry）；extension 接管看板区；批次44 例外表由此转正。 |
| script | script.board | left-dock | single／project | 剧本/**，p30，fallback | 剧本索引全项目一份。 |
| script | script.editor | center | single／entry | 剧本/**/*.md，p70，extension，kind=script | 一集/一场一个编辑位。 |
| setting | setting.board | left-dock | single／project | 约束/**，p30，fallback | 约束索引全项目一份。 |
| setting | setting.rules | center | single／entry | 约束/**/*.md，p70，extension，kind=rule | 一份约束一个编辑位。 |
| reference | reference.board | left-dock | single／project | 资料/**，p30，fallback | 资料索引全项目一份。 |
| reference | reference.documents | center | single／entry | 资料/**/*.md、资料/**/*.txt，p70，extension，kind=document | 一份资料一个阅读位（md／txt 都认领）。 |
| material | material.board | left-dock | single／project | 素材/**，p30，fallback | 记录板是项目级单文档（素材/素材.json）的导航面。 |
| material | material.editor | center | single／entry | 素材/**/*.json，p70，extension，kind=material-record | 按记录文件分编辑位。 |
| material | material.panel | overlay | list／session | —（不认领） | 自带面板的悬浮窗可多开、随会话；不参与文件归属。 |
| comic | comic.board | left-dock | single／project | 漫画/**，p30，fallback | 漫画记录板项目级一份。 |
| comic | comic.editor | center | single／entry | 漫画/**/*.json，p70，extension，kind=comic-record | 记录编辑位按文件区分。 |
| comic | comic.canvas | center | single／project | —（不认领） | 画布是项目级唯一的外部应用面（toonflow :3010），不认领文件；与 comic.editor 同板双 pane，由本批切换条呈现。 |
| video | video.board | left-dock | single／project | 视频/**，p30，fallback | 视频记录板项目级一份。 |
| video | video.editor | center | single／entry | 视频/**/*.json，p70，extension，kind=video-record | 记录编辑位按文件区分。 |
| experience | experience.board | left-dock | single／project | 体验/**，p30，fallback | 体验记录板项目级一份。 |
| experience | experience.editor | center | single／entry | 体验/**/*.json，p70，extension，kind=experience-record | 记录编辑位按文件区分。 |
| online | online.board | left-dock | single／project | 联机/**，p30，fallback | 联机记录板项目级一份。 |
| online | online.editor | center | single／entry | 联机/**/*.json，p70，extension，kind=online-record | 记录编辑位按文件区分。 |

> 统一口径：记录型载体的「板」是项目级导航（single／project，fallback），「编辑位」按条目文件（single／entry，extension）；世界书是唯一需要按路径多开的看板（keyed／entry，keyField=path）；两块 overlay（大纲小窗、素材面板）保留既有多实例语义（list／session），不认领文件。

## 验收

- `npm run next:build:main && npm run next:build:shell`：通过（main 1763.86 kB、shell 2025.38 kB、preload 5.30 kB）。
- `npm run verify:next`：**五段全绿，exit 0**。
  - acceptance：**26/26**（批次53 @4 落地 12/12；既有 40／46 工具面计数不变）。
  - node tests：**600/600**（本批 +6：认领裁决 5 条 ＋ 世界书等价断言 1 条）。
  - vitest shell UI：**187/187**（13 files，本批 +1：双中栏切换条）。
  - eslint：0 error／0 warning。
  - bundleAssertions：全过；r1/r2/r3 齐；主进程 1788.3 kB（< 6 MB）、外壳 2062.8 kB（< 2.5 MB）。
- 守卫：`grep -rn "pinax-carrier@3" next/carriers` 归零；`KIND_OVERRIDES_BY_PANE_ID` 全仓零命中；例外表删除且等价断言在。

## 计数变化与理由

| 位置 | 变化 | 理由 |
|---|---|---|
| node tests | 594 → 600 | +5 认领裁决（glob／takes／canOpen／priority+顺序／未声明不参评）；+1 世界书 pane 等价断言（例外表删除的对价）。 |
| vitest shell UI | 186 → 187 | +1：同载体双 center pane 出切换条并换内容面（批次58 缺口）。 |
| bundleAssertions | +r1／r2／r3 | r1 清单 @4／license；r2 四组字段形状（认领 pane 24／keyed 1）；r3 adopt 声明完整性。q 继续管产物里的读取点。 |
| acceptance | 记录不变（26 条） | 批次52 那条由「@3 零误拒」改写为「@4 落地」，不新增记录。 |
| 工具面计数 | 40／46／23 不变 | 本批不动 tools／mcp 声明。 |

## 偏离（已记录，非静默）

1. **《大梦》project.json 未升 @4（任务 4 未执行）**：主进程项目合同只支持 `pinax-project@3`（`next/kernel/projectSkeleton.mjs:16`，兼容 @1／@2），仓内不存在 `pinax-project@4`。把工作副本改成 @4 会让 `openProject` 判非法 spec、项目打不开；项目合同文件不在本批允许清单内，无法同批新增 @4 读侧。为保证 `D:\Projects\大梦` 仍可打开，**该文件保持 @3 未动**；C 盘原稿与 dameng-px 均未触碰。待后续批次扩项目合同后，再按 §7 工单升 spec/schemaVersion。
2. **`carrier-v3-rollout.test.mjs` 保留原文件名**：内容已改为 @4 验收；重命名会牵动覆盖率口径与历史引用，本批只改断言文本与例外表。
3. **`carrier-v4-manifest.test.mjs` 增加 `downgradeToV3` 夹具**：小说清单已升 @4，`V4_ONLY_FIELDS` 纪律必须用「@3 清单写 @4 字段」验证；夹具只剥新字段，不改原清单。
4. **双中栏切换样式落在 `AppNext.vue` scoped 块**：`next/shell/styles/next-shell.css` 不在允许清单内；scoped 块只用既有 token，visual-contract 全绿。

## limitations

1. 认领裁决目前是**可观测旁路**：`claimDecision` 记录赢家与落选原因，但不拦截／隐藏落选 pane，也不改变既有按 pane id 的打开路径。若后续要让裁决直接决定「打开哪块」，需另开工单接 UI 开合。
2. `noteClaim` 只在九个既有打开路径落点；新增打开路径（未来载体）需同步调用，否则该路径没有裁决记录。
3. 内置 12 载体没有 adopt 服务（全是自起档或空）；r3 只保证「若声明 adopt 则形状合法」，adopt 正身由 `carrier-v4-adopt-supervisor.test.mjs` 与 acceptance 覆盖。
4. `preview.register` 与 `maxKernel` 未有内置载体声明；守卫 r2 只做「若声明则形状合法」，消费归批次55/54。
5. 未运行 git、未起 Electron；无法在真窗口中目视切换条，双中栏切换由挂载级 vitest（jsdom）覆盖。

（§8 由调度方补。）

## §8 调度方验收（Zcode）

- 门禁独立复跑 exit 0（五段全绿）；真实改动 23 文件 +793/−114 零行尾翻转；执行方记录自落盘（新规第二批生效）。
- 评审 4 条裁定：①medium 《大梦》未升 @4＝**工单错误非执行方欠账**——载体清单版本（pinax-carrier@4）与项目清单版本（pinax-project@3）是两条独立版本线，调度方写工单时混为一谈；PROJECT_SPEC=@4 若要做须先动 projectSkeleton/projectManifest 合同（另批），且项目文件只存启用载体 id，本就无需随载体协议版本走。**裁定：大梦维持 @3 为正确状态**，守卫标记「大梦 spec=@4」作废。②low 95 漂移文件三度证实（mtime 10-20 同秒批量落盘）。③low 陈旧索引假删除第三次——workflow 模板评审提示已改为临时索引版命令（本批后生效）。④low 真消费落为旁路记录——**裁定接受为分阶段上线**（先观察后执法）：resolveResourceClaim 可计算可断言，是否拦截/隐藏落选 pane 是产品问题，留作者裁（可随 56① 或 v4.1）。
- 《大梦》完整性复核：正文 digest 173293f8 全天稳定（早前一次 62d5a53b 读数系调度方未 cd 导致 md5sum 输入行含绝对路径的测量伪影，已复测排除）；执行窗口正文零写入；spec=@3 为正确状态。
