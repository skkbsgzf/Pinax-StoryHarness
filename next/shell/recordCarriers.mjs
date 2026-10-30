/**
 * 记录型载体的外壳对照表（批次40 · M4／M5）。
 *
 * 素材／漫画／视频／体验／联机这五栏共用同一套界面：左边一棵记录树、中间一条记录详情／编辑。
 * 界面不该硬编码五套分支，所以把「载体 key → 目录／记录文件／工具前缀／可选类型与状态」
 * 收在这份纯数据里。它与各载体 manifest 的一致性由 next/tests/carrier-records.test.mjs 钉住
 * （目录、记录文件名、工具前缀增删都要两边一起改，谁先漂谁红）。
 *
 * 这里只放**界面需要的**字段：权限、能力、依赖闭包仍以 manifest 为唯一真源，不在这里复制。
 */
export const RECORD_CARRIERS = Object.freeze({
  material: Object.freeze({
    key: 'material',
    title: '素材',
    dir: '素材',
    file: '素材.json',
    toolPrefix: 'pinax_material',
    types: Object.freeze(['inspiration', 'draft-prose', 'event', 'character-fact', 'worldbook-draft', 'storyboard-seed', 'reference-image']),
    statuses: Object.freeze(['inbox', 'accepted', 'rejected', 'archived']),
    defaultType: 'inspiration',
    defaultStatus: 'inbox'
  }),
  comic: Object.freeze({
    key: 'comic',
    title: '漫画',
    dir: '漫画',
    file: '漫画.json',
    toolPrefix: 'pinax_comic',
    types: Object.freeze(['comic-page', 'comic-script', 'note']),
    statuses: Object.freeze(['draft', 'ready', 'archived']),
    defaultType: 'comic-page',
    defaultStatus: 'draft'
  }),
  video: Object.freeze({
    key: 'video',
    title: '视频',
    dir: '视频',
    file: '视频.json',
    toolPrefix: 'pinax_video',
    types: Object.freeze(['shot', 'storyboard', 'clip', 'audio', 'note']),
    statuses: Object.freeze(['draft', 'rendering', 'ready', 'archived']),
    defaultType: 'shot',
    defaultStatus: 'draft'
  }),
  experience: Object.freeze({
    key: 'experience',
    title: '体验',
    dir: '体验',
    file: '体验.json',
    toolPrefix: 'pinax_experience',
    types: Object.freeze(['scenario', 'session', 'run', 'note']),
    statuses: Object.freeze(['draft', 'running', 'ended', 'archived']),
    defaultType: 'session',
    defaultStatus: 'draft'
  }),
  online: Object.freeze({
    key: 'online',
    title: '联机',
    dir: '联机',
    file: '联机.json',
    toolPrefix: 'pinax_online',
    types: Object.freeze(['room', 'member', 'invite', 'note']),
    statuses: Object.freeze(['open', 'closed', 'archived']),
    defaultType: 'room',
    defaultStatus: 'open'
  })
})

export const RECORD_CARRIER_KEYS = Object.freeze(Object.keys(RECORD_CARRIERS))

/** pane id 的首段就是载体 key（material.board／material.editor…）。 */
export function recordCarrierOfPaneId(paneId) {
  const key = String(paneId ?? '').split('.')[0]
  return RECORD_CARRIERS[key] ?? null
}

/** 每棵记录树在 loadedTrees 里的名字：与章节／条目等既有树名并列，刷新映射按它筛。 */
export function recordTreeKey(key) {
  return `records:${key}`
}

export default { RECORD_CARRIERS, RECORD_CARRIER_KEYS, recordCarrierOfPaneId, recordTreeKey }
