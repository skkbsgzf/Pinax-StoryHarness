import { NOVEL_CARRIER, NOVEL_CARRIER_ID } from './novel/manifest.mjs'
import { NOVEL_TOOL_NAMES, createNovelTools } from './novel/tools.mjs'
import { createNovelBlocks } from './novel/context.mjs'
import { OUTLINE_CARRIER, OUTLINE_CARRIER_ID } from './outline/manifest.mjs'
import { OUTLINE_TOOL_NAMES, createOutlineTools } from './outline/tools.mjs'
import { createOutlineBlocks } from './outline/context.mjs'
import { NOTES_CARRIER, NOTES_CARRIER_ID } from './notes/manifest.mjs'
import { NOTES_TOOL_NAMES, createNotesTools } from './notes/tools.mjs'
import { WORLDBOOK_CARRIER, WORLDBOOK_CARRIER_ID } from './worldbook/manifest.mjs'
import { WORLDBOOK_TOOL_NAMES, createWorldbookTools } from './worldbook/tools.mjs'
import { createWorldbookBlocks, readWorldbookEntries } from './worldbook/context.mjs'
import { SCRIPT_CARRIER, SCRIPT_CARRIER_ID } from './script/manifest.mjs'
import { SCRIPT_TOOL_NAMES, createScriptTools } from './script/tools.mjs'
import { createScriptBlocks } from './script/context.mjs'
import { SETTING_CARRIER, SETTING_CARRIER_ID } from './setting/manifest.mjs'
import { SETTING_TOOL_NAMES, createSettingTools } from './setting/tools.mjs'
import { createSettingBlocks } from './setting/context.mjs'
import { REFERENCE_CARRIER, REFERENCE_CARRIER_ID } from './reference/manifest.mjs'
import { REFERENCE_TOOL_NAMES, createReferenceTools } from './reference/tools.mjs'
import { createReferenceBlocks } from './reference/context.mjs'

/**
 * 随框架发布的载体清单（M2 起；协议 v1.1-A 起是六块）。
 * M1 的口径是「carriers/ 目录为空，任何插件都不随框架发布」；M2 第一批放进两块：
 * 小说（正文/大纲/构思）与设定（世界书/约束）。
 * 工单G1 加第三块：资料（资料/，三把自有工具）——它补的是「资料/ 在骨架里却没人认领」的缺口；
 * 协议 v1.1-A（作者 2026-10-28 裁定）把混合板拆开：一个载体＝竖条一格＝一棵纯粹的本域内容树。
 *   novel      正文/（章节 ＋ 随正文的提案审阅）
 *   outline    大纲/（大纲树）
 *   notes      构思/（构思清单）
 *   worldbook  世界书/（条目树）
 *   script     剧本/（剧本篇目；批次26 M6 提前，排在 worldbook 之后）
 *   setting    约束/（约束清单）
 *   reference  资料/（资料清单）
 * 竖条顺序即注册顺序（v1.1-A：v1 按注册顺序＝小说/大纲/构思/世界书/剧本/设定/资料）。
 * 每个包＝一份清单 ＋ 一个 impl，impl 只有两个可选工厂：
 *   impl.tools(projectCtx)   —— 进运行时工具面的工具（项目打开后调用，要的是这个项目的文件服务）；
 *   impl.blocks(projectCtx)  —— 运行时组上下文信封时的素材块构建器（{ kind: async (askCtx) => 素材包 }）。
 * 两个工厂都在**项目打开后**才调用：工具与素材块拿的都是这个项目的文件服务句柄（三道闸在那边），
 * 不是进程级的全局句柄——这是「载体＝一块文件夹注册」在实现层的说法。
 */
export const NOVEL_CARRIER_TRUST = 't1'
export const OUTLINE_CARRIER_TRUST = 't1'
export const NOTES_CARRIER_TRUST = 't1'
export const WORLDBOOK_CARRIER_TRUST = 't1'
export const SCRIPT_CARRIER_TRUST = 't1'
export const SETTING_CARRIER_TRUST = 't1'
export const REFERENCE_CARRIER_TRUST = 't1'

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

export function outlineCarrierPlugin() {
  return {
    manifest: OUTLINE_CARRIER,
    impl: {
      source: 'next/carriers/outline',
      // 一把从内核认领的只读工具（pinax_outline_read）＋一把自有写入口（pinax_outline_save）；
      // 一个上下文块提供者（outline）。读盘过文件服务的归属/作用域/并发三道闸。
      tools: (context = {}) => createOutlineTools({ ...context, pluginId: context.pluginId ?? OUTLINE_CARRIER_ID }),
      blocks: (context = {}) => createOutlineBlocks({ ...context, pluginId: context.pluginId ?? OUTLINE_CARRIER_ID })
    },
    meta: { trust: OUTLINE_CARRIER_TRUST, source: 'next/carriers/outline' }
  }
}

export function notesCarrierPlugin() {
  return {
    manifest: NOTES_CARRIER,
    impl: {
      source: 'next/carriers/notes',
      // 两把自有工具（列／写）。构思目前不提供上下文块：清单里 providers 是空数组，
      // 这里也就不挂 blocks 工厂——声明一块不存在的素材比缺席更糟。
      tools: (context = {}) => createNotesTools({ ...context, pluginId: context.pluginId ?? NOTES_CARRIER_ID })
    },
    meta: { trust: NOTES_CARRIER_TRUST, source: 'next/carriers/notes' }
  }
}

export function worldbookCarrierPlugin() {
  return {
    manifest: WORLDBOOK_CARRIER,
    impl: {
      source: 'next/carriers/worldbook',
      // 两把从内核认领的只读工具（世界书清单/读取）＋自有写入口 pinax_worldbook_save（带 meta 元数据口）；
      // 一个上下文块提供者（worldbook）。约束不在这一栏（协议 v1.1-A）。
      tools: (context = {}) => createWorldbookTools({ ...context, pluginId: context.pluginId ?? WORLDBOOK_CARRIER_ID }),
      blocks: (context = {}) => createWorldbookBlocks({ ...context, pluginId: context.pluginId ?? WORLDBOOK_CARRIER_ID })
    },
    meta: { trust: WORLDBOOK_CARRIER_TRUST, source: 'next/carriers/worldbook' }
  }
}

export function scriptCarrierPlugin() {
  return {
    manifest: SCRIPT_CARRIER,
    impl: {
      source: 'next/carriers/script',
      // 三把自有工具（列／读／写）＋一个上下文块提供者（script／references 别名）：
      // 剧本/ 的权限由这块板块自己申请，运行时不越过去开文件（与小说／资料同一条规矩）。
      tools: (context = {}) => createScriptTools({ ...context, pluginId: context.pluginId ?? SCRIPT_CARRIER_ID }),
      blocks: (context = {}) => createScriptBlocks({ ...context, pluginId: context.pluginId ?? SCRIPT_CARRIER_ID })
    },
    meta: { trust: SCRIPT_CARRIER_TRUST, source: 'next/carriers/script' }
  }
}

export function settingCarrierPlugin() {
  return {
    manifest: SETTING_CARRIER,
    impl: {
      source: 'next/carriers/setting',
      // 约束这一对（pinax_rule_list / pinax_rule_save）＋两个上下文块提供者（rules/style）。
      // 世界书三把随协议 v1.1-A 迁去 worldbook 载体。
      tools: (context = {}) => createSettingTools({ ...context, pluginId: context.pluginId ?? SETTING_CARRIER_ID }),
      blocks: (context = {}) => createSettingBlocks({ ...context, pluginId: context.pluginId ?? SETTING_CARRIER_ID })
    },
    meta: { trust: SETTING_CARRIER_TRUST, source: 'next/carriers/setting' }
  }
}

export function referenceCarrierPlugin() {
  return {
    manifest: REFERENCE_CARRIER,
    impl: {
      source: 'next/carriers/reference',
      // 三把自有工具（列／读／写）＋一把检索（H2）＋一个上下文块提供者：资料/ 的权限由这块板块自己申请，
      // 运行时不越过去开文件（与小说／设定同一条规矩）。
      tools: (context = {}) => createReferenceTools({ ...context, pluginId: context.pluginId ?? REFERENCE_CARRIER_ID }),
      blocks: (context = {}) => createReferenceBlocks({ ...context, pluginId: context.pluginId ?? REFERENCE_CARRIER_ID })
    },
    meta: { trust: REFERENCE_CARRIER_TRUST, source: 'next/carriers/reference' }
  }
}

/** 竖条顺序＝注册顺序（协议 v1.1-A；批次26 起剧本排在 worldbook 之后）。 */
export const BUILT_IN_CARRIER_PLUGINS = Object.freeze([
  novelCarrierPlugin(),
  outlineCarrierPlugin(),
  notesCarrierPlugin(),
  worldbookCarrierPlugin(),
  scriptCarrierPlugin(),
  settingCarrierPlugin(),
  referenceCarrierPlugin()
])
export const BUILT_IN_CARRIER_IDS = Object.freeze(BUILT_IN_CARRIER_PLUGINS.map((item) => item.manifest.id))

/** 随框架发布的载体认领面（门禁核「只增不减」和「认领的都是内核已有的名字」时用）。 */
export const BUILT_IN_CLAIMED_TOOLS = Object.freeze([
  ...NOVEL_TOOL_NAMES,
  ...OUTLINE_TOOL_NAMES,
  ...NOTES_TOOL_NAMES,
  ...WORLDBOOK_TOOL_NAMES,
  ...SCRIPT_TOOL_NAMES,
  ...SETTING_TOOL_NAMES,
  ...REFERENCE_TOOL_NAMES
])

export {
  NOVEL_CARRIER,
  NOVEL_CARRIER_ID,
  NOVEL_TOOL_NAMES,
  createNovelTools,
  createNovelBlocks,
  OUTLINE_CARRIER,
  OUTLINE_CARRIER_ID,
  OUTLINE_TOOL_NAMES,
  createOutlineTools,
  createOutlineBlocks,
  NOTES_CARRIER,
  NOTES_CARRIER_ID,
  NOTES_TOOL_NAMES,
  createNotesTools,
  WORLDBOOK_CARRIER,
  WORLDBOOK_CARRIER_ID,
  WORLDBOOK_TOOL_NAMES,
  createWorldbookTools,
  createWorldbookBlocks,
  readWorldbookEntries,
  SCRIPT_CARRIER,
  SCRIPT_CARRIER_ID,
  SCRIPT_TOOL_NAMES,
  createScriptTools,
  createScriptBlocks,
  SETTING_CARRIER,
  SETTING_CARRIER_ID,
  SETTING_TOOL_NAMES,
  createSettingTools,
  createSettingBlocks,
  REFERENCE_CARRIER,
  REFERENCE_CARRIER_ID,
  REFERENCE_TOOL_NAMES,
  createReferenceTools,
  createReferenceBlocks
}

/** 旧名字（next/index.mjs 再导出）：世界书取数口迁去 worldbook/context.mjs 后保持同名可用。 */
export { readWorldbookEntries as readSettingEntries } from './worldbook/context.mjs'
