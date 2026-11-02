import { BUILT_IN_CARRIER_TRUST, loadBuiltInCarriersFromDir, resolveBuiltInCarriersDir } from '../kernel/pluginLoader.mjs'

/**
 * 随框架发布的载体（批次65b 起＝**随包 id 清单**，不再是实现数组）。
 *
 * 批次65b 之前这里是三十一条静态 import ＋十一份手写工厂：装一块新载体要改这个中心文件，
 * 门禁里还得钉一条「length === 11」。框架计划 J2 把这件事倒过来——**内置只是「随包已安装」**：
 * 装载走 next/kernel/pluginLoader.mjs 的 `loadBuiltInCarriersFromDir`（与外部插件同一扇「从盘上发现」的门），
 * 本文件只留三样东西：
 *   1) 随包 id 清单（顺序有语义：竖条顺序＝注册顺序，协议 v1.1-A 钉死，readdir 给不了这个顺序）；
 *   2) 装载入口 loadBuiltInCarriers / loadBuiltInCarrierPlugins（boot、验收、门禁都走它，一条路）；
 *   3) 信任档 BUILT_IN_CARRIER_TRUST（第一方随包＝t1，与内核缺省一致）。
 * 加一块载体从此＝往货架放一个目录 ＋ 在这里追加一枚 id（要让它进竖条的固有位置才需要动顺序）。
 * 缺了第 2 步不会静默少一格：门禁「随包 id 清单与盘上目录一致」直接红。
 *
 * 历史口径（M2 起逐块加栏；批次60 起十一块：设定／资料合并为「设定与资料」）：
 *   novel 正文/ · outline 大纲/ · notes 构思/ · worldbook 世界书/ · script 剧本/ · dossier 资料/＋约束/
 *   material 素材/ · comic 漫画/ · video 视频/ · experience 体验/ · online 联机/（后五块都是记录型，M4／M5）
 * 每块的清单与实现住在 next/carriers/<名字>/（manifest.mjs／tools.mjs／context.mjs），
 * 面板页 ui/ 与作者须知 AGENT.md 也住在同一目录——装载器把那个目录原样登记成 meta.dir。
 *
 * impl 的两个可选工厂（约定，装载器按它取件）：
 *   impl.tools(projectCtx)   —— 进运行时工具面的工具（项目打开后调用，拿这个项目的文件服务）；
 *   impl.blocks(projectCtx)  —— 上下文信封的素材块构建器（没有 context.mjs 的栏＝不谎报素材块）。
 */
export const BUILT_IN_CARRIER_IDS = Object.freeze([
  'pinax.carrier.novel',
  'pinax.carrier.outline',
  'pinax.carrier.notes',
  'pinax.carrier.worldbook',
  'pinax.carrier.script',
  'pinax.carrier.dossier',
  'pinax.carrier.material',
  'pinax.carrier.comic',
  'pinax.carrier.video',
  'pinax.carrier.experience',
  'pinax.carrier.online'
])

export { BUILT_IN_CARRIER_TRUST }

/**
 * 装载随包载体（boot／验收／门禁的唯一入口）。返回 { dir, loaded, skipped }——
 * 原始实况，调用方自己决定怎么用；`loadBuiltInCarrierPlugins` 是它的「要么全装要么报错」版本。
 */
export async function loadBuiltInCarriers({ dir = null, registry = null, env = process.env, moduleDir = null } = {}) {
  const base = dir ?? await resolveBuiltInCarriersDir(moduleDir ? { env, moduleDir } : { env })
  const { loaded, skipped } = await loadBuiltInCarriersFromDir(base, { registry, order: BUILT_IN_CARRIER_IDS })
  return { dir: base, loaded, skipped }
}

/**
 * 随包载体装载的「要么全装要么报错」版本：返回 `[{ manifest, impl, meta }]`（与批次65b 之前的
 * BUILT_IN_CARRIER_PLUGINS 逐字同形，所以注册路径不必改），任一装不上就抛——
 * 内置少一块不是局部故障，是竖条少一格、工具面少一把的装配事故，静默少一块比开机报错坏得多。
 * 抛错里带 dir 与逐块理由，照着就能诊断（doctor 的外部装载判例同一套纪律：理由不许哑）。
 */
export async function loadBuiltInCarrierPlugins(options = {}) {
  const { dir, loaded, skipped } = await loadBuiltInCarriers(options)
  const missing = BUILT_IN_CARRIER_IDS.filter((id) => !loaded.some((entry) => entry.carrierId === id))
  if (skipped.length || missing.length) {
    const reasons = [
      ...skipped.map((entry) => `跳过 ${entry.carrierId}（${entry.stage}）：${entry.reason}`),
      ...missing.map((id) => `随包清单里的 ${id} 在盘上没有`)
    ]
    const error = new Error(`随包载体装载不完整（货架 ${dir}）：${reasons.join('；')}`)
    error.details = { dir, skipped, missing }
    throw error
  }
  return Object.freeze(loaded.map((entry) => Object.freeze({ manifest: entry.manifest, impl: entry.impl, meta: entry.meta })))
}
