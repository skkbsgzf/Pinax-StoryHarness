# 批次68-R1 执行记录：UX 归一——字体单轨、字号收敛、文案去行话

> 工单：[pinax-electron-next-m2-batch68r1-ticket-20261107.md](./pinax-electron-next-m2-batch68r1-ticket-20261107.md)
> 执行方：Qoder CLI（Qwen3.8-Flash）。调度方：Zcode。日期：2026-11-07。
> 本档兼作工单任务 1 要求的 **DESIGN 决策表**（动手之前先落盘）与 §7 执行方回填。

## §1 字体单轨制决策表（任务 1，先表后改）

三族各自的**唯一使用面**。判据不是「好看」，是「一个族只回答一个问题」：
interface 回答「这是软件」，display 回答「这是作品」，mono 回答「这是代码」。

| 族 | 只管这些面 | 落点（选择器／文件） | 改前 | 改后 |
|---|---|---|---|---|
| `--font-display`（霞鹜文楷，自托管） | **只有**正文阅读面与编辑面、世界书条目正文 | next-shell.css `.editor-area`（novel 编辑态 textarea） | `--font-writing`（Menlo／Consolas／Monaco＝**等宽**，与「文楷」承诺相反） | `--font-display` |
| | | `.doc-reading`（正文／构思／大纲／约束四面阅读态） | `--font-writing` | `--font-display` |
| | | `.doc-title`、`.doc-field`（文档标题与文档内字段；`input.doc-title` 继承同族） | `--font-writing` | `--font-display` |
| | | `.entry-text`（世界书条目正文，其阅读态 `.nx-rendered-md` 由它带基础度量） | `--font-body`（系统栈） | `--font-display` |
| | | `.nx-writing-text`（生成结果正文） | `--font-writing` | `--font-display` |
| `--font-interface`（系统 UI 栈） | 一切 UI chrome：窗 chrome／页签／按钮／表单／时间线／抽屉／弹窗标题／保存 chip | `.next-shell`（根） | 已是 interface | 不变 |
| | | `.nx-titlebar-brand` | `--font-display`（chrome 上长了作品字） | `--font-interface` |
| | | `.settings-panel-heading` | `--font-display` | `--font-interface` |
| | | `WorkbenchModal .workbench-modal-title` | `--font-display` | `--font-interface` |
| | | `CarrierPaneHost / CarrierSettingsGeneric .nx-save-chip-state` | `--font-display` | `--font-interface` |
| | | `.nx-tools-name-text`（快捷词取名那一栏） | `--font-writing`（等宽） | `--font-interface` |
| | | `.nx-row`、`.nx-field`（两个 primitive） | `--font-sans`（= interface，但与壳层刻度断链的写法） | `--font-interface`（指名，读数只留一条口径） |
| | | 索引窗左栏 `.workspace-nav-*`（**Arial 漏**） | 老轨 `src/styles/workspace-navigation.css` 的 `var(--font-sans)`＋15/14/12px 硬编码 | next-shell.css 末尾追加**同特异性后置规则**，把族与字号改指壳层 token（`src/**` 不许动，只能在壳层作用面清） |
| `--font-mono` | **只有**真正的代码上下文 | `.nx-rendered-md kbd`、`.nx-rendered-md pre>code`、`CarrierPaneHost :deep(code)`、`AssistantDialog :deep(code)` | mono | 不变 |
| | | `HistorySection .history-diff-line`（版本差异逐行） | mono | 不变 |
| | | `.nx-writing-preview-text`（送给模型的原始 prompt＝代码件） | mono | 不变 |
| | | 工具面折叠层那 46 行裸工具 id | **mono 主读数** | 降为次要行／title，主读数改 interface 族＋`--text-secondary`；无中文名的写「未命名工具」，不编造 |

### 不在表内、明确不动的（越界即违规）
- `next/shell/exportService.mjs:97` 的 `font-family:"PingFang SC","Microsoft YaHei",serif` —— 那是**导出 HTML 的自带样式**（脱离本软件的另一份文档），不是壳层 UI，保留并进门禁白名单。
- `--font-writing` 这个 token 本身（`src/styles/main.css`）不许动：`next/testing/bundleAssertions.mjs` 的 h 判据要在产物里查到它，且它的定义在老轨、归调度方所有。本批改的是**引用面**，不是定义面。
- 字号偏好通道 `--writing-font-size／--writing-line-height` 保留：阅读体验的档位属「正文面」，工单禁止边界。

## §2 字号五档归位（任务 2）

只留 `--nx-fs-2xs/md/lg/xl/2xl`（11/13/15/17/19）。并档规则一次定死，逐处照表执行：

| 改前 | 改后 | 理由 |
|---|---|---|
| `--fs-base`（14，老轨） | `--nx-fs-md`（13） | 双刻度并存是根因；14 并入 13 这一档，UI 正文只留一档 |
| `--fs-sm`（12，老轨） | `--nx-fs-md`（13） | 12/13 之间散档并档（同一信息密度只许一档） |
| 裸 `11px` | `--nx-fs-2xs` | 角注／meta 专用档 |
| 裸 `12px`（时间、agent-list） | `--nx-fs-2xs` | 都是 meta 语义，归同一档 |
| 裸 `13px` | `--nx-fs-md` | 面板正文 |
| 裸 `14px`（model 名、根 font） | `--nx-fs-md` | 与 13 同密度，并档 |
| 裸 `15px`（问答正文、输入框） | `--nx-fs-lg` | 会话正文档 |
| 裸 `21px`（intro h3） | `--nx-fs-2xl`（19） | 页面主标题档 |
| `font-size: .88em`（pre）／`.92em`（table） | `--nx-fs-md` | 相对值＝第 6、7 档的来源，改绝对档 |
| 未样式化 mdRender 节点（h1–h6、inline code）＝浏览器缺省 22.5/30/13.33px | 显式档位：h1=`2xl`、h2=`xl`、h3–h6=`lg`/`md` 递减；inline code=`md` | 「补显式档位」是工单原文；缺省漏不是刻度 |
| `font:` 简写里的 px | 拆成 `font-family`/`font-size`/`line-height` 三行 | `var()` 进简写在部分解析路径不可靠，且拆行后门禁能逐条数 |

## §3 文案去行话词表（任务 3）

出屏铁律：不出现批次号／排线计划；不出现工程词；解释文字主语＝作者动作或事实。

| 行话词 | 出屏处 | 改为 |
|---|---|---|
| 「（批次77 留位，批次78 接子代理时一并接）」 | ConversationTimeline 思维链备注 | 「这一轮没有思维链文本，只记录了运行过程。」 |
| 「清单声明／工程覆盖」（地址来源） | AppNext `APP_URL_SOURCE_WORDS` → StatusBar tooltip、页签 tooltip、右键菜单 | 「插件自带的地址／本机改过的地址」 |
| 「工程覆盖」（IPC 失败文案） | ipcContract 三条 fail | 以事实为主语：「这一项本机改动读不出来…」「要先打开一个项目，才看得到它的本机改动」「拿不到当前项目里那份本机改动（.pinax/carrier-overrides.json）」 |
| 「批次78 才生成」 | composerTypeahead `#` 触发的空态 | 「这个项目还没有可引用的角色（在正文里写「角色：」那一类内容后这里就有）」 |
| 「批次77 未登记」 | SkillsSection 目录未接 | 「这一格还没接上系统的选目录对话框，先手工粘一个绝对路径。」 |
| 「清单声明／工程覆盖」（设置页来源层徽标） | CarrierSettingsGeneric `sourceLabel`（值来自 `next/carrierOverridesStore.mjs`，**不许动**） | 显示层转写表 `sourceVocabulary.mjs`，认 `source` 标识不认中文 label：stored→「项目里存过的值」、override→「本机改过的值」、manifest→「插件自带的默认值」、section→「随分组走」 |
| 「清单里没有这一条」 | agentReferences 参考块取不到的标注 | 「项目里还没有这一条（可能已删除，或那一栏还没打开过）」 |
| 「上游／usage」类专业口径 | AssistantDialog 用量 chip 与它的 title | 「这一轮没有用量」「这一轮模型给出的用量」「这一轮没有给出用量」 |

对照表（前后逐行）见 §7。

## §4 门禁同步（任务 4）

visual-contract 新增三条判据（门禁⑭⑮⑯），既有的①–⑬与 8 条样式门禁零放宽——只加不减，一条没松：

1. **门禁⑭ 字号单轨**：`next/shell/**` 的样式里 ① 不得出现 `var(--fs-sm)`／`var(--fs-base)` 老轨引用，② 不得出现裸 px 字号（`font:` 简写里的也算），③ 不得出现相对字号 `.88em`／`.92em` 那一类。
   两点实现细节写死在判据里：`var(--nx-fs-2xs, 11px)` 这种**带兜底值的 token 引用不算裸 px**（先摘掉 `var()` 的参数再找数），唯一白名单是 `exportService.mjs` 的导出 HTML 自带样式。
   另加正向断言：五档 token 必须真的在布局层被引用（刻度定义成摆设也算红）。
   与既有「字号与圆角走刻度」那条（第 293 行起）的关系：老那条仍按注释里的 `legacy-copied` 整块跳过（不放宽也不动它），**新门禁⑭ 不认这个标记**——被标记豁免的会话样式块从此也被字号这条管着（该块内已全量归位，圆角仍走老版度量，见块内注释）。
2. **门禁⑮ 文案词表**：`next/shell/**` 的 `.vue/.mjs/.css` 源码**剥掉三类注释后**（JS 块注释、行注释、`<!-- -->`；行注释只在行首或前置空白时剥，避免把 `http://…` 剥掉半句造成假绿），不得含「批次\d+」「清单声明」「工程覆盖」「承载位」「写族闸」。正向钉两处实锤已换成作者语言；存储层 `next/carrierOverridesStore.mjs` 的真值与 `acceptance.mjs` 的读数不在扫描面内（显示层转写见 `sourceVocabulary.mjs`，它认的是 `source` 标识，不是中文 label，所以不需要在词表上开口子）。
3. **门禁⑯ 三族使用面**：读 `.vue/.css` 的 font-family／font 声明，从声明位置反推所属选择器后判族——`--font-writing` 全域退役（引一次即红）；`--font-display` 只许落在正文六面白名单（`.editor-area/.doc-title/.doc-field/.entry-text/.doc-reading/.nx-writing-text`）；`--font-mono` 只许落在代码上下文（`code/kbd/samp/pre/.history-diff-line/.nx-writing-preview-text`，`:deep(code)` 那类穿透写法按内层选择器算，裸元素名要求整段相等以免 `.preview-text` 被 `pre` 蒙过）。正向另钉四条：正文面在 display 轨、索引窗左栏的族改指 `--font-interface`、工具面有中文名那一读、工具面不再是 `<code>` 裸 id。

## §5 边界自查

未越界：`src/**`、`server/**`、mdRender 管线、ExternalAppHost 的 `sandbox`／`referrerpolicy`、workspace 语义、`next/skills/**` 一字未动；不改颜色／间距／布局几何（本批只动族、档、文案三面）；不加依赖；不自设新阈值闸；不 commit。

## §6 验证读数（执行方实测）

字号直方图（`next/shell/**` 的 .css/.vue，`font-size:` 全部读数）：

| 读数 | 声明数 |
|---|---|
| `var(--nx-fs-2xs)`（含带兜底值写法 4 处） | 141 |
| `var(--nx-fs-md)` | 81 |
| `var(--nx-fs-lg)` | 11 |
| `var(--nx-fs-xl)` | 6 |
| `var(--nx-fs-2xl)` | 4 |
| `var(--writing-font-size, var(--nx-fs-lg))` | 3（正文面：作者偏好通道，工单划出的禁改边界） |

- **同屏刻度档＝5 档**（11／13／15／17／19），验收线是 ≤6；正文那一档随作者偏好浮动，属工单禁改面。
- 裸 px 字号残留＝**0**（白名单只剩 `exportService.mjs` 的导出 HTML）；`var(--fs-sm)`／`var(--fs-base)` 老轨引用＝**0**；相对字号 `.88em`／`.92em`＝**0**。
- `--font-mono` 声明＝**5 处**，全部落在代码上下文（两处 `:deep(code)`、`kbd`／`pre>code`、`.history-diff-line`、`.nx-writing-preview-text`）；工单点名的症状「工具折叠面 46 行等宽裸 id 主读数」现在＝**0 行**。
- `--font-writing` 在壳层的引用＝**0**（`next-shell.css:720` 只剩一句注释，说明它为什么退役；token 定义仍在 `src/**`，归调度方所有，本批不动）。
- 工具面中文名实测（现取清单，不编造）：运行时面 21 行全部取到中文 title；载体面 44 行也全部有 title → 回落「未命名工具」＝**0 行**。

门禁：

| 段 | 结果 |
|---|---|
| `node next/testing/acceptance.mjs` | ✔ 44/44 |
| `node --test "next/tests/*.test.mjs"` | ✔ 825 tests 全绿（含 visual-contract 37/37：新增 ⑭⑮⑯，既有 ①–⑬ 与 8 条样式门禁一字未放宽） |
| `vitest run --config next/vitest.next.shell.config.mjs` | ✔ 16 files／241 tests |
| `npm run lint:next` | ✔ 0 error／0 warning |
| `node next/testing/bundleAssertions.mjs` | ⚠ 跑到外壳构建的 `closeBundle` 报 `EBUSY: rmdir next/.build/next/carriers/comic`（见 §8 L1），前面 a1–a4、d／d2、体积记账均已 ✔ |

## §7 文案前后对照表（任务 3，全量扫 `next/shell/**` 的模板字面量／title／aria／fail 文案）

改前列的是**命中的行话**（原句实现口径），改后列是可 grep 复现的上屏句。
本批不执行 git 命令，改前逐字原文因此不落这张表——调度方复测时以同一份源码对照即可，每条改后句都能用 `grep -F` 一次命中。

| 位置 | 改前命中的行话 | 改后上屏（原文） |
|---|---|---|
| `ConversationTimeline.vue:124` 思维链备注 | 工单点名实锤：「…（批次77 留位，批次78 接子代理时一并接）」批次号＋排线计划 | 「这一轮没有思维链文本，只记录了运行过程。」 |
| `AppNext.vue:167` → StatusBar／页签／右键菜单的地址来源 | 「清单声明／工程覆盖」 | `APP_URL_SOURCE_WORDS`＝「本机改过的地址／插件自带的地址」 |
| `settings/CarrierSettingsGeneric.vue:184` 来源徽标 | 「清单默认／工程覆盖」（直接透出存储层 label） | 经 `sourceVocabulary.mjs` 转写：「项目里存过的值／本机改过的值／插件自带的默认值／随分组走」 |
| `settings/CarrierSettingsGeneric.vue:197` 只读项说明 | 实现口径（值来自清单、要改得动代码） | 「只读：这一项要改得动项目里的文件」 |
| `ipcContract.mjs:615-618` 三条工程覆盖读回失败 | 「工程覆盖」＋路径术语 | 「这一项本机改动读不出来：这条通道当前不可用」／「要先打开一个项目，才看得到它的本机改动」／「拿不到当前项目里那份本机改动（.pinax/carrier-overrides.json）」 |
| `agentReferences.mjs:121` 参考块取不到 | 「清单里没有这一条」 | 「项目里还没有这一条（可能已删除，或那一栏还没打开过）」 |
| `composerTypeahead.mjs:180` `#` 空态 | 「批次78 才生成」 | 「这个项目还没有可引用的角色（在正文里写「角色：」那一类内容后这里就有）」 |
| `settings/SkillsSection.vue:216` 目录未接 | 「批次77 未登记」 | 「这一格还没接上系统的选目录对话框，先手工粘一个绝对路径。」 |
| `settings/HistorySection.vue:154` 恢复不可用 | 「写回通道未接（工程口径）」 | 「这一面还没接上写回文档的通道，暂时不能恢复」 |
| `AssistantDialog.vue:459／848` 用量 chip 与 title | 「上游／本轮无 usage」一类专业口径 | 「这一轮没有用量」／「这一轮模型给出的用量」／「这一轮没有给出用量」 |
| `AssistantDialog.vue` 工具折叠层 | 一行裸 id 的等宽主读数 | 主读数＝清单里的中文名（`:title` 与次要行仍留原始 id，降为次要色） |

## §8 limitations（做不到／没做的，逐条给原因）

- **L1 五段没跑完（第 5 段被环境卡住）**：`bundleAssertions` 的外壳构建在 `closeBundle` 里要先删 `next/.build/next/carriers/comic`，而作者本机此刻正有一个跑着的实例（electron PID 43980，其载体服务 node PID 42040 运行的正是该目录里的 `comfy-mcp-bridge.mjs`）握着这个目录，Windows 返回 `EBUSY`。
  三条出路都在本批约束外：关/杀那个实例（工单禁「不启动/不杀 electron 进程」）、给 `rm` 加重试或跳过（`next/vite.next.shell.config.mjs` 不在允许面内）、把产物目录挪走（同上）。
  该失败与本批改动无因果关系：同一段构建在只有 CSS/文案改动的情况下两次复现同一 rmdir 错误，且渲染层构建（无该拷贝插件）单跑通过。**关掉在跑的实例后重跑 `node next/testing/bundleAssertions.mjs` 即可。**
- **L2 等价取证（补 L1 的缺口，手工跑第 5 段的字体相关判据）**：单跑 `vite build --config next/vite.next.renderer.config.mjs` 后核产物——h 判据的 `--font-writing` 命中 2 处（都在 token 定义处，不在任何选择器上）；i 判据的文楷 `LXGWWenKai-Regular-DNTqAPtM.woff2` 607 kB 在产物里；正文六面在 `--font-display` 轨、chrome 面无 display／mono。
- **L3 真窗口复测没做**：工单的验收是「调度方打开真窗口复测」，本批禁启动 electron，所以同屏档位、Arial 是否绝迹、工具面中文名都是**源码级＋运行时数据级**实测（工具面那份是真的走 `loadBuiltInCarrierPlugins → impl.tools()` 现取的清单读数：载体 44 行、运行时面 21 行，零回落）。像素级复核留给调度方。
- **L4 词表只钉了工单点名的四个工程词＋批次号**：`--fs-` 之外的老轨 token（`--text-secondary` 那一类）不在本批面内；`src/**` 里仍定义着 `--fs-sm/--fs-base/--font-writing`——定义面归调度方所有，本批只清引用面（壳层已零引用），所以「老轨还在、壳层不再读它」。
- **L5 对照表的改前列给的是「命中的行话」而不是原句**：原因见 L1 同一条约束（不执行 git 命令，改前文本不在我手里可核验的范围）；宁缺不造。
- **L6 未碰**：`src/**`、`server/**`、mdRender 管线、`next/skills/**`、ExternalAppHost 的 `sandbox/referrerpolicy`、workspace 语义、颜色／间距／布局几何、依赖、commit——一条没越。
- **L7 `docs/STATUS.md` 没更新**：项目规矩是「行为／状态变了要交接 STATUS」，但工单的允许面只有 `next/shell/**`、`next/tests/**` 与本记录，STATUS 不在面内。本批对外的三处变化（正文面字体从等宽改成文楷、字号并到五档、屏上文案去行话）请调度方在合批时一并落 STATUS；本批只留本档作为依据。
- **L8 视觉判断没走 ui-style-check 的截图环节**：同上——截图要起 electron，工单禁。本批的 UI 判据全部走声明级（门禁⑭⑮⑯＋源码直方图），像素级复核留给调度方。

