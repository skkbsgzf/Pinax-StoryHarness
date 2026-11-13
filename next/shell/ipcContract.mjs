import { fail, ok, NEXT_ERROR_CODES } from '../kernel/errors.mjs'
import { MENU_TEMPLATE, flattenMenuEntries, RECENT_CLEAR_ID } from './menus.mjs'
import { HOTKEYS_VERSION, findHotkeyConflicts, normalizeHotkeys } from './hotkeys.mjs'
import { RESERVED_SLOTS, orderActivityItems } from './slots.mjs'
import { RUNTIME_CONTRACT } from '../runtime/runtimeContract.mjs'
import { BOOK_DIR, BOOK_MAX_CHARS, nextChapterName, parseDocumentTitle } from './bookText.mjs'

/**
 * 渲染进程 ↔ 主进程的唯一通道合同（WP4）。
 * 三条硬规矩都写成数据，门禁和单测都按这份核：
 *   1) 渲染层只能调这里的通道，调不到内核实现——所以「插件绕过外壳直接写盘」在通道层就不成立；
 *   2) 通道一律 `pinax:agent:*` 命名空间，运行时（一级公民）占主干，载体的动作全走 `carrier.*`；
 *   3) 每个通道返回的是内核的结果对象（{ok,...} 或失败载荷），失败原样透传给界面渲染，不吞错、不白屏。
 */
export const IPC_NAMESPACE = 'pinax:agent:'

/**
 * 渲染层 → 主进程的通知通道（收口包⑤）：语义是「这件事已经发生了」，不是请求-应答。
 * 渲染层发完就走、不等业务数据；主进程侧只做副作用（重设原生窗控浮层），不写偏好、不进 onPrefsApplied。
 *
 * 为什么仍收进 IPC_CHANNELS：preload 的请求白名单只从这一张表取（preload.mjs 的 ALLOWED_REQUEST），
 * 而本工单的文件面不含 preload；放进同一张表＝不需要动桥就能发。名字与注释把语义钉在「通知」上。
 */
export const IPC_NOTIFY = Object.freeze({
  prefsTheme: 'pinax:agent:prefs:theme'
})

export const IPC_CHANNELS = Object.freeze({
  ...IPC_NOTIFY,
  kernelInfo: 'pinax:agent:kernel-info',
  view: 'pinax:agent:view',
  projectCreate: 'pinax:agent:project:create',
  projectCreateBare: 'pinax:agent:project:create-bare',
  projectPickDir: 'pinax:agent:project:pick-dir',
  projectOpen: 'pinax:agent:project:open',
  // 最近打开的项目（应用级偏好）：只读拉取。记账与清空都不走渲染层——
  // 打开成功由主进程自动记，「清除最近打开」是菜单动作（project.recentClear）走主进程落点。
  projectRecentList: 'pinax:agent:project:recent-list',
  // 库管理器（工单 A-3）：卡片「更多」菜单的两个动作——都只碰记录与文件管理器，不碰库内容。
  projectReveal: 'pinax:agent:project:reveal',
  projectRecentRemove: 'pinax:agent:project:recent-remove',
  projectImportRun: 'pinax:agent:project:import-run',
  // 批次30：大纲转换（散文章节稿 → 大纲/outline.json）。只对当前项目的 大纲/ 操作，
  // 外部稿子先走 E1 拷进来再转换；dryRun=true 只扫描，不写盘。
  outlineImport: 'pinax:agent:outline:import',
  projectClose: 'pinax:agent:project:close',
  carrierSetEnabled: 'pinax:agent:carrier:set-enabled',
  carrierSetPrimary: 'pinax:agent:carrier:set-primary',
  runtimeAsk: 'pinax:agent:runtime:ask',
  // 批次77 任务3：停止在途提问。与 runtimeAsk 同一命名族（一条提问、一条停它）。
  // 载荷 `{ askId }`——askId 就是这一轮运行的身份（渲染层自带或回执里拿到的那一个）。
  // 语义边界：只标记取消，正在跑的那一轮照常跑完；轮次边界之后不再续轮（掐不回已经发出的 HTTP 请求）。
  runtimeAskAbort: 'pinax:agent:runtime:ask-abort',
  runtimeToolCall: 'pinax:agent:runtime:tool-call',
  runtimePropose: 'pinax:agent:runtime:propose',
  // 协议 v3 的 services 面：看服务状态／重启一颗服务。渲染层只读状态，重启要走主进程。
  runtimeServices: 'pinax:agent:runtime:services',
  runtimeServiceRestart: 'pinax:agent:runtime:service-restart',
  // 批次49：服务与通知的公共池。快照读取＋「知道了」确认；确认只落应用级偏好，不写项目 .pinax/。
  runtimeServiceLog: 'pinax:agent:runtime:service-log',
  runtimeServiceLogAck: 'pinax:agent:runtime:service-log-ack',
  // 协议 v3 的 entry 面：面板页要调工具走这一条。主进程只放只读工具，
  // 且只放「这块板自己那本工具」与内核只读工具——别的板的工具不开放。
  pluginToolCall: 'pinax:agent:plugin:tool-call',
  // 批次41：正文写作动作（续写／改写／扩写／压缩／润色）。载荷是「动作＋正文＋选区＋额外要求」，
  // 提示词在主进程由 writingActions 拼——不是一条通用模型管道。
  runtimeComplete: 'pinax:agent:runtime:complete',
  // 批次46A：最近一次写作请求的完整提示词（只读）。主进程留存 system＋user，渲染层只读展示；
  // 不做实时预览，也不跨项目给——预览口只回当前项目最近那一次。
  writingPreview: 'pinax:agent:writing:last-preview',
  // M2.5-B：会话落盘。load 读 JSONL，save 交整份快照，import 只给老浏览器缓存迁移用一次。
  sessionsLoad: 'pinax:agent:sessions:load',
  sessionsSave: 'pinax:agent:sessions:save',
  sessionsImport: 'pinax:agent:sessions:import',
  // M2.5-C：工作区四轴状态（.pinax/workspace.json）。渲染层整份读、整份写，形状净化在渲染层。
  workspaceLoad: 'pinax:agent:workspace:load',
  workspaceSave: 'pinax:agent:workspace:save',
  // 批次45：每插件配置命名空间（.pinax/settings.json）。load 读全量 carriers 映射；
  // save 是按载体声明白名单校验过的单值写入，未声明／类型不符由主进程拒绝。
  settingsLoad: 'pinax:agent:settings:load',
  settingsSave: 'pinax:agent:settings:save',
  // 批次54：工程级覆盖（.pinax/ 下的覆盖文件）只读给渲染层——应用面据此换 url，
  // 设置界面据此显示「工程覆盖」来源。写覆盖是作者改项目文件，不开 GUI 写口。
  carrierOverrides: 'pinax:agent:carrier:overrides',
  // H2 知识服务：进程内 knowledgeService（createKnowledgeRuntime），不走 HTTP。
  // entry 恒传当前项目根；不开全局知识面。
  knowledgeSearch: 'pinax:agent:knowledge:search',
  knowledgeIndexStatus: 'pinax:agent:knowledge:index-status',
  // 工单B：索引重建（首次/资料变更后）——主进程内 kb_search 触发 prepare，再盘点 revision。
  knowledgeIndexSync: 'pinax:agent:knowledge:index-sync',
  prefsGet: 'pinax:agent:prefs:get',
  prefsSet: 'pinax:agent:prefs:set',
  prefsProbeModelPlane: 'pinax:agent:prefs:probe-model-plane',
  historyList: 'pinax:agent:history:list',
  historyShow: 'pinax:agent:history:show',
  historyDiff: 'pinax:agent:history:diff',
  historyCommitNow: 'pinax:agent:history:commit-now',
  historyProbe: 'pinax:agent:history:probe',
  backupExport: 'pinax:agent:backup:export',
  backupRestore: 'pinax:agent:backup:restore',
  // 批次26：导出当前文档（txt／doc）。真正的「另存为」对话框与写盘都在主进程（注入的 exportFile），
  // 渲染层只递交正文与格式——它拿不到 fs，也决定不了落点。
  documentExport: 'pinax:agent:document:export',
  // 批次46B：标杆1 的周边工具。查找／替换是只读与单章写（替换仍走 expectedRevision 闸）；
  // 整本导出与单篇导入都是主进程的结构动作（系统对话框＋写盘），渲染层只给格式与触发。
  bookSearch: 'pinax:agent:book:search',
  bookReplaceCurrent: 'pinax:agent:book:replace-current',
  bookImportDoc: 'pinax:agent:book:import-doc',
  bookExport: 'pinax:agent:book:export',
  menuInvoke: 'pinax:agent:menu:invoke',
  // 批次62 任务2：命令面。list 回「应用菜单动作 ∪ registry.commands()」这一张表
  //（纯数据：id／title／owner／accelerator／run 落点名——run 是字符串，函数过不了 IPC 边界）。
  commandList: 'pinax:agent:command:list',
  // 批次62 任务4：快捷键表（.pinax/hotkeys.json）。整份读、整份写；
  // 冲突在这道闸就拒并往服务与通知池记一条 warn，坏档回默认（净化在 next/shell/hotkeys.mjs）。
  hotkeysLoad: 'pinax:agent:hotkeys:load',
  hotkeysSave: 'pinax:agent:hotkeys:save',
  // 批次77 任务5：技能库设置面。四条都只认当前项目根——启停真值存项目内 `.pinax/skills.json`，
  // 导入的包落在 `.pinax/skills/`，都不写全局偏好（换项目不该带走上一本书的启停）。
  // list 现扫两层目录并带上每一条拒装原因（守卫⑪：原因必须看得见）；toggle 写一条启停；
  // body 只在点开「查看正文」时取那一份全文（清单里从不带正文，渐进披露那道闸不破）；
  // import 把选中的目录拷进 `.pinax/skills/` 后逐条校验，不合格列原因，不假装成功。
  skillsList: 'pinax:agent:skills:list',
  skillsToggle: 'pinax:agent:skills:toggle',
  skillsBody: 'pinax:agent:skills:body',
  skillsImport: 'pinax:agent:skills:import',
  // M 系接线批：fact 引擎 LlmPort 的主进程出口（推演戏剧✦层／抽取／成书渲染共用这一条）。
  // 载荷只认 {prompt, system?, maxTokens?}——model／cwd／command 由主进程配置钉死，渲染层指定不了；
  // 进程与凭据都在内核侧，渲染层只收 {text, usage}。不注入时如实报缺，戏剧✦层缺席不阻塞必然/命运。
  factLlmComplete: 'pinax:agent:fact:llm-complete',
  // S0 冻结 · S1 接线：拆解数据四通道（fact.data/v3 条目从 `拆解/*.json` 直接上屏）。
  // 四条都**显式收 root**，不进 REQUIRED_PROJECT_CHANNELS——不依赖 session 当前项目，
  // 同一进程里可以给不同库读清单（库管理器/多窗口将来用得上）。
  //   list  → { root, layer?, slot?, status?, offset?, limit? } → { ok, entries, total, warnings }
  //   get   → { root, id } → { ok, entry, revision }
  //   save  → { root, entry, operationId, expectedRevision? } → S1 阶段 typed fail WRITE_PROTOCOL_NOT_STARTED
  //   search→ { root, q, layer?, limit? } → { ok, hits:[{id,name,score,snippet}] }
  // 成功载荷是扁平的（不套 value），与 S0 契约表逐字一致；失败仍走 fail() 的 {ok:false,error}。
  factList: 'pinax:agent:fact:list',
  factGet: 'pinax:agent:fact:get',
  factSave: 'pinax:agent:fact:save',
  factSearch: 'pinax:agent:fact:search'
})

/**
 * 反向通道（主进程推渲染进程）只有这三条，右栏的流式输出靠它们，不给插件开放推送。
 * 名字给出来是为了不靠下标取用——下标一动，调用方的含义就悄悄换了。
 */
export const IPC_EVENT = Object.freeze({
  viewChanged: 'pinax:agent:event:view-changed',
  runtimeProgress: 'pinax:agent:event:runtime-progress',
  menuInvoked: 'pinax:agent:event:menu-invoked',
  // 批次37：项目变更（进程内事件总线的渲染层出口）。payload `{ kind, at }`，只报「哪类数据变了」，
  // 不带路径与正文——渲染层据此重读自己那一份，不在这里传数据。事件是通知，不是请求。
  projectEvent: 'pinax:agent:event:project-changed'
})

export const IPC_EVENTS = Object.freeze(Object.values(IPC_EVENT))

/**
 * 运行过程事件推送通道（批次29）：主进程 → 渲染层，payload `{ askId, event }`。
 *
 * 名字由工单钉死为 `pinax:agent:runtime:ask-event`——它没有 `event:` 这一段，
 * 所以不能进 IPC_EVENT（shell-contract 断言那张表里的每一个都以 `pinax:agent:event:` 开头）。
 * preload 的事件白名单同时取 IPC_EVENTS 与这张表，所以渲染层不需要第二条订阅机制。
 */
export const IPC_PUSH = Object.freeze({
  runtimeAskEvent: 'pinax:agent:runtime:ask-event',
  // 协议 v3 的 services 面：服务起停／崩溃／就绪都推给渲染层，右栏不用轮询。
  runtimeServiceEvent: 'pinax:agent:runtime:service-event',
  // 批次49：公共池快照变化（起停、日志、确认）。与 runtimeServiceEvent 分开两条：
  // 后者是「单个服务的一次事件」旧形状，消费方是右栏；这一条是含服务＋外部 MCP＋未确认
  // 通知的全量快照，消费方是竖条状态点与设置页「服务与通知」——混用会让两边互相误解载荷。
  runtimeServiceLogChanged: 'pinax:agent:runtime:service-log-changed',
  // 最近打开的项目清单变化（作者 2026-11-10 点单）：整份 `{ recents: [...] }` 推给渲染层，
  // 页内菜单行的「项目」组据此重画。与 recent-list 拉取通道成对：拉取管启动一拍，推送管此后每一次。
  recentProjectsChanged: 'pinax:agent:push:recent-projects-changed'
})

export const IPC_PUSH_EVENTS = Object.freeze(Object.values(IPC_PUSH))

const SLIM_MAX_DEPTH = 8

function pruneValue(value, depth) {
  if (typeof value === 'function') return undefined
  if (value === null || typeof value !== 'object') return value
  if (depth >= SLIM_MAX_DEPTH) return undefined
  if (Array.isArray(value)) {
    const out = []
    for (const item of value) {
      const pruned = pruneValue(item, depth + 1)
      if (pruned !== undefined) out.push(pruned)
    }
    return out
  }
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) {
    // 非 plain object（Date/Map/类实例）：Date 转 ISO，其余丢弃——IPC 面只该有数据。
    return value instanceof Date ? value.toISOString() : undefined
  }
  const out = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'function') continue
    const pruned = pruneValue(item, depth + 1)
    if (pruned !== undefined) out[key] = pruned
  }
  return out
}

/**
 * IPC 边界净值裁剪（批次11 验收修复）。
 *
 * session.* 的成功结果（projectCreate/projectOpen/carrierSet* 等）原样带着 fileService 这类
 * 含函数属性的内核对象：进程内分发器与单测从不克隆，所以批次1 起一直没暴露；走真
 * ipcMain.handle 时 Electron 要结构化克隆返回值，函数一进去就「An object could not be cloned」。
 * 这里深剪成功结果的 value（丢函数与不可克隆对象，只留数据），失败载荷与 ok/error 外形原样保留。
 * 只用在主进程 ipcMain.handle 的出线上；进程内分发器与单测保持全值（carrier-pane-real 靠 fileService 走真链路）。
 */
export function slimForIpc(result) {
  if (!result || typeof result !== 'object') return result
  if (result.ok !== true) return result
  const value = pruneValue(result.value, 0)
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    // fileService 是内核内部对象（渲染层没有任何合法用途）：顶层显式剪掉，不做「剪掉函数后的空壳」。
    delete value.fileService
  }
  return { ...result, value }
}

// 启停/切主载体是对项目合同的写入，必须先有一个「已经落在某个文件夹上的项目」；
// 注意判据是 projectRoot 而不是 project——裸项目（还没主载体）打开会失败，但主载体向导必须能写这一笔，
// 否则空框架就死在「要先有主载体才能选主载体」上。
// 运行时的三个通道不在此列——一级公民在项目没打开时也要活着（它自己会如实报缺什么）。
const REQUIRED_PROJECT_CHANNELS = new Set([
  IPC_CHANNELS.carrierSetEnabled, IPC_CHANNELS.carrierSetPrimary
])

/**
 * 三栏视图模型：左竖条／中栏来自注册表（主载体置顶），右栏来自运行时合同（不可被占用）。
 * 空插件集也要出得来——M1 的判据就是「不装任何插件，外壳照样能进」。
 */
export function shellView(session) {
  const view = session?.view ?? null
  const project = session?.project?.value ?? null
  const registry = session?.registry
  const primaryId = view?.primary ?? project?.document?.carriers?.primary ?? null
  const openError = session?.lastFailure && !session.lastFailure.ok ? session.lastFailure.error : null

  return {
    kernel: session?.kernel ?? null,
    project: project ? {
      root: project.root,
      name: project.document?.name ?? null,
      kind: project.document?.kind ?? null,
      spec: project.document?.spec ?? null,
      revision: project.document?.carriers?.revision ?? 0
    } : null,
    // 主载体向导的触发条件：合同里明确「还没有主载体」，或打开时被 D1/D2 闸门拦下。
    needsPrimary: Boolean(project?.document?.needsPrimary) || openError?.code === NEXT_ERROR_CODES.PRIMARY_CARRIER_MISSING,
    openError: session?.lastFailure && !session.lastFailure.ok ? session.lastFailure.error : null,
    left: view ? orderActivityItems(view.panes['left-dock'], { primaryPluginId: primaryId }) : [],
    center: view ? view.panes.center : [],
    primary: primaryId ? registry?.get?.(primaryId) ?? null : null,
    carriers: registry ? registry.list().map((manifest) => ({
      id: manifest.id,
      title: manifest.title,
      primary: manifest.primary,
      capabilities: manifest.capabilities,
      requires: manifest.requires,
      scopes: manifest.scopes,
      // 面板要能把「这块板块声明了什么」摊给作者看：目录／权限／工具名／上下文块与预算都是清单里的原话。
      tools: manifest.tools,
      context: manifest.context ?? null,
      panes: manifest.panes,
      // 载体声明的设置节（协议 P14）：统一设置二级页据此出目录项；空声明＝设置页不出这一格。
      settings: manifest.settings ?? [],
      // 批次62：载体声明的命令（协议 @4 的 contributes.commands，校验器已保证 id／title／run 合法）。
      // view 带着它，命令面板在「桥不可用」的开发／验收形态里仍能按同一份声明列出条目（不落第二份清单）。
      commands: manifest.commands ?? [],
      // 协议 v3：清单代际与「插件会自己动手」的四张牌（面板入口／本地服务／外部 MCP／AGENT.md）。
      spec: manifest.spec,
      entry: manifest.entry ?? null,
      services: manifest.services ?? [],
      mcp: manifest.mcp ?? [],
      agentMd: manifest.agentMd ?? null,
      dataDirs: Object.values(manifest.dataDirs),
      isPrimary: manifest.id === primaryId,
      isEnabled: view ? view.enabled.includes(manifest.id) : false
    })) : [],
    archive: view?.archive ?? [],
    skeletonDirs: view?.dirs?.skeleton ?? [],
    ownedDirs: view?.dirs?.owned ?? [],
    rejected: registry?.rejected ?? [],
    // 运行时自身不可停用（disableable 恒 false，一级公民）；载体停用不是「拔掉一块 UI」——
    // 走重建＋pane 关闭＋工作区清理（批次45）：服务／MCP／工具面随 session.refresh 收掉，
    // 外壳先 disposeOwner 并把该载体全部 pane 实例状态从工作区清掉。
    runtime: {
      title: RUNTIME_CONTRACT.title,
      builtIn: RUNTIME_CONTRACT.builtIn,
      disableable: RUNTIME_CONTRACT.disableable,
      ownsSlot: RUNTIME_CONTRACT.ownsSlot,
      budgetPriority: RUNTIME_CONTRACT.budgetPriority,
      writeSurface: RUNTIME_CONTRACT.writeSurface,
      reservedSlotReason: RESERVED_SLOTS.right,
      surface: session?.runtime?.surfaceInfo?.() ?? null,
      tools: session?.runtime?.dockViewModel?.().tools ?? [],
      started: Boolean(session?.runtime?.dockViewModel?.().started)
    }
  }
}

/**
 * 纯函数分发器：主进程 ipcMain 与单测共用同一个实现。
 * 第二个参数允许 undefined/null（当作 {}），但拒绝非对象——避免渲染层把字符串塞进 payload 造成内核侧 TypeError。
 *
 * deps 扩展（批次 8①）：
 *   prefs            —— 应用级偏好存储（next/runtime/appPreferences）；不注入时 prefs:* 通道如实报缺。
 *   onPrefsApplied   —— 偏好落盘后的生效钩子（主进程：改任务面端点 + 改窗口缩放 + 重设原生窗控浮层）；
 *   onThemeChanged   —— 主题通知（prefs:theme，收口包⑤）的副作用钩子（主进程：按新主题重设窗控浮层）。
 *                       通知语义：不写偏好、不进 onPrefsApplied；不注入时只记 applied:false，不当作数据请求失败。
 *   probeModelPlane  —— 模型面三态探测（next/runtime/modelPlaneProbe）；不注入时探测通道如实报缺。
 * deps 扩展（D1 历史）：
 *   history          —— { gitHistory, scheduler }；不注入时 history:* 五条通道如实报缺。
 *   onProjectOpened  —— 项目打开/刷新成功后的接线钩子（主进程：建历史仓库 + 起定时器 + 给新 fileService 挂标脏钩子）。
 *   onProjectClosed  —— 项目关闭后的旁路钩子（工单E3：主进程用它停历史定时器）。
 *                       session.close 不清 projectRoot（既有语义不动），所以「停表」这个动作放在外壳层；
 *                       不注入时行为与旧版一致，钩子抛错也不把「已关闭」翻成失败。
 * deps 扩展（E1 导入既有稿）：
 *   importProject    —— ({ sourcePath, targetPath, dryRun }) => { ok, value|error }（next/runtime/projectImportAdapter）；
 *                       不注入时 project:import-run 如实报缺，界面把这句话原样摊开，不假装导入过。
 * deps 扩展（G2 备份与恢复）：
 *   backupService    —— next/runtime/projectBackupService（exportProject／restoreProject／readBackupManifest）；
 *                       不注入时 backup:export／backup:restore 如实报缺，界面不假装备份过。
 *                       backup:restore 只带 backupDir 时是「预检」：返回 manifest 摘要，不写一个字节。
 * deps 扩展（H2 知识服务 all-in-one）：
 *   knowledgeService —— next/runtime/knowledgeService（createKnowledgeService）；search／indexStatus／indexSync
 *                       都在主进程内跑（worker 线程检索，零 HTTP）。不注入时 knowledge:* 三条通道如实报缺；
 *                       三条通道都只认 session.projectRoot，entry 恒传当前项目，不接受渲染层指定别的根。
 * deps 扩展（批次26 导出）：
 *   exportFile       —— ({ content, format, title, html }) => { ok:{canceled|path…} }：主进程弹系统「另存为」
 *                       再落盘（next/shell/exportService）。不注入时 document:export 如实报缺，不假装导出过。
 * deps 扩展（批次30 大纲转换）：
 *   outlineImport    —— ({ root, fileService, dryRun }) => { ok, value|error }（next/runtime/outlineImportService）；
 *                       不注入时 outline:import 如实报缺。只认当前项目根与当前文件服务——渲染层指定不了别的目录。
 * deps 扩展（批次29 运行过程事件）：
 *   emitRuntimeEvent —— ({ askId, event }) => void：runtimeAsk 执行期间把运行器的真实阶段事件推给渲染层
 *                       （主进程：webContents.send(IPC_PUSH.runtimeAskEvent, payload)）。
 *                       不注入时只算 askId、不发事件（进程内单测与验收照旧，两参调用面不变）。
 * deps 扩展（批次41 写作动作）：
 *   writingComplete  —— next/runtime/writingComplete（createWritingComplete）。{ run } 收
 *                       { action, text, selection, instruction }；动作闭集与提示词都在主进程侧。
 *                       不注入时 runtime:complete 如实报缺，不回落成一次普通提问。
 *                       批次46A 起还有 { preview({root}) }：只读返回当前项目最近一次写作请求的
 *                       system＋user，不注入时 writing:last-preview 同样如实报缺。
 * deps 扩展（批次45 每插件配置）：
 *   settingsStoreFor —— (root) => settingsStore（next/settingsStore）：按当前项目根取那份
 *                       `.pinax/settings.json` 的读写器；声明白名单随注册表现取。
 *                       不注入时 settings:* 两条通道如实报缺。
 *   carrierOverridesFor —— (root) => carrierOverridesStore（next/carrierOverridesStore）：
 *                       批次54 的工程覆盖只读口（应用面 url／来源层展示）。不注入时如实报缺。
 * deps 扩展（批次77 任务5 技能库）：
 *   skillsService —— next/skills/loadSkills.mjs 的 createSkillsService：{ list, toggle, body, importFrom }。
 *                       四条 skills:* 通道都只转发给它（判定与落盘口径全在装载层那一份，这里不留第二套）。
 *                       不注入时如实报缺——不注入的是**接线**，不是功能：渲染层拿不到 fs，也不该拿。
 * deps 扩展（P4 S3 hook 接线）：
 *   factHooks —— next/shell/factHookService.mjs 的 createFactHookService：
 *                       { runToolCall({tool,args,call}), afterComplete({action,result}) }。
 *                       保存类工具（章节/大纲/世界书）成功后做 diffValidate＋缺失实体草案；
 *                       续写产出补全建议提案、润色只读查询。钩子是旁路：失败不影响主动作。
 *                       不注入时两个动作照旧——接线不在这一层，fs／hub 转换器也进不了渲染层依赖图。
 * deps 扩展（M 系接线批 fact LlmPort）：
 *   factLlm —— next/runtime/factLlmService.mjs 的 createFactLlmService：{ complete({prompt,system,maxTokens}) }。
 *                       作者裁定「无 API token，开子 Agent 走既有模型通道」——默认派发是 CodeBuddy CLI
 *                       纯补全（--tools "" 禁工具），进程与凭据都在主进程。通道只转发白名单载荷，
 *                       渲染层指定不了 model／cwd／command。不注入时 fact:llm-complete 如实报缺，
 *                       推演面板的戏剧✦层缺席不阻塞必然▮／命运⚙（失败隔离在 fact 消费侧）。
 * deps 扩展（S1 拆解数据接线）：
 *   factStoreFor —— (root) => factFileStore（next/kernel/factFileStore.mjs）。
 *                       四条 fact:* 通道显式收 root；这里只按 root 取 store（主进程按 resolve 后路径缓存），
 *                       store 自己读 `<root>/拆解/*.json`，本层不碰 fs。不注入时四通道如实报缺。
 *                       注意：这不是「当前项目的隐式存储」——root 是请求里那一份，换库换 root。
 */
export function createIpcDispatcher({ session, onMenuInvoke = null, prefs = null, onPrefsApplied = null, onThemeChanged = null, probeModelPlane = null, pickProjectDir = null, recentProjects = null, projectReveal = null, projectRecentRemove = null, history = null, onProjectOpened = null, onProjectClosed = null, importProject = null, outlineImport = null, backupService = null, knowledgeService = null, exportFile = null, pickBookDocument = null, exportBookFile = null, emitRuntimeEvent = null, writingComplete = null, settingsStoreFor = null, carrierOverridesFor = null, serviceLogPool = null, skillsService = null, factHooks = null, factLlm = null, factStoreFor = null }) {
  // 批次62 任务2：这条通道认的 id 集不再是「MENU_TEMPLATE 的拍平结果」这一份死集合，
  // 而是 MENU_TEMPLATE ∪ registry.commands()，每次现算（载体可被启用／停用）。
  // 见下方 acceptedMenuIds —— 全文件只有那一处口径。
  // 本轮提问的关联键：渲染层先自带一个（它要在事件到达时就认得出这是哪一问），
  // 没带就由这里发一个，并随回执回去——两条路都保证「事件与回答同一条 askId」。
  let askSeq = 0
  const nextAskId = () => `ask-${Date.now().toString(36)}-${(++askSeq).toString(36)}`

  /**
   * 在途提问登记表（批次77 任务3）：askId → 取消令牌。
   * 只在这条分发器闭包里活，随进程走——它是「哪一问还在跑」的事实源，不是持久状态；
   * 停错了（问已经答完）不硬编一条错误，回执里 `cancelled:false` 加那句实话，界面据此说「这一问已经不在跑了」。
   */
  const inFlightAsks = new Map()

  /**
   * 命令面（批次62 任务2）。两件事都只有一处实现：
   *   · `menu:invoke` 认的 id 集＝MENU_TEMPLATE ∪ registry.commands()——载体命令从此能走同一条分发回执，
   *     但 C5 那条纪律没松：进的是**命令表**，不是原生顶层菜单（菜单模板本身一个字都没改）；
   *     未知 id 照旧拒绝。集合每次现算，因为载体可以在运行中被启用／停用，写死在创建时就旧了。
   *   · `command:list` 回同一张表的纯数据版（id／title／owner／accelerator／run 落点名）。
   *     `run` 只能是字符串：函数过不了 ipcMain.handle 的结构化克隆（slimForIpc 会把它剪掉）。
   * 键位这里给的是 MENU_TEMPLATE 那份默认值；作者改过键位后的实际 accelerator 由渲染层
   * 用 hotkeys:load 的结果覆盖——两处都读同一张 hotkeys 表，不各写一份。
   */
  const menuEntries = flattenMenuEntries(MENU_TEMPLATE)
  function acceptedMenuIds() {
    const set = new Set(menuEntries.map((item) => item.id))
    // 「清除最近打开」是应用菜单动作，但只在清单非空时才渲染（withRecentProjects 拼块）——
    // 模板里没有它的静态项，接受集按常量放行；具体条目（project.recent）是渲染层落点，不进集合。
    set.add(RECENT_CLEAR_ID)
    for (const command of session?.registry?.commands?.() ?? []) set.add(command.id)
    return set
  }

  function commandTable() {
    const accelerators = Object.fromEntries(menuEntries.map((item) => [item.id, item.accelerator ?? '']))
    const titles = Object.fromEntries((session?.registry?.list?.() ?? []).map((manifest) => [manifest.id, manifest.title]))
    const fromMenu = menuEntries.map((item) => ({
      id: item.id,
      title: item.label,
      owner: 'app.menu',
      ownerTitle: '应用菜单',
      group: 'menu',
      accelerator: item.accelerator ?? '',
      run: `menu:${item.id}`
    }))
    const fromCarriers = (session?.registry?.commands?.() ?? []).map((command) => ({
      id: command.id,
      title: command.title,
      owner: command.pluginId,
      ownerTitle: titles[command.pluginId] ?? command.pluginId,
      group: 'carrier',
      accelerator: accelerators[command.id] ?? '',
      // 清单层的 run 已由校验器保证是函数或非空串；串之外的东西在这里就是没接线，如实给空串。
      run: typeof command.run === 'string' ? command.run : ''
    }))
    return [...fromMenu, ...fromCarriers]
  }

  /** 快捷键表的记账：冲突与坏档都往「服务与通知」池留一条 warn——被拒的写入不能只回一句错误。 */
  function noteHotkeyIssue(level, message, data = {}) {
    if (typeof serviceLogPool?.append !== 'function') return
    try {
      serviceLogPool.append({ source: { kind: 'hotkeys', id: 'hotkeys', carrierId: null }, level, message, data })
    } catch {
      // 记账失败不改变这条通道自己的裁决结果。
    }
  }

  /** 技能四条通道的缺线说法：不注入的是接线，不是功能——渲染层拿不到 fs，也不该拿。 */
  function skillsUnwired() {
    return fail('INVALID_INPUT', '技能服务未接入（主进程未创建 skillsService）：这条通道现在只报缺，不读写任何文件')
  }

  /**
   * fact:* 四条通道的仓储解析：root 必须是请求里显式给的非空字符串。
   * 没注入（jsdom／裸会话／验收）或注入但给不出店时，返回的是 fail 载荷——调用方用
   * `typeof store?.list !== 'function'` 判出「这不是店，是要原样回给渲染层的失败」。
   * 这一层不缓存：缓存按 resolve 后路径归主进程（同一条 root 只建一个 store）。
   */
  function factStoreForRequest(input) {
    if (typeof factStoreFor !== 'function') {
      return fail('INVALID_INPUT', '事实存储未接入（主进程未创建 factFileStore）：这条通道现在只报缺，不读写任何文件')
    }
    const root = String(input?.root ?? '').trim()
    if (!root) return fail('INVALID_INPUT', 'fact:* 通道需要显式带上库根（root）：不接受隐式当前项目')
    let store = null
    try {
      store = factStoreFor(root)
    } catch (error) {
      return fail('IO_FAILED', `事实存储创建失败：${String(error?.message || error)}`, { root })
    }
    if (!store) return fail('INVALID_INPUT', `事实存储没有为该库根建出实例：${root}`, { root })
    return store
  }

  /** 项目（重新）打开后通知主进程接线；历史接线失败不能把「项目已打开」翻成失败。 */
  async function notifyProjectOpened(result) {
    if (!onProjectOpened || !result?.ok) return
    try {
      // name 给主进程的最近项目记账用（菜单标签「名 — 路径」）；读不到就空着，标签只摆路径。
      await onProjectOpened({ root: session.projectRoot, fileService: result.value?.fileService ?? null, name: result.value?.document?.name ?? null, kind: result.value?.document?.kind ?? null })
    } catch {
      // 历史是旁路：probe 会如实显示不可用，项目本身照常可用。
    }
  }

  async function dispatch(channel, payload) {
    if (!Object.values(IPC_CHANNELS).includes(channel)) {
      return fail('INVALID_INPUT', `未注册的 IPC 通道：${String(channel)}`, { channel })
    }
    const input = payload ?? {}
    if (typeof input !== 'object' || Array.isArray(input)) {
      return fail('INVALID_INPUT', `通道 ${channel} 的载荷必须是对象`, { channel })
    }
    if (REQUIRED_PROJECT_CHANNELS.has(channel) && !session.projectRoot) {
      return fail('INVALID_INPUT', `通道 ${channel} 需要先有一个项目（新建或打开项目文件夹）`)
    }

    switch (channel) {
      case IPC_CHANNELS.kernelInfo:
        return ok(session.kernel)
      case IPC_CHANNELS.view:
        return ok(shellView(session))
      case IPC_CHANNELS.projectCreate: {
        const created = await session.create({ name: input.name, primaryCarrier: input.primaryCarrier, extraEnabled: input.extraEnabled ?? [], root: input.root ?? null })
        if (created.ok) await notifyProjectOpened(created)
        return created
      }
      case IPC_CHANNELS.projectPickDir:
        return pickProjectDir ? pickProjectDir(input) : fail('INVALID_INPUT', '目录选择未接入（主进程系统对话框不可用）')
      case IPC_CHANNELS.projectCreateBare:
        return session.createBare({ name: input.name })
      // E1 导入既有稿：结构动作与 projectCreate 同级——作者在统一二级页里显式按下，
      // 不经写族闸（那条闸拦的是模型侧的内核写族），也不碰 server/mcp 的导入语义。
      // sources＝逐类导入（向导「一种或几种」）：[{category, path}]，给了就按类扫描；校验在适配器。
      case IPC_CHANNELS.projectImportRun:
        return importProject
          ? importProject({
              sourcePath: input.sourcePath,
              targetPath: input.targetPath,
              dryRun: input.dryRun !== false,
              sources: Array.isArray(input.sources) ? input.sources : null
            })
          : fail('INVALID_INPUT', '导入适配器未接入（主进程未注入 projectImportAdapter）：这条通道现在只报缺，不落盘')
      // 批次30：散文章节稿 → 大纲/outline.json。与导入同级的结构动作，走 shell 通道不经写族闸；
      // 只认当前项目根与当前文件服务（渲染层指定不了别的目录），dryRun 缺省＝只扫描不写盘。
      case IPC_CHANNELS.outlineImport: {
        if (!outlineImport) return fail('INVALID_INPUT', '大纲转换服务未接入（主进程未注入 outlineImportService）：这条通道现在只报缺，不写任何文件')
        if (!session.projectRoot) return fail('INVALID_INPUT', '大纲转换需要先打开一个项目：只转换当前项目 大纲/ 里的章节稿')
        const fileService = session.project?.value?.fileService ?? null
        if (!fileService) return fail('INVALID_INPUT', '文件服务未就绪（项目还没完整打开）：这条通道现在只报缺，不写任何文件')
        return outlineImport({ root: session.projectRoot, fileService, dryRun: input.dryRun !== false })
      }
      case IPC_CHANNELS.projectOpen: {
        const opened = await session.open(input.root)
        if (opened.ok) await notifyProjectOpened(opened)
        return opened
      }
      case IPC_CHANNELS.projectRecentList:
        // 只读拉取：主进程没接（jsdom 验收／裸会话）就如实回空清单——「没有记录」是合法答案，
        // 不学历史通道那样报缺：菜单少了这一块照常用，不该变成一条错误横幅。
        return ok({ recents: typeof recentProjects === 'function' ? (recentProjects() ?? []) : [] })

      case IPC_CHANNELS.projectReveal:
        // 只请主进程在文件管理器里显示该目录：渲染层不碰 shell，路径由主进程校验在案（最近清单内）。
        return projectReveal
          ? projectReveal(input)
          : fail('INVALID_INPUT', '文件管理器未接入（主进程未注入 reveal 入口）：这条通道现在只报缺')
      case IPC_CHANNELS.projectRecentRemove: {
        // 只移除最近清单里的记录，不删磁盘目录（工单 A-3 明文）；主进程按路径过滤后整份重写偏好。
        const removed = typeof projectRecentRemove === 'function'
          ? projectRecentRemove(input)
          : fail('INVALID_INPUT', '最近清单服务未接入（主进程未注入移除入口）：这条通道现在只报缺')
        return removed
      }      case IPC_CHANNELS.projectClose: {
        const closed = await session.close()
        // 工单E3：关项目后停历史定时器。session.close 不清 projectRoot（既有语义不动），
        // 停表只能由外壳做；回调是旁路——抛错也不把「已关闭」翻成失败（probe 会如实显示不可用）。
        if (onProjectClosed) {
          try {
            await onProjectClosed()
          } catch {
            // 历史是旁路：停表失败不该挡住关项目。
          }
        }
        return closed
      }
      case IPC_CHANNELS.carrierSetEnabled: {
        // 批次45：停用＝重建＋pane 关闭＋工作区清理。重建（session.setEnabled → refresh）收掉
        // 服务／MCP／工具面；pane 实例与工作区状态由外壳调用侧在发起前清（渲染层持有工作区单例）。
        const result = await session.setEnabled(input.pluginId, input.enabled, input.expectedRevision)
        // 启停会重建 fileService（session.refresh）：新实例必须重新挂上标脏钩子，否则之后的写入不进历史。
        if (result.ok) await notifyProjectOpened(result)
        return result
      }
      case IPC_CHANNELS.carrierSetPrimary: {
        const result = await session.setPrimary(input.pluginId, input.expectedRevision)
        if (result.ok) await notifyProjectOpened(result)
        return result
      }
      case IPC_CHANNELS.runtimeAsk: {
        if (!session.runtime) return fail('INVALID_INPUT', '运行时尚未就绪')
        const requestedAskId = typeof input.askId === 'string' ? input.askId.trim().slice(0, 80) : ''
        const askId = requestedAskId || nextAskId()
        const onEvent = typeof emitRuntimeEvent === 'function'
          ? (event) => emitRuntimeEvent({ askId, event })
          : null
        // writeMode／skill 只从载荷进：写模式是会话真值（未知值由运行时回落 review），
        // 技能是 slash 选中后带上的方法名；两者都不在这里猜。
        // 取消令牌在提问进运行器**之前**登记、之后无论成败都摘掉：
        // 摘晚了会出现「这一问早就结束了还能被停」的假象，摘早了停止钮点了没东西接。
        const token = { cancelled: false, cancelledAt: null }
        inFlightAsks.set(askId, token)
        let result
        try {
          result = await session.runtime.ask(input.question, input.context ?? {}, {
            ...(onEvent ? { onEvent } : {}),
            ...('writeMode' in input ? { writeMode: input.writeMode } : {}),
            ...('skill' in input ? { skill: input.skill } : {}),
            abort: () => token.cancelled
          })
        } finally {
          // 只摘自己这一枚：同一 askId 被新一轮覆盖时不能把别人那枚删掉。
          if (inFlightAsks.get(askId) === token) inFlightAsks.delete(askId)
        }
        // askId 随回执回去：渲染层据此把「本次 busy 期」的事件串到这一条回答上（晚到的事件对不上号就丢）。
        if (result?.ok) return { ...result, value: { ...(result.value ?? {}), askId } }
        return result
      }
      // 批次77 任务3：按 askId 标记取消。这里只置位不抛错——真正「不再续轮」发生在
      // next/runtime/toolLoop.mjs 的轮次边界，那边才会发 stage:'stopped'（主进程真事件，渲染层不代造）。
      case IPC_CHANNELS.runtimeAskAbort: {
        const askId = typeof input.askId === 'string' ? input.askId.trim().slice(0, 80) : ''
        if (!askId) return fail('INVALID_INPUT', '停止提问要带上是哪一问（askId）：没有它不知道该取消哪一次运行')
        const token = inFlightAsks.get(askId)
        if (!token) {
          return ok({ askId, cancelled: false, reason: '这一问不在途：要么已经答完，要么根本没进运行器——没有需要停止的东西' })
        }
        if (!token.cancelled) token.cancelledAt = new Date().toISOString()
        token.cancelled = true
        return ok({ askId, cancelled: true, at: token.cancelledAt, note: '正在跑的这一轮照常跑完，轮次边界之后不再续轮' })
      }
      case IPC_CHANNELS.sessionsLoad:
        return typeof session.loadSessions === 'function'
          ? session.loadSessions()
          : fail('INVALID_INPUT', '会话服务未接入（主进程未创建 sessionStore）：这条通道现在只报缺')
      case IPC_CHANNELS.sessionsSave: {
        if (typeof session.saveSessions !== 'function') return fail('INVALID_INPUT', '会话服务未接入（主进程未创建 sessionStore）：这条通道现在只报缺')
        if (!session.projectRoot) return fail('INVALID_INPUT', '会话落盘需要先打开一个项目')
        return session.saveSessions(input.snapshot)
      }
      case IPC_CHANNELS.sessionsImport: {
        if (typeof session.importSessions !== 'function') return fail('INVALID_INPUT', '会话服务未接入（主进程未创建 sessionStore）：这条通道现在只报缺')
        if (!session.projectRoot) return fail('INVALID_INPUT', '会话迁移需要先打开一个项目')
        return session.importSessions(input.legacy)
      }
      case IPC_CHANNELS.workspaceLoad:
        return typeof session.loadWorkspace === 'function'
          ? session.loadWorkspace()
          : fail('INVALID_INPUT', '工作区服务未接入（主进程未创建 workspaceStore）：这条通道现在只报缺')
      case IPC_CHANNELS.workspaceSave: {
        if (typeof session.saveWorkspace !== 'function') return fail('INVALID_INPUT', '工作区服务未接入（主进程未创建 workspaceStore）：这条通道现在只报缺')
        if (!session.projectRoot) return fail('INVALID_INPUT', '工作区落盘需要先打开一个项目')
        return session.saveWorkspace(input.snapshot)
      }
      // 批次62 任务4：快捷键表 `.pinax/hotkeys.json`。读写都跟当前项目根走（与工作区同一形状），
      // 净化与冲突判定只在 next/shell/hotkeys.mjs 一处——存储实现（谁落盘）复用同一份，不各写一遍。
      case IPC_CHANNELS.hotkeysLoad: {
        if (typeof session.loadHotkeys !== 'function') return fail('INVALID_INPUT', '快捷键服务未接入（主进程未创建 hotkeysStore）：这条通道现在只报缺')
        const loaded = await session.loadHotkeys()
        if (!loaded?.ok) return loaded ?? fail('INVALID_INPUT', '快捷键读取失败：主进程没有回一份结果对象')
        const stored = loaded.value && typeof loaded.value === 'object' ? loaded.value : {}
        const normalized = normalizeHotkeys({ version: HOTKEYS_VERSION, bindings: stored.bindings ?? {} })
        const warnings = [...(Array.isArray(stored.warnings) ? stored.warnings : []), ...normalized.warnings]
        if (normalized.warnings.length) noteHotkeyIssue('warn', `快捷键表按默认值继续：${normalized.warnings.join('、')}`, { warnings: normalized.warnings })
        return ok({ version: HOTKEYS_VERSION, bindings: normalized.bindings, warnings, exists: stored.exists !== false })
      }
      case IPC_CHANNELS.hotkeysSave: {
        if (typeof session.saveHotkeys !== 'function') return fail('INVALID_INPUT', '快捷键服务未接入（主进程未创建 hotkeysStore）：这条通道现在只报缺')
        if (!session.projectRoot) return fail('INVALID_INPUT', '快捷键落盘需要先打开一个项目')
        const submitted = input?.bindings && typeof input.bindings === 'object' && !Array.isArray(input.bindings)
          ? input.bindings
          : {}
        // 冲突即拒：整份不落盘。「谁赢」没有正确答案，替作者选一个就是悄悄改了他的键位。
        const conflicts = findHotkeyConflicts(submitted)
        if (conflicts.length) {
          const message = `快捷键冲突，写入被拒：${conflicts.map((item) => `${item.accelerator}（${item.ids.join('／')}）`).join('；')}`
          noteHotkeyIssue('warn', message, { conflicts })
          return fail('INVALID_INPUT', message, { conflicts })
        }
        const normalized = normalizeHotkeys({ version: HOTKEYS_VERSION, bindings: submitted })
        const saved = await session.saveHotkeys(normalized.bindings)
        if (!saved?.ok) return saved ?? fail('INVALID_INPUT', '快捷键落盘失败：主进程没有回一份结果对象')
        return ok({ version: HOTKEYS_VERSION, bindings: normalized.bindings, warnings: normalized.warnings, result: saved.value ?? null })
      }
      // 批次62 任务2：命令表。面板与任何消费者读的都是这一句，渲染层不再自己拼第二份。
      case IPC_CHANNELS.commandList: {
        const commands = commandTable()
        return ok({ commands, total: commands.length })
      }
      // 批次45：每插件配置。读的是当前项目 `.pinax/settings.json` 的全量 carriers 映射；
      // 写只走 store.set 的白名单闸（未声明／类型不符／section 一律拒，不落盘）。
      case IPC_CHANNELS.settingsLoad: {
        if (typeof settingsStoreFor !== 'function') return fail('INVALID_INPUT', '配置服务未接入（主进程未创建 settingsStore）：这条通道现在只报缺')
        if (!session.projectRoot) return fail('INVALID_INPUT', '配置读取需要先打开一个项目')
        const store = settingsStoreFor(session.projectRoot)
        return store ? store.read() : fail('INVALID_INPUT', '配置存储不可用：拿不到当前项目的 .pinax/settings.json')
      }
      case IPC_CHANNELS.settingsSave: {
        if (typeof settingsStoreFor !== 'function') return fail('INVALID_INPUT', '配置服务未接入（主进程未创建 settingsStore）：这条通道现在只报缺')
        if (!session.projectRoot) return fail('INVALID_INPUT', '配置落盘需要先打开一个项目')
        const store = settingsStoreFor(session.projectRoot)
        if (!store) return fail('INVALID_INPUT', '配置存储不可用：拿不到当前项目的 .pinax/settings.json')
        return store.set(input.carrierId, input.settingId, input.value)
      }
      // 批次54：工程覆盖只读。应用面（外部应用 url）与设置页（来源层）读同一份；
      // 写覆盖是作者改项目文件，这条通道不开写口——没有 set/remove。
      // 〔批次68-R1 任务3〕这三句是**会显示在界面上的错误**，主语换成作者能看到的事实，不留实现口径。
      case IPC_CHANNELS.carrierOverrides: {
        if (typeof carrierOverridesFor !== 'function') return fail('INVALID_INPUT', '这一项本机改动读不出来：这条通道当前不可用')
        if (!session.projectRoot) return fail('INVALID_INPUT', '要先打开一个项目，才看得到它的本机改动')
        const store = carrierOverridesFor(session.projectRoot)
        return store ? store.read() : fail('INVALID_INPUT', '拿不到当前项目里那份本机改动（.pinax/carrier-overrides.json）')
      }
      // 批次77 任务5：技能库设置面。四条都只把载荷交给技能服务——启停真值、两层目录、拒装原因
      // 的口径全在 next/skills/loadSkills.mjs 那一份，通道这层不留第二套判定。
      // 为什么不在本文件里直接引装载层：ipcContract 在渲染层的依赖图上（AppNext 等只取通道名），
      // 而装载层静态用 node:fs —— 把 fs 拖进 renderer bundle 是这条链一直守着的那个口（服务由主进程注入）。
      case IPC_CHANNELS.skillsList:
        return skillsService ? skillsService.list() : skillsUnwired()
      case IPC_CHANNELS.skillsToggle: {
        if (!skillsService) return skillsUnwired()
        // 启停只认布尔：缺了这一笔就替作者猜一次开关，猜错的方向是「他以为关掉了」。
        if (typeof input.enabled !== 'boolean') return fail('INVALID_INPUT', '技能启停要给出 enabled：true＝启用，false＝停用')
        return skillsService.toggle(input.name, input.enabled)
      }
      case IPC_CHANNELS.skillsBody:
        return skillsService ? skillsService.body(input.name) : skillsUnwired()
      case IPC_CHANNELS.skillsImport:
        return skillsService ? skillsService.importFrom(input.sourceDir) : skillsUnwired()
      // M 系接线批：fact LlmPort 出口。载荷白名单在这里钉死——渲染层递 model／cwd／command 也不采信，
      // 进程怎么起、用哪个模型是主进程配置（env）说了算。AbortSignal 过不了结构化克隆，渲染层适配器
      // 在桥那边自己处理中止；这条通道只收可克隆的 {prompt, system, maxTokens}。
      case IPC_CHANNELS.factLlmComplete: {
        if (!factLlm?.complete) return fail('INVALID_INPUT', '推演模型通道未接入（主进程未创建 factLlmService）：这条通道现在只报缺，不编任何文字')
        return factLlm.complete({ prompt: input.prompt, system: input.system, maxTokens: input.maxTokens })
      }
      // S1 拆解数据四通道：只认请求里显式带的 root（不依赖 session 当前项目），
      // 四条的返回值都是 store 的扁平 {ok,...}——这里不二次包装、不改签名（S0 冻结）。
      case IPC_CHANNELS.factList: {
        const store = factStoreForRequest(input)
        if (typeof store?.list !== 'function') return store
        return store.list({
          layer: input.layer,
          slot: input.slot,
          status: input.status,
          offset: input.offset,
          limit: input.limit
        })
      }
      case IPC_CHANNELS.factGet: {
        const store = factStoreForRequest(input)
        if (typeof store?.get !== 'function') return store
        return store.get({ id: input.id })
      }
      case IPC_CHANNELS.factSave: {
        const store = factStoreForRequest(input)
        if (typeof store?.save !== 'function') return store
        // S1 阶段 store.save 只校验信封，过验后如实回 WRITE_PROTOCOL_NOT_STARTED（写协议在 S2）。
        return store.save({
          entry: input.entry,
          operationId: input.operationId,
          expectedRevision: input.expectedRevision
        })
      }
      case IPC_CHANNELS.factSearch: {
        const store = factStoreForRequest(input)
        if (typeof store?.search !== 'function') return store
        return store.search({ q: input.q, layer: input.layer, limit: input.limit })
      }
      case IPC_CHANNELS.runtimeToolCall: {
        if (!session.runtime) return fail('INVALID_INPUT', '运行时尚未就绪')
        const tool = input.tool
        const args = input.args ?? {}
        // P4 S3：保存类工具走钩子包一层（保存前 hub 快照 → 原调用 → 成功后 diff 校验＋缺失实体草案）。
        // 非保存工具原样透传；factHooks 未注入时与旧行为逐字相同。
        if (factHooks?.runToolCall) {
          return factHooks.runToolCall({ tool, args, call: () => session.runtime.callTool(tool, args) })
        }
        return session.runtime.callTool(tool, args)
      }
      case IPC_CHANNELS.runtimePropose:
        return session.runtime ? session.runtime.propose({ name: input.name, text: input.text }) : fail('INVALID_INPUT', '运行时尚未就绪')
      // 协议 v3 的 services 面：状态只读，重启走主进程（渲染层不碰子进程）。
      case IPC_CHANNELS.runtimeServices:
        return ok({ services: session.runtime?.serviceStatus?.() ?? [] })
      case IPC_CHANNELS.runtimeServiceRestart:
        if (!session.runtime) return fail('INVALID_INPUT', '运行时尚未就绪')
        return session.runtime.restartService(input.id)
      // 批次49：公共池。读是整份快照（服务＋MCP＋未确认通知），确认只动应用级时间戳。
      case IPC_CHANNELS.runtimeServiceLog:
        return ok({
          log: serviceLogPool?.snapshot?.() ?? { at: new Date().toISOString(), ackedAt: null, carriers: [], entries: [] }
        })
      case IPC_CHANNELS.runtimeServiceLogAck: {
        if (!serviceLogPool?.acknowledge) {
          return fail('INVALID_INPUT', '服务通知池未接入（主进程未创建 serviceLogPool）：这条通道现在只报缺')
        }
        const acknowledged = serviceLogPool.acknowledge(input?.upToAt ?? new Date().toISOString())
        return ok({ ackedAt: acknowledged?.value?.ackedAt ?? null, log: serviceLogPool.snapshot() })
      }
      // 协议 v3 的 entry 面：面板页调工具。三道闸都在这一道通道里：
      //   1) 工具得在面上（认不出＝不存在，不猜）；
      //   2) 必须是只读工具（readOnlyHint === false 一律拒——面板没有写盘的口子）；
      //   3) 归属要么是这块板自己，要么是内核（别的板的工具不开放）。
      case IPC_CHANNELS.pluginToolCall: {
        if (!session.runtime) return fail('INVALID_INPUT', '运行时尚未就绪')
        const name = String(input?.name ?? '')
        const pluginId = String(input?.pluginId ?? '')
        if (!name) return fail('INVALID_INPUT', '面板调用必须给出工具名')
        const tool = session.runtime.listTools().find((item) => item?.name === name)
        if (!tool) return fail('INVALID_INPUT', `工具面里没有 ${name}`, { tool: name })
        if (tool.annotations?.readOnlyHint === false) {
          return fail('INVALID_INPUT', `${name} 会写盘，面板不得调用`, { tool: name })
        }
        const owner = session.runtime.ownerOf(name)
        if (owner !== pluginId && owner !== 'kernel') {
          return fail('INVALID_INPUT', `${name} 属于 ${owner}，${pluginId || '面板'} 不能调`, { tool: name, owner })
        }
        return session.runtime.callTool(name, input?.args ?? {})
      }
      // 批次41：正文写作动作。只认闭集动作（writingActions 里的五个），正文与选区原样交给主进程校验，
      // 提示词不进渲染层。动作没有注入就如实报缺——不在这里回落成一次普通提问。
      case IPC_CHANNELS.runtimeComplete: {
        if (!writingComplete?.run) return fail('INVALID_INPUT', '写作动作未接入（主进程未创建 writingComplete）：这条通道现在只报缺，不写任何字')
        if (!session.projectRoot) return fail('INVALID_INPUT', '写作动作需要先打开一个项目：它按当前项目的稿子来写')
        const result = await writingComplete.run({
          action: input.action,
          text: input.text,
          selection: input.selection,
          instruction: input.instruction,
          // 预览口按项目根核对：主进程留存的那一份属于哪个项目，就在这里钉进请求。
          root: session.projectRoot
        })
        if (!result?.ok || !factHooks?.afterComplete) return result
        // P4 S3：续写→suggestCompletion（给建议提案）、润色→readOnlyQuery（零写入）。
        // 钩子错了也把写作结果原样还给作者，错误只挂在回执旁注上——旁路不许反过来吃掉主路。
        try {
          const hook = await factHooks.afterComplete({ action: input.action, result })
          if (!hook) return result
          return { ...result, value: { ...(result.value ?? {}), factHook: hook } }
        } catch (error) {
          return {
            ...result,
            value: { ...(result.value ?? {}), factHook: { error: String(error?.message || error) } }
          }
        }
      }
      // 批次46A：提示词预览（只读）。最近一次写作请求的完整 system＋user 留在主进程，
      // 渲染层只读展示；换成另一个项目后旧预览不跨项目给。
      case IPC_CHANNELS.writingPreview: {
        if (!writingComplete?.preview) return fail('INVALID_INPUT', '提示词预览未接入（主进程未创建 writingComplete）：这条通道现在只报缺')
        if (!session.projectRoot) return fail('INVALID_INPUT', '提示词预览需要先打开一个项目：它只展示当前项目最近一次写作请求')
        return writingComplete.preview({ root: session.projectRoot })
      }
      // H2／工单B：知识服务 all-in-one。三条都只认当前项目根——渲染层传什么 root 都不采信。
      case IPC_CHANNELS.knowledgeSearch: {
        if (!knowledgeService?.search) return fail('INVALID_INPUT', '知识服务未接入（主进程未创建 knowledgeService）：这条通道现在只报缺，不检索任何资料')
        if (!session.projectRoot) return fail('INVALID_INPUT', '知识检索需要先打开一个项目：只检索当前项目，不做全局知识面')
        return knowledgeService.search({ ...input, root: session.projectRoot })
      }
      case IPC_CHANNELS.knowledgeIndexStatus: {
        // 旧注入服务只有 exportProjectKnowledge（H2 的旧名）；新服务用 indexStatus。
        const status = knowledgeService?.indexStatus ?? knowledgeService?.exportProjectKnowledge
        if (typeof status !== 'function') return fail('INVALID_INPUT', '知识服务未接入（主进程未创建 knowledgeService）：这条通道现在只报缺，不盘点任何资料')
        if (!session.projectRoot) return fail('INVALID_INPUT', '资料盘点需要先打开一个项目：只盘点当前项目')
        return status.call(knowledgeService, { root: session.projectRoot })
      }
      case IPC_CHANNELS.knowledgeIndexSync: {
        if (!knowledgeService?.indexSync) return fail('INVALID_INPUT', '知识服务未接入（主进程未创建 knowledgeService）：这条通道现在只报缺，不重建索引')
        if (!session.projectRoot) return fail('INVALID_INPUT', '索引重建需要先打开一个项目：只索引当前项目')
        // probe 只是触发索引的那一次检索词；服务侧会截断到 200 字，空值回落「设定」。
        return knowledgeService.indexSync({ root: session.projectRoot, probe: input.probe })
      }
      case IPC_CHANNELS.prefsGet:
        return prefs ? prefs.read() : fail('INVALID_INPUT', '偏好存储未接入（主进程未创建偏好文件）')
      case IPC_CHANNELS.prefsSet: {
        if (!prefs) return fail('INVALID_INPUT', '偏好存储未接入（主进程未创建偏好文件）')
        // 只写载荷真的带了的字段：D2 起外壳会单独写 theme（主题切换），
        // 若把 modelPlaneEndpoint/uiZoom 以 undefined 一并塞进去，会把用户已存的端点/缩放重置回默认。
        const patch = {}
        if ('modelPlaneEndpoint' in input) patch.modelPlaneEndpoint = input.modelPlaneEndpoint
        if ('uiZoom' in input) patch.uiZoom = input.uiZoom
        if ('historyIntervalMinutes' in input) patch.historyIntervalMinutes = input.historyIntervalMinutes
        // 工单B 写作偏好（调度方裁定）：正文字号／行高也是 prefs:set 的合法载荷，
        // 与上面四个字段同一套「带了才写」语义——漏抄就等于保存链路在 IPC 层断掉。
        if ('writingFontSize' in input) patch.writingFontSize = input.writingFontSize
        if ('writingLineHeight' in input) patch.writingLineHeight = input.writingLineHeight
        // 批次46B 排版偏好补齐：段距／首行缩进／打字机／段落聚焦同属写作偏好，同一套「带了才写」。
        if ('writingParagraphSpacing' in input) patch.writingParagraphSpacing = input.writingParagraphSpacing
        if ('writingTextIndent' in input) patch.writingTextIndent = input.writingTextIndent
        if ('writingTypewriter' in input) patch.writingTypewriter = input.writingTypewriter
        if ('writingFocusMode' in input) patch.writingFocusMode = input.writingFocusMode
        // 批次49：「服务与通知」的确认时间（应用级，不进项目）。只在显示确认时由设置页写。
        if ('serviceNoticesAckedAt' in input) patch.serviceNoticesAckedAt = input.serviceNoticesAckedAt
        if ('theme' in input) patch.theme = input.theme
        const written = await prefs.write(patch)
        if (!written.ok) return written
        if (onPrefsApplied) await onPrefsApplied(written.value)
        return ok(written.value)
      }
      case IPC_CHANNELS.prefsProbeModelPlane:
        return probeModelPlane ? await probeModelPlane() : fail('INVALID_INPUT', '模型面探测未接入')
      // 收口包⑤：主题通知（不是请求）。渲染层 writeScheme 落完主题就发一次；
      // 主进程只重设原生窗控浮层的 symbolColor／height，不写偏好、不碰项目。
      case IPC_CHANNELS.prefsTheme: {
        if (input.theme !== 'light' && input.theme !== 'dark') {
          return fail('INVALID_INPUT', 'theme 必须是 light／dark', { theme: input.theme ?? null })
        }
        if (onThemeChanged) await onThemeChanged(input.theme)
        return ok({ theme: input.theme, applied: Boolean(onThemeChanged) })
      }
      case IPC_CHANNELS.historyList:
        if (!history?.gitHistory) return fail('INVALID_INPUT', '历史引擎未接入（主进程未创建历史服务）')
        if (!session.projectRoot) return fail('INVALID_INPUT', '历史查询需要先打开一个项目')
        return history.gitHistory.listFileHistory({ root: session.projectRoot, path: input.path, limit: input.limit })
      case IPC_CHANNELS.historyShow:
        if (!history?.gitHistory) return fail('INVALID_INPUT', '历史引擎未接入（主进程未创建历史服务）')
        if (!session.projectRoot) return fail('INVALID_INPUT', '历史查询需要先打开一个项目')
        return history.gitHistory.readVersion({ root: session.projectRoot, oid: input.oid, path: input.path })
      case IPC_CHANNELS.historyDiff:
        if (!history?.gitHistory) return fail('INVALID_INPUT', '历史引擎未接入（主进程未创建历史服务）')
        if (!session.projectRoot) return fail('INVALID_INPUT', '历史查询需要先打开一个项目')
        return history.gitHistory.diffVersions({ root: session.projectRoot, a: input.a, b: input.b, path: input.path })
      case IPC_CHANNELS.historyCommitNow:
        return history?.scheduler
          ? history.scheduler.requestCommit(input.message)
          : fail('INVALID_INPUT', '历史调度未接入（主进程未创建历史服务）')
      case IPC_CHANNELS.historyProbe:
        return history?.scheduler
          ? history.scheduler.probe()
          : fail('INVALID_INPUT', '历史探测未接入（主进程未创建历史服务）')
      case IPC_CHANNELS.backupExport: {
        if (!backupService?.exportProject) return fail('INVALID_INPUT', '备份服务未接入（主进程未注入 projectBackupService）：这条通道现在只报缺，不复制任何文件')
        if (!session.projectRoot) return fail('INVALID_INPUT', '备份需要先打开一个项目：备份的是当前打开的项目目录')
        return backupService.exportProject({
          root: session.projectRoot,
          targetParent: input.targetParent,
          includeHistory: input.includeHistory === true
        })
      }
      case IPC_CHANNELS.backupRestore: {
        if (!backupService?.restoreProject) return fail('INVALID_INPUT', '备份服务未接入（主进程未注入 projectBackupService）：这条通道现在只报缺，不写任何文件')
        // 恢复区的预检（工单G2）：只给 backupDir 时先把 manifest 摘要摊给作者，不要求 targetRoot、不写盘。
        if (!input.targetRoot) {
          return backupService.readBackupManifest
            ? backupService.readBackupManifest({ backupDir: input.backupDir })
            : fail('INVALID_INPUT', '备份服务未提供 readBackupManifest：恢复区的预检不可用')
        }
        return backupService.restoreProject({ backupDir: input.backupDir, targetRoot: input.targetRoot })
      }
      case IPC_CHANNELS.documentExport: {
        if (!exportFile) return fail('INVALID_INPUT', '导出服务未接入（主进程未注入 exportService）：这条通道现在只报缺，不写任何文件')
        if (typeof input.content !== 'string' || !input.content.length) {
          return fail('INVALID_INPUT', '导出需要当前文档的正文（content）：空白文档没有可导出的内容')
        }
        const format = input.format === 'doc' ? 'doc' : 'txt'
        return exportFile({
          content: input.content,
          format,
          title: input.title ?? null,
          // html 是渲染层（mdRender.mjs）渲染好的片段：只给 doc 用，txt 始终写源文本。
          html: typeof input.html === 'string' ? input.html : null
        })
      }
      case IPC_CHANNELS.bookSearch: {
        // 全书查找是只读手：只扫当前项目的 正文/，不换目录、不写盘。
        if (!session.projectRoot) return fail('INVALID_INPUT', '全书查找需要先打开一个项目')
        const fileService = session.project?.value?.fileService ?? null
        if (!fileService?.searchChapters) return fail('INVALID_INPUT', '文件服务未就绪（项目还没完整打开）：这条通道现在只报缺')
        return fileService.searchChapters(input.query, {
          caseSensitive: input.caseSensitive === true,
          maxHits: input.maxHits
        })
      }
      case IPC_CHANNELS.bookReplaceCurrent: {
        // 单章替换：范围只有 input.file 这一章，仍走 expectedRevision 闸；不做全书一键替换。
        if (!session.projectRoot) return fail('INVALID_INPUT', '替换需要先打开一个项目')
        const fileService = session.project?.value?.fileService ?? null
        if (!fileService?.replaceInChapter) return fail('INVALID_INPUT', '文件服务未就绪（项目还没完整打开）：这条通道现在只报缺')
        return fileService.replaceInChapter({
          file: input.file,
          find: input.find,
          replace: input.replace,
          expectedRevision: input.expectedRevision,
          caseSensitive: input.caseSensitive === true,
          all: input.all !== false
        })
      }
      case IPC_CHANNELS.bookImportDoc: {
        // 单篇导入：系统对话框选 .txt／.md → 标题解析 → 正文/NNN-标题.md（expectedRevision 0）。
        if (!pickBookDocument) return fail('INVALID_INPUT', '导入服务未接入（主进程未注入文档选择器）：这条通道现在只报缺，不写任何文件')
        if (!session.projectRoot) return fail('INVALID_INPUT', '导入需要先打开一个项目')
        const fileService = session.project?.value?.fileService ?? null
        if (!fileService?.write) return fail('INVALID_INPUT', '文件服务未就绪（项目还没完整打开）：这条通道现在只报缺，不写任何文件')
        const owner = fileService.ownerOfDir?.(BOOK_DIR) ?? null
        if (!owner) return fail('INVALID_INPUT', `没有板块认领「${BOOK_DIR}/」：这本书没有可导入的章节目录`, { dir: BOOK_DIR })
        const picked = await pickBookDocument(input)
        if (!picked?.ok) return picked ?? fail('IO_FAILED', '文档选择失败')
        const source = picked.value ?? {}
        if (source.canceled) return ok({ canceled: true, file: null, title: null })
        const text = typeof source.text === 'string' ? source.text : ''
        if (!text.length) return fail('INVALID_INPUT', `「${source.name ?? '所选文件'}」是空文件，没有可导入的内容`)
        if (text.length > BOOK_MAX_CHARS) return fail('INVALID_INPUT', `导入的文档超出上限 ${BOOK_MAX_CHARS} 字符`, { chars: text.length })
        const listed = await fileService.list({ pluginId: owner, dir: BOOK_DIR })
        if (!listed.ok) return listed
        // NNN 顺延要看见卷子目录里的章（卷章两级，批次23）：顶层散章＋一级子目录里的章，
        // 带相对路径喂给 nextChapterName（它自己取 basename）——只数顶层会在卷结构书里
        // 导出与卷内重号的顶层 001（调度方验收补刀，评审员发现）。
        const existing = []
        for (const entry of listed.value.entries ?? []) {
          if (entry.kind === 'file' && /\.md$/iu.test(entry.name)) existing.push(entry.name)
          else if (entry.kind === 'dir') {
            const nested = await fileService.list({ pluginId: owner, dir: `${BOOK_DIR}/${entry.name}` })
            if (!nested.ok) continue
            for (const nestedEntry of nested.value.entries ?? []) {
              if (nestedEntry.kind === 'file' && /\.md$/iu.test(nestedEntry.name)) existing.push(`${entry.name}/${nestedEntry.name}`)
            }
          }
        }
        const title = parseDocumentTitle({ text, fileName: source.name })
        const planned = nextChapterName({ title, existing })
        const written = await fileService.write({
          pluginId: owner,
          dir: BOOK_DIR,
          file: planned.name,
          text,
          expectedRevision: 0
        })
        if (!written.ok) return written
        return ok({
          canceled: false,
          file: written.value.relativePath,
          title: planned.title,
          revision: written.value.revision,
          chars: text.length
        })
      }
      case IPC_CHANNELS.bookExport: {
        // 整本导出：对话框与写盘都在主进程（注入的 exportBookFile），渲染层只给格式。
        if (!exportBookFile) return fail('INVALID_INPUT', '整本导出未接入（主进程未注入导出器）：这条通道现在只报缺，不写任何文件')
        if (!session.projectRoot) return fail('INVALID_INPUT', '整本导出需要先打开一个项目')
        const format = input.format === 'doc' ? 'doc' : 'txt'
        return exportBookFile({ root: session.projectRoot, format, title: input.title ?? null })
      }
      case IPC_CHANNELS.menuInvoke: {
        if (!acceptedMenuIds().has(input.id)) {
          return fail('INVALID_INPUT', `指令 ${String(input.id)} 既不在应用菜单模板里，也不在任何已启用载体的命令表里：未知 id 一律拒绝（载体可以贡献命令，但不许注入顶层菜单——C5）`, { id: input.id })
        }
        // 批次63 收编b：载体命令的执行落点在渲染层（AppNext.runMenuAction 按命令表的 run 走面板那条通路）。
        // 主进程这一侧的职责没变：它管的是「这把 id 认不认」（接受集＝MENU_TEMPLATE ∪ registry.commands()），
        // handled 说的就是这件事——不做载体命令的事，也不替渲染层假装做过。
        if (onMenuInvoke) await onMenuInvoke(input.id)
        return ok({ id: input.id, handled: true })
      }
      default:
        return fail('INVALID_INPUT', `通道 ${channel} 未接线`)
    }
  }

  // menuIds 现在是活的（载体命令随注册表进出），用 getter 而不是创建时拍平一次。
  return { dispatch, get menuIds() { return [...acceptedMenuIds()] } }
}
