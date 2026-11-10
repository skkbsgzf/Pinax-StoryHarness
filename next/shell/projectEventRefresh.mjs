/**
 * 项目事件 → 板块树的刷新映射（批次39；批次40 加记录型载体）。
 *
 * 总线（批次37）只发 kind，不带路径：`entries-changed` 一处变更可能落在世界书／构思／约束／资料／剧本
 * 任何一棵树上，也可能落在素材／漫画／视频／体验／联机这五棵记录树上，所以它对应「条目型」树的全体；
 * `manuscript-changed` 只对应正文；`outline-changed` 只对应大纲。
 * `proposals-changed` 由提案审阅节自己消费（批次37），`sessions-changed` 暂无界面消费者——这里都不接。
 *
 * 只刷新 **loadedTrees 里已经取过数的那几棵**：为了一个后台变更去 loadEntries 会顺手打开第一条
 * （loadEntries 的既有行为），等于替作者做了他没做的选择。纯函数，node 轨可测。
 */
import { RECORD_CARRIER_KEYS, recordTreeKey } from './recordCarriers.mjs'

export const PROJECT_EVENT_TARGETS = Object.freeze({
  'manuscript-changed': Object.freeze(['chapters']),
  'outline-changed': Object.freeze(['outline']),
  'entries-changed': Object.freeze([
    'entries',
    'notes',
    'rules',
    'documents',
    'scripts',
    ...RECORD_CARRIER_KEYS.map(recordTreeKey)
  ]),
  'proposals-changed': Object.freeze([]),
  'sessions-changed': Object.freeze([])
})

/**
 * 某类事件该刷新哪几棵树。
 * loadedTrees 省略时返回该类事件的完整目标（AppNext 用它在订阅口先判「这类事件有没有人消费」）；
 * 传入时只留已经载入过的树。
 */
export function refreshTargetsFor(kind, loadedTrees = null) {
  const targets = PROJECT_EVENT_TARGETS[String(kind ?? '')]
  if (!targets || !targets.length) return []
  if (!loadedTrees) return [...targets]
  return targets.filter((target) => loadedTrees[target] === true)
}

export default { PROJECT_EVENT_TARGETS, refreshTargetsFor }
