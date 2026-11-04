# 批次77-R1b 执行记录（2026-11-04）

> 工单：[批次77-R1b 工单](./pinax-electron-next-m2-batch77r1b-ticket-20261103.md)｜规格：[批次77 工单](./pinax-electron-next-m2-batch77-ticket-20261103.md)
> 执行方：Qoder CLI（工单指定的实现工程师）。**未 commit、未执行 git 命令、未启动／未杀 Electron 进程。**

## §7 执行方回填

### §7-0 结论

`npm run verify:next` 官方命令**原样跑到 exit 0**（五段全绿：acceptance 44/44 · node --test 805/805 · vitest 232/232 · eslint 0 问题 · 打包门禁全过）。四条任务全部落地，任务1 的「合一」做完了（旧 slash 状态块与并行 `@` 弹层已删净），任务2 把 R1 死掉时留下的 75 条红恢复到全绿并补齐批次77 任务3 的四条验收条款，任务3 照批次77 任务5 全文执行完（domain 四类／`.pinax/skills.json` 项目内启停／导入逐条列原因／守卫⑪ 有用例）。做不到的条目集中在 §7-6，界面实拍按工单口径交调度方（我不启动 Electron，见限制）。

### §7-1 任务1：两套键盘逻辑合一（结构对照）

工单口径是「**一个** typeahead 吃三类」，判定／组菜单／回填三件事全在纯模块 `next/shell/composerTypeahead.mjs`，`AssistantDialog.vue` 只摆菜单并分派按键（与任务4 的时间线同一口径）。

**合一前**（批次77 原状态＋R1 半成品，工单点名的 `AssistantDialog.vue:135-169` 那一块）：

| 面 | 旧 `／` 命令块 | 旧 `＠` 弹层块 |
| --- | --- | --- |
| 状态 | `slashCommands`／`slashOpen`／`slashIndex`／`slashClosed` | `refOpen`／`refQuery`／`refIndex`／`referenceGroups` |
| token 判定 | 组件里 `draft.startsWith('/')` 一类的就地判断 | 组件里 `lastIndexOf('@')` 取段（**DeepWrite 已知坑**：中文正文中段的 `@` 也算） |
| 菜单构建 | `SLASH_COMMANDS.filter(...)` 一份 | `referenceGroups` 另一份（按 kind 分组） |
| 键位 | ↑↓／Enter／Esc 自己一套，**没有 Tab** | ↑↓／Enter／Esc 再一套，`Tab` 只在另一边有 |
| 落点 | 选中即填模板 | 选中即插 `@《标题》` |
| 第三类 `＃` | 不存在 | 不存在 |

**合一后**（现值，`AssistantDialog.vue:148-235`）：

| 面 | 现在只有一份 |
| --- | --- |
| 状态 | `composerToken`／`menuClosed`／`menuIndex`（＋草稿 `draft`）三格，共四样，两块并行状态全部删净 |
| token 判定 | `detectComposerToken(draft, caret)`——按**光标前**那一段取，触发符必须站在**行首或空白后**（`hasLeadingBoundary`），段里再出现第二个触发符就不算 |
| 菜单构建 | `buildComposerMenu({ trigger, query, commands, skills, references, roles, … })` 一次出 `{ groups, items, empty }`；`items` 是键盘那条扁平序列，顺序＝屏上顺序（同源，不存在两套次序） |
| 三类触发符 | `／` 命令＋技能（技能按 `kind` 分「技能」「风格」两组）、`＠` 素材（按 `REFERENCE_KIND_ORDER` 既有词表分组）、`＃` 工作流角色（产出方＝批次78，本批恒空 → 只出那一句「暂无」，**没有第 N+1 枚点不动的死钮**） |
| 键位 | `onKeydown` 一处分派：菜单开着 ↑↓ 移动、Enter 选中、Tab 补全、Esc 关菜单；菜单不在（或只有空态行）时 Enter 才发送、Shift+Enter 换行。`isComposing` ＋ `keyCode === 229` 双兜底保持（照老前端 8 处同一口径，不发明） |
| 回填 | `applyComposerToken(draft, token, value)` 纯字符串活，把 `[start, end)` 那段换成 token 文本并交回新光标位；**尾随空白已有就不补空格**（补了作者得回头删） |
| 菜单头 | `AssistantDialog.vue:824` 一行教键位：「↑↓ 移动 · Enter 选中 · Tab 补全 · Esc 关闭」 |
| 停止钮 | 保持：`emit('stop')` → `runtimeAskAbort`（带 `askId`），回执 `stopped` 落成消息 `status:'stopped'` |
| Esc 让位 | `props.suspendEsc` 为真时先归统一二级页（照 `FloatingWidget` 既有口径），这一条没被合一冲掉 |

命令那一类**保留** `pendingCommand`：老口径是「模板填进草稿、命令词不留在草稿里、路由靠 `pendingCommand` 带过去」，这不是第二套键盘逻辑，是命令的落点本来就不是插文本（工单没要求改它，改了就动 `RuntimeDock` 的命令路由）。

### §7-2 任务2：既有用例恢复绿＋批次77 任务3 验收条款落点

R1 死掉时的红（75 条，`shell-ui.spec` 为主＋`carrier-pane` 两条）已全清：vitest 现值 **232/232（15 文件）**，其中既有 217 条一字未改断言地恢复（`carrier-pane` 那两条红源自半成品 `AssistantDialog.vue` 的悬空引用，改的是组件不是用例）。

四条验收条款（工单原话 → 用例）：

- 「typeahead 三类各一条命中用例」→ `next/tests/shell-ui.spec.mjs:1115`（`／` 出命令与技能、`＠` 出素材、`＃` 出那句「暂无」，同一条还钉菜单头的键位教学）；纯函数侧 `next/tests/composer-typeahead.test.mjs:63`／`:82`。
- 「一条『中文正文不误触』负断言（输入『第3/章』不出菜单）」→ `next/tests/shell-ui.spec.mjs:1157`（守卫⑧，DOM 层：打完 `第3/章` 后 `[data-test="composer-menu"]` 不存在）＋ `composer-typeahead.test.mjs:30`（判定层，含 `@`／`#` 与行首、空白后为正例）。
- 「技能项点击后草稿里是 `／技能名` 文本且 `payload.skill` 未被前端硬塞」→ `next/tests/shell-ui.spec.mjs:1189`：正钉点击后 `draft === '/chapter-rewrite '`、发送时由 `extractSkillToken` 抽出当载荷的 `skill`；**反向钉**「一句没有 token 的话，载荷里根本不出现 `skill` 这一格」，前端不代作者选方法。
- 「停止钮一条用例证明 `status:'stopped'` 能落进会话」→ `next/tests/shell-ui.spec.mjs:1237`（发的是 `runtimeAskAbort`＋`askId`；屏上那格 `data-status="stopped"`，且 store 里那条的真值也是 `stopped`——重开窗口还在）。「blocked 档可点并被会话事件记下」→ `:1277`（`modeEvents === ['review→blocked']`，提问载荷带 `writeMode:'blocked'`）。

运行器侧配套（批次77 任务3 第 3 条的「收了手不许冒充结构化产出」）在 `next/tests/ask-abort.test.mjs`：`stopped` 那条回值带 `stopped:true`、`result:null`，第一轮都没跑完的停止说清「模型一个字都没说」。

### §7-3 任务3：技能库设置面＋`domain` 字段（批次77 任务5 全文）

四条子任务逐条落地：

1. **`next/shell/settings/SkillsSection.vue`（新）** 进既有设置目录与搜索：注册点在 `next/shell/SettingsModal.vue` 的 `builtInSections`，关键词表含「技能／技能库／启停／导入技能／方法说明书／适用任务域／正文写作／编剧／世界书整理／审阅验收／未分域／风格」——批次76 任务4-2 的「左目录与右栏同进同退」口径原样沿用。每条技能四格都在：**装载状态**（生效／停用两列分组，另有「装不上」逐条列表）、**启停**、**查看正文**（点开才发 `skillsBody`，收起不再请求——渐进披露那道闸）、**适用任务域**（中文 chip）。
2. **`domain` 进 frontmatter**：词表 `SKILL_DOMAINS = ['screenwriting','prose','worldbook','acceptance']`，中文说法 `编剧／正文写作／世界书整理／审阅验收`（`next/skills/loadSkills.mjs:25-33`）；校验加在 `parseSkillMarkdown`（`:126`，顺序 name → 目录名一致 → description → tools → output → **domain → kind** → body），**缺字段不报错**、归「未分域」（`SKILL_UNDOMAINED_LABEL`），非法值才报 `SKILL_DOMAIN_INVALID`，且那句话说清四档词表值＋中文＋「不写这一行就是未分域」。「风格」落在 `kind: style`（`SKILL_KINDS = ['style']`，中文「风格」），非法值报 `SKILL_KIND_INVALID`；`／` 菜单把 `kind==='style'` 的包**单列一组**（`composerTypeahead.mjs:143-147`，按方法选和按口吻选是两件事）。内置五包各补 `domain`：`chapter-rewrite`／`outline-restructure`／`scene-expand` → `prose`，`continuity-check` → `acceptance`，`worldbook-refactor` → `worldbook`（正文一字未动）。
3. **启停真值存项目内 `.pinax/skills.json`**：`createFileSkillPreferencesStore`（`:445`）照 `carrierOverridesStore.mjs` 的纪律——坏档不崩不覆盖（按「全部启用」继续并记账）、`.tmp` ＋同目录 rename、内容没变不重写（`skipped`）、fs 可注入；**不写全局偏好**（换项目不该带走上一本书的开关）。关掉＝装载清单剔除（`enabledSkillList`，`:423`）**并在 `runnerAdvisor` 的渐进披露提示里消失**：`disabledSkillNamesOf(sources)` 从 `sources.view.root ?? sources.fileService.root` 取根、每一问现读那份启停表，再 `enabledSkillList(surfaceCatalog, disabled)` 交给 `skillCatalogLines`。用例＝判据3（`next/tests/skills-settings.test.mjs:242`：真写 `.pinax/skills.json` 后，拼出来的系统提示 `doesNotMatch /continuity-check/`）。
4. **导入＝拷进 `.pinax/skills/` 后跑一遍校验，不合格逐条列原因**：`importSkillDirectory`（`:528`）带 `safeSkillDirName` 闸（不许 `..`／绝对路径），逐条 `parseSkillMarkdown`，回来的形状是 `{ imported:[…], rejected:[{dir,code,message}] }`，屏上「拷进来了 N 条」与逐条原因各占一块（`skills-imported`／`skills-import-rejected`）。**导出本批不做**（工单明载，记边界）。

**四条验收判据 → 用例**（`next/tests/skills-settings.test.mjs`，21 条 node:test）：

- 「缺 `domain` 仍能装载并进未分域」→ `:69`。
- 「非法 `domain` 报明确原因」→ `:83`（并把「不写会怎样」写进那句话）；`:96` 钉四域中文与 `kind` 词表今天只有「风格」；`:102` 钉随包五份都补齐 `domain` 且都在词表内。
- 「关掉技能后系统提示清单里不再有它」→ `:242`（判据3）。
- 「工具不在面上整包拒装时，设置面能看到原因」→ `:268`（服务层：`rejected` 逐条带 `code`／`originLabel`／`message`，不是空态）＋ `:328`（连「看正文」都要给同一句原因，不许只回「没有这个技能」）＋ `next/tests/skills-section.spec.mjs:91`（守卫⑪ 的 DOM 版：拒装条目上屏且 `[data-test="skills-empty"]` 不存在）。

其余在册：装载两层目录（随包 ＋ `.pinax/skills/`，同名**随包赢**并记 `SKILL_NAME_DUPLICATE`，`:168`；没有 `.pinax/skills/` 是常态 → 标 `exists:false` 不记成拒装，`:186`）；`row` 永不含 `body`（渐进披露）；工具面未装配时说实话（`surface.note`，`:290`／spec `:106`）；没有项目根四条都如实报缺、不写一个字节（`:299`）；通道四条都在 `IPC_CHANNELS` 里，preload 白名单是 `new Set(Object.values(IPC_CHANNELS))`，因此**自动放行、不用改第二份表**（`:399`）；未接线只报缺不读写文件（`:405`）。界面侧 `next/tests/skills-section.spec.mjs` 9 条（组件直挂，不经 AppNext）。

### §7-4 门禁读数（只增不减，逐段现跑）

| 段 | 基线（批次77 §7-4） | 现值 | 判定 |
| --- | --- | --- | --- |
| `node next/testing/acceptance.mjs` | 44/44 | **44/44** | 持平 |
| `node --test "next/tests/*.test.mjs"` | 748 → 批次77 收口 763 | **805（0 失败）** | ＋42：本批 ＋21（`skills-settings.test.mjs` 新建，21 条），其余 ＋21 属 R1 已落件（`composer-typeahead.test.mjs` 9 条 ＋ `ask-abort`／`command-face` 的新增）与并发批次；**本批无删项** |
| vitest（`next/vitest.next.shell.config.mjs`） | 206（14 文件）→ 批次77 收口 217 | **232（15 文件）** | ＋15：本批 ＋9（`skills-section.spec.mjs` 新建），其余 ＋6 属 R1 半成品／并发批次落在既有文件里的新增；既有用例一条未删、一条断言未改（读数无减项） |
| `npm run lint:next` | 0 问题 | **0 问题**（`--max-warnings 0`） | 持平 |
| 打包门禁（bundleAssertions） | 全过 | **全过**（`f 渲染层依赖薄`／`m2 装机轨技能零拒装 5/5` 两条都在绿列） | 持平 |
| 外壳 bundle | 1991.6 kB | **2015.5 kB** | ＋23.9 kB（记账，非闸；含并发批次那部分） |
| renderer js | 1224.9 kB | **1257.7 kB** | ＋32.8 kB（记账；体积线沿用既有 <2.5 MB 口径，**未新增数值线**） |

| 主进程 bundle | 1680.8 kB | **1684.8 kB** | ＋4 kB（记账，既有 <6 MB 线未动） |

官方命令本轮**原样跑到 exit 0**（缺省 pool；写完全套文档后复跑一次确认，读数与上表一致：44/44 · 805/805 · 232/232 · eslint 0 · 打包全过）。空间见底时的取读数手段仍保留：`NODE_OPTIONS=--max-old-space-size=2048 npx vitest run --config next/vitest.next.shell.config.mjs --pool=forks --poolOptions.forks.singleFork=true`，两种跑法读数一致（本批 232 先按单进程跑过，再随官方命令复跑）。

### §7-5 越界续表（补登记，照批次77 工单 §补登记 格式）

- `next/runtime/mcpSurface.mjs`——**批次77 允许文件未含此件**。改动两处：① `loadSkills({ dir, availableTools, projectRoot: root })` 多传 `projectRoot`（不传，装载层就看不见 `.pinax/skills/` 那层，也读不到启停表，任务5 第 3 条的「关掉＝清单里剔除」在运行时面上不成立）；② `surface.skills` 多投影两份：`catalog`（带 `domain`／`domainLabel`／`kind`／`origin`，`／` 菜单与风格单列那组要吃它）与 `disabled`（设置面要列得出「已停用」那一列）。**没动**的：形态词表、工具面组装顺序、`pinax_skill_read` 的在册方式。这里不长任何判定——domain 中文、启停真值、拒装原因全在 `loadSkills.mjs` 一份，这一层只做投影。
- `next/shell/main.mjs`——原列表写的是「**仅 usage／abort 两段透传**」，本次追加**第三段：`skillsService` 接线**（`createSkillsService({ getRoot: () => session?.projectRoot ?? null, getAvailableTools: () => session?.runtime?.listTools?.() ?? [] })`，交进 `createIpcDispatcher`）。理由：**fs 只能在主进程**。`ipcContract.mjs` 是渲染层与主进程**共用**的那份通道表（`vite.next.renderer.config.mjs` 是纯浏览器构建，没有 `build.ssr`），它一旦静态 import 带 `node:fs` 的 `loadSkills.mjs`，渲染层 bundle 就出现 `__vite-browser-external`，门禁 needle `f 渲染层依赖薄` 当场红。所以四条 `skills:*` 通道在 `ipcContract.mjs` 里只做**转发**，真能力由 main 注入 provider——这与既有的 `settingsStoreFor`／`carrierOverridesFor`／`outlineImport` 完全同构。**不注入的是接线，不是功能。**
- `next/skills/loadSkills.mjs`（在允许列表内，但登记一句「为什么服务落在原文件而不是新模块」）——`createSkillsService`（`:629`）是任务5 四件事（列／启停／正文／导入）的服务形状，与 `parseSkillMarkdown`、`loadSkills`、`createFileSkillPreferencesStore`、`importSkillDirectory` 同属装载层；拆成新模块等于把「屏上说的」和「模型看得见的清单」分成两处写，正是任务5 第 3 条要避免的那种各说一套。
- `next/tests/carrier-records.test.mjs`／`next/tests/carrier-v3-rollout.test.mjs`——**不是本批改的**，在此留名以免读数被误记：本轮跑门禁时这两条一度为红，原因是并发批次在 `next/carriers/comic/manifest.mjs` 新增第 4 块 center pane `comic.comfyui`（`pinax.view.app`，`:8188`），两条 spec 的「只有漫画那一栏带应用面」断言随之要更新；那两文件在其间被**对方**改绿（mtime 01:27／01:29，本会话全程未写 `next/carriers/**` 与这两份 spec）。工单「测试是规格不是被改对象」的纪律对我自己同样有效，此处如实分账。

未越界的说明（写清「为什么没动它们」）：`next/shell/AppNext.vue` 不在允许文件内，所以设置节的注册点落在工单明载的 `SettingsModal.vue`（「目录注册一节」）；为不冲掉 `shell-ui.spec` 钉着的节序，新节选 `group: '技能'` 且插在 `props.sections` 之后，落点 index ≥ 8，既有的 `tabs.slice(0,8)`／`labels.slice(0,3)` 断言一字未动。`next/runtime/agentRuntime.mjs` 未改——`ask()` 早就把 runner 返回值摊进 `value`，技能启停读值不需要经过它。

### §7-6 未做／未验证（limitations）

1. **没有真机实拍**：工单边界写明「不启动／不杀 Electron 进程」，任务1／任务2／任务3 都属界面变化，批次77 的验收口径本就是「实拍交调度方」。上面所有断言来自 jsdom ＋真 DOM 结构与 node:test 直测纯函数，**不是像素级确认**：`／` 菜单三类混排的行距、已停用那一列的 chip 密度、正文 `<pre>` 那块的滚动高度在真窗口里是否偏挤，都没拍过。
2. **`／` 菜单所读的那份快照会滞后一拍**：菜单里的技能来自运行时面 `surface.skills.catalog`，那是项目打开／runtime 装配时算的；启停改的是盘上 `.pinax/skills.json`。**真生效走两处同一谓词 `enabledSkillList`**——提示词侧每一问现读（即时正确，判据3 用例钉的就是这条），装载侧重开项目即对。唯一残留是「刚点完停用，`／` 菜单里那条还挂着」，要消掉它得 `session.refresh()`（retire runtime ＋重启 services），代价大于这一格菜单，我没做。口径如实登记，不当已闭环。
3. **导入没接系统目录对话框**：接它要动 `next/shell/main.mjs` 的选目录白名单（`PICK_DIR_TITLES` 那一族），批次77／R1b 都没登记。现在是一格路径输入框，屏上那句话已写明原因（`SkillsSection.vue` 导入块），limitations 再记一次。
4. **导出本批不做**（任务5 第 4 条明载「记边界」）。
5. **随包没有 `screenwriting` 域的技能包**：词表四域齐、中文齐、校验齐，但今天五份内置包落在 `prose`／`acceptance`／`worldbook`，屏上「编剧」那一组是空的。空的原因是**没有包**，不是没做——补包属内容工作，不在工单里。
6. **`upstream fetch 中途掐断`未做**（批次77 任务3 第 3 条明载本批不做）：停止是「在跑的那一轮结束后不再续轮」，不是掐流。
7. **`subagent`／`workflow-step` 的产生逻辑归批次78**（禁止边界）：`＃` 工作流角色菜单今天只有那一句「暂无」空态，`TRAIL_STAGES` 的扩段是批次77 已落地的渲染面，本批没往里塞假事件。
8. **任务6 未做**（工单：真分支／消息树／`‹2/3›` 切换器归 R2）。
9. **未 commit**（作者纪律 ＋工单明令）。
10. **AGENTS.md 硬规则表要求的 `ui-style-check` skill 在本机可用 skill 列表里不存在**；我按既有口径自行核对（全部颜色走老前端 token、字号走 `--nx-fs-*`、控件走 `control-secondary`／`control-primary`／`control-quiet`、行结构照 `prefs-grid`／`prefs-row`），并由 `next/tests/visual-contract.test.mjs` 的机器判据把关。本轮该门禁抓到一处真问题：启停钮原本写的是 `:class="row.enabled ? 'control-secondary' : 'control-primary'"`，**动态三元 class 不在共享控件词汇里**（机器判据只认静态 `class=`），已改成 `v-if`／`v-else` 两枚静态档、`data-test` 与 `data-enabled` 语义一字未动——判据没被放宽，是代码服从判据。
11. 本机 vitest 官方 pool 在 commit 空间见底时会 `JavaScript heap out of memory`（批次77 §7-4 已入账的间歇态）；本轮官方命令跑到 exit 0，forks 取数法作为备份口径继续留着。

### §7-7 记账指标（不进闸）

`／` 菜单一次出三组（命令／技能／风格）与滚不滚：随包五包时 `／` 一个 query 为空即出 5 条技能＋若干命令，未触发滚动阈值（既有 `COMPOSER_PER_GROUP_LIMIT = 8` 是排版截断，**不是新设数值闸**）。设置页技能节挂载即 `skillsList` 一次请求、启停两次（回执 ＋ 重扫），正文首次点开才发第三个请求。技能清单进提示词的长度：宽项目 5 行（每行「名字＋一句话＋产物」，`domain` 不进提示词，用例 `skills-settings.test.mjs:253` 钉着）。token chip 覆盖率仍未统计（同批次77 §7-5）。
