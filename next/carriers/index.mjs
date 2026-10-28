import { NOVEL_CARRIER, NOVEL_CARRIER_ID } from './novel/manifest.mjs'
import { NOVEL_TOOL_NAMES, createNovelTools } from './novel/tools.mjs'
import { createNovelBlocks } from './novel/context.mjs'
import { SETTING_CARRIER, SETTING_CARRIER_ID } from './setting/manifest.mjs'
import { SETTING_TOOL_NAMES, createSettingTools } from './setting/tools.mjs'
import { createSettingBlocks, readSettingEntries } from './setting/context.mjs'

/**
 * 随框架发布的载体清单（M2 起）。
 * M1 的口径是「carriers/ 目录为空，任何插件都不随框架发布」；M2 第一批放进两块：
 * 小说（正文/大纲/构思，认领 3 把只读＋1 把自有写入口）与设定（世界书/约束，只认领 2 把只读）。
 * 每个包＝一份清单 ＋ 一个 impl，impl 只有两个可选工厂：
 *   impl.tools(projectCtx)   —— 进运行时工具面的工具（项目打开后调用，要的是这个项目的文件服务）；
 *   impl.blocks(projectCtx)  —— 运行时组上下文信封时的素材块构建器（{ kind: async (askCtx) => 素材包 }）。
 * 两个工厂都在**项目打开后**才调用：工具与素材块拿的都是这个项目的文件服务句柄（三道闸在那边），
 * 不是进程级的全局句柄——这是「载体＝一块文件夹注册」在实现层的说法。
 */
export const NOVEL_CARRIER_TRUST = 't1'
export const SETTING_CARRIER_TRUST = 't1'

export function novelCarrierPlugin() {
  return {
    manifest: NOVEL_CARRIER,
    impl: {
      source: 'next/carriers/novel',
      tools: (context = {}) => createNovelTools({ ...context, pluginId: context.pluginId ?? NOVEL_CARRIER_ID }),
      blocks: (context = {}) => createNovelBlocks({ ...context, pluginId: context.pluginId ?? NOVEL_CARRIER_ID })
    },
    meta: { trust: NOVEL_CARRIER_TRUST, source: 'next/carriers/novel' }
  }
}

export function settingCarrierPlugin() {
  return {
    manifest: SETTING_CARRIER,
    impl: {
      source: 'next/carriers/setting',
      // 两把从内核认领的只读工具（世界书清单/读取）＋三个上下文块提供者；
      // 批次 11 起合同升级：file:世界书:rw ＋自有写入口 pinax_worldbook_save（契约条目保留 frontmatter，裁定 dwfq-f2369ffa-2）；约束/仍只读。
      tools: (context = {}) => createSettingTools({ ...context, pluginId: context.pluginId ?? SETTING_CARRIER_ID }),
      blocks: (context = {}) => createSettingBlocks({ ...context, pluginId: context.pluginId ?? SETTING_CARRIER_ID })
    },
    meta: { trust: SETTING_CARRIER_TRUST, source: 'next/carriers/setting' }
  }
}

export const BUILT_IN_CARRIER_PLUGINS = Object.freeze([novelCarrierPlugin(), settingCarrierPlugin()])
export const BUILT_IN_CARRIER_IDS = Object.freeze(BUILT_IN_CARRIER_PLUGINS.map((item) => item.manifest.id))

/** 随框架发布的载体认领面（门禁核「只增不减」和「认领的都是内核已有的名字」时用）。 */
export const BUILT_IN_CLAIMED_TOOLS = Object.freeze([...NOVEL_TOOL_NAMES, ...SETTING_TOOL_NAMES])

export {
  NOVEL_CARRIER,
  NOVEL_CARRIER_ID,
  NOVEL_TOOL_NAMES,
  createNovelTools,
  createNovelBlocks,
  SETTING_CARRIER,
  SETTING_CARRIER_ID,
  SETTING_TOOL_NAMES,
  createSettingTools,
  createSettingBlocks,
  readSettingEntries
}
