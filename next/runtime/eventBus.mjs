import { resolve as resolvePath } from 'node:path'
import { fail } from '../kernel/errors.mjs'

/**
 * 项目事件总线（批次37 · 任务一）。
 *
 * 要治的是什么：M2.5-C 里载体清单已经能声明 `subscriptions: ['project.changed']`，
 * 但宿主没有发布者——改了盘没人知道，「导入后要手动重扫」成了唯一的刷新路径。
 * 这一层就是那个发布者，**最小实现**：进程内 Map<root, Set<fn>>，不持久化、不跨进程。
 *
 * 四条边界（都写进测试）：
 *   1) 同 root 广播；跨 root 完全隔离（两个项目窗口互不打扰，多窗口竞态照旧「后写者赢」）；
 *   2) 订阅返回退订函数；退订是幂等的，重复调不炸；
 *   3) 一个订阅者抛错不拦别人（事件是旁路，不是提问本身）；
 *   4) 事件形状 { kind, topic, at, path }——kind 取自 PROJECT_EVENT_KINDS，at 是 ISO 时刻；
 *      topic（订阅词）与 path（哪份文件）自批次66 起恒定带上，取不到就是 null，
 *      订阅方不必再判「这个键这次有没有」；没有订阅者时 emit 是空操作。
 *
 * kind 的名字按「哪块数据变了」命名，不按「谁改的」：同一句话在 auto 模式由工具直写、
 * 在 review 模式由作者采纳提案，最终都是同一种变化，订阅方只该关心前者。
 * `proposals-changed` 是工单四类之外的第五类：提案目录不属于任何载体 dataDir，
 * 但「提案列表要自动刷新」是这一批的验收条件，单列一类比塞进 entries 诚实。
 *
 * 批次66 任务四再加两类，与前五类的差别在「订阅词」那一级（见 PROJECT_EVENT_TOPICS）：
 * - `file-changed`：任何一次受控落盘（写／删／改名／提案）都发，带 relativePath。
 *   前五类是「哪块数据变了」（按目录归类，界面整块刷新），这一类是「哪份文件变了」（细到路径）。
 *   同一次落盘会先后收到两条：这里先发的细的那条，和写入钩子按目录映射发出的粗的那条——
 *   不是重复投递事故，是两个粒度各管各的刷新。
 * - `layout-changed`：`.pinax/workspace.json` 落盘后发。窗口布局不是载体数据，
 *   前五类里没有任何一类能代表它（它连 dataDir 都不在）。
 */
export const PROJECT_EVENT_KINDS = Object.freeze([
  'entries-changed',
  'outline-changed',
  'manuscript-changed',
  'sessions-changed',
  'proposals-changed',
  'file-changed',
  'layout-changed'
])

/**
 * 订阅词 ↔ kind 的同构表（批次66）。两个层级各有用处，不能混成一个：
 * - 订阅词（右边）是**声明面**：载体清单里能写的闭集，就 project.changed／file.changed／layout.changed
 *   三个（词表本体在 next/kernel/carrierManifest.mjs 的 CARRIER_SUBSCRIPTIONS，这里是总线侧的镜像路由表）；
 * - kind（左边）是**投递面**：进程内更细的变化类别，七个。
 * 五个老 kind 都归 `project.changed`（批次37 的口径不变）；两类新 kind 各归自己的新词。
 * 认不出来的 kind（第三方自己 emit 的自定义类别）topic 为 null——按「没有订阅词」如实投递给
 * 不挑词的订阅者，不猜一个近义的词。
 */
export const PROJECT_EVENT_TOPICS = Object.freeze({
  'entries-changed': 'project.changed',
  'outline-changed': 'project.changed',
  'manuscript-changed': 'project.changed',
  'sessions-changed': 'project.changed',
  'proposals-changed': 'project.changed',
  'file-changed': 'file.changed',
  'layout-changed': 'layout.changed'
})

/** 订阅词 → 该词覆盖的 kind 清单（投递与测试都用它反查，不在别处再抄一份映射）。 */
export function projectEventKindsForTopic(topic) {
  const wanted = String(topic ?? '')
  return PROJECT_EVENT_KINDS.filter((kind) => PROJECT_EVENT_TOPICS[kind] === wanted)
}

/** kind → 订阅词；认不出返回 null（不猜近义）。 */
export function projectEventTopicForKind(kind) {
  return PROJECT_EVENT_TOPICS[String(kind ?? '')] ?? null
}

/**
 * 载体目录 → 事件类别的映射（fileService.notifyWrite 的 relativePath 首段）。
 * 世界书／构思／约束／剧本／资料都算「条目型内容变了」——它们的界面都是清单，刷新方式相同；
 * 正文单独一类（编辑器要提醒草稿可能过期），大纲单独一类（左树要重列）。
 */
const DIRECTORY_KINDS = Object.freeze({
  '正文': 'manuscript-changed',
  '大纲': 'outline-changed',
  '世界书': 'entries-changed',
  '构思': 'entries-changed',
  '约束': 'entries-changed',
  '剧本': 'entries-changed',
  '资料': 'entries-changed'
})

/**
 * 监听表：root 归一后作键；没有订阅者的 root 不占位（退订后即删）。
 * 值从 Set<handler> 升级为 Map<handler, owner>（批次51），再升级为 Map<handler, { owner, topics }>（批次66）：
 * 可观测计数要能回答「这个插件在总线上还剩几个监听器」，投递要能回答「这个订阅者挑哪几个词」。
 */
const listeners = new Map()

/**
 * 订阅词归一（批次66）：非数组或空数组一律当作「不挑词」——与不传 `subscriptions` 完全一致，
 * 「谁没声明订阅词」的排除归调用方（mcpSurface 的 subscribedCarriers 名单），不在这里再造一道闸。
 * 数组里的词按字符串收；拼错的词不会有任何 kind 与它同构（PROJECT_EVENT_TOPICS 里查不到），
 * 于是那个订阅者如实什么都收不到——不猜近义，也不静默降级成「全收」。
 */
function normalizeTopics(value) {
  if (!Array.isArray(value) || !value.length) return null
  const topics = new Set(value.map((topic) => String(topic ?? '').trim()).filter(Boolean))
  return topics.size ? topics : null
}

/** root 归一：同一根的不同写法（尾分隔符、相对路径）必须落到同一个键，否则同 root 广播会漏。 */
function rootKey(root) {
  const text = String(root ?? '').trim()
  if (!text) return ''
  try {
    return resolvePath(text)
  } catch {
    return text
  }
}

/**
 * 写盘路径 → 事件类别。只认首段目录名与 .pinax 下的两类元数据；
 * 认不出（日志／项目文件／未知目录）就返回 null——不发「某处变了」这种没有信息量的事件。
 */
export function projectEventKindForPath(relativePath) {
  const text = String(relativePath ?? '').replaceAll('\\', '/').replace(/^\.\//u, '').replace(/^\/+/u, '')
  if (!text) return null
  if (text === '.pinax/proposals' || text.startsWith('.pinax/proposals/')) return 'proposals-changed'
  if (text === '.pinax/sessions' || text.startsWith('.pinax/sessions/')) return 'sessions-changed'
  const first = text.split('/')[0]
  return DIRECTORY_KINDS[first] ?? null
}

/**
 * 订阅一个项目的变更。返回退订函数（幂等）。
 * root 为空或 handler 不是函数时返回空退订——调用方不需要先判空。
 * 第三个参数 `{ owner }` 是批次51 的可观测归属：传了之后 `projectEventSubscriberCount(root, owner)`
 * 就能单独回答「这个插件还剩几个监听器」；老调用方不传，行为与以前一致。
 * 批次66 再加一个可选的 `{ subscriptions }`：载体清单里那几个订阅词。给了就只收该词覆盖的 kind，
 * 不给（或给空）就是全收——批次37／39 那两条宿主订阅都没给，行为逐字不变。
 */
export function subscribeProjectEvents(root, handler, options = {}) {
  const key = rootKey(root)
  if (!key || typeof handler !== 'function') return () => {}
  const owner = String(options?.owner ?? '').trim() || null
  const topics = normalizeTopics(options?.subscriptions)
  let set = listeners.get(key)
  if (!set) {
    set = new Map()
    listeners.set(key, set)
  }
  set.set(handler, { owner, topics })
  let active = true
  return () => {
    if (!active) return
    active = false
    const current = listeners.get(key)
    if (!current) return
    current.delete(handler)
    if (!current.size) listeners.delete(key)
  }
}

/**
 * 批次51：经注册表效应注册总线订阅——setup 立即订阅并交回退订函数，
 * 插件卸载/`disposeEffects(owner)` 时由注册表逆序回卷。返回注册表的 { ok } 信封。
 */
export function subscribeProjectEventsEffect(registry, pluginId, root, handler, label = null) {
  if (!registry || typeof registry.registerEffect !== 'function') {
    return fail('INVALID_INPUT', 'subscribeProjectEventsEffect 需要带 registerEffect 的注册表')
  }
  return registry.registerEffect(
    pluginId,
    () => subscribeProjectEvents(root, handler, { owner: pluginId }),
    label ?? `projectEvents:${rootKey(root) || '(空根)'}`
  )
}

/**
 * 广播一次项目变更。返回送达的订阅者数（0＝没人听，不是错误）。
 * `at` 缺省取此刻；订阅者拿到的是一份新拷贝，改它不会影响别人。
 *
 * 负载形状（批次66 定稿，spec v2 附录同一份）：`{ kind, topic, at, path }`——
 * - kind：投递面的细类别（PROJECT_EVENT_KINDS 七个）；
 * - topic：声明面的订阅词（PROJECT_EVENT_TOPICS 反查；认不出的 kind 为 null，不猜）；
 * - at：ISO 时刻；
 * - path：变化落在哪份相对路径，没有就 null（前五类历史上不带，仍按 null 摊平，订阅方拿到的键恒定四个）。
 * 挑词的订阅者（`{ subscriptions }`）只收到自己那几个词覆盖的 kind，不计入送达数。
 */
export function emitProjectEvent(root, event = {}) {
  const key = rootKey(root)
  const kind = String(event?.kind ?? '')
  if (!key || !kind) return 0
  const current = listeners.get(key)
  if (!current?.size) return 0
  const payload = {
    kind,
    topic: projectEventTopicForKind(kind),
    at: typeof event?.at === 'string' && event.at ? event.at : new Date().toISOString(),
    path: typeof event?.path === 'string' && event.path ? event.path : null
  }
  let delivered = 0
  for (const [handler, sub] of [...current.entries()]) {
    if (sub?.topics && !sub.topics.has(payload.topic)) continue
    try {
      handler({ ...payload })
      delivered += 1
    } catch {
      // 一个订阅者坏掉不拦别人：事件是旁路，提问与写入都不该被它拖住。
    }
  }
  return delivered
}

/**
 * 诊断与测试用的只读计数。
 * - `projectEventSubscriberCount(root)`：这个 root 此刻有几个订阅者；
 * - `projectEventSubscriberCount(root, owner)`：其中属于该 owner 的有几个（批次51 的硬断言用）。
 */
export function projectEventSubscriberCount(root, owner = null) {
  const set = listeners.get(rootKey(root))
  if (!set) return 0
  if (owner === null || owner === undefined) return set.size
  const wanted = String(owner)
  let count = 0
  for (const sub of set.values()) if (sub?.owner === wanted) count += 1
  return count
}

/** 摘掉一个 root 的全部订阅（关项目／运行时 stop 时用；不传 root 就清空整张表，测试用）。 */
export function clearProjectEvents(root = null) {
  if (root === null || root === undefined) {
    listeners.clear()
    return
  }
  const key = rootKey(root)
  if (key) listeners.delete(key)
}
