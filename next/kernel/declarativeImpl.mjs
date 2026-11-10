import { ok } from './errors.mjs'

/**
 * 批次65a · 外部声明型插件（`.pinax/plugins/<id>/manifest.json`，只有清单、没有代码）。
 *
 * 本批是外部插件的第一波：装载面正式化，但形态收死在「声明型」——
 * 第三方 JS 一律不执行，impl 永远由内核这份工厂生成。
 * 工单预裁 Q4「第一档不开第三方 JS」落在这里：
 *   tools    要 JS 实现——声明了没人应答，拒；
 *   services 要宿主 spawn 子进程——沙箱未裁，拒；
 *   mcp      要起进程或连端点——沙箱未裁，拒；
 *   entry    第三方 HTML 面板——沙箱未裁，拒；
 *   commands 本批暂空：声明型命令的执行路径还没设计出来，「声明了却不执行」违反既有纪律，非空即拒。
 * 数据面照常开放：dataDirs 走 fileService 既有三闸，panes 只准用宿主八视图词表里的类型名，
 * settings 走 settingsStore 的声明白名单（注册表现取，无第二份清单），agentMd 是纯文本随上下文人包。
 *
 * 拒装错误码不借 NEXT_ERROR_CODES（errors.mjs 不在本批允许文件里，也不该把外部形态码混进内核总表）：
 * 手工 PINAX_ 前缀，与 settingsStore 的配置域码同一做法。
 */
export const DECLARATIVE_FORM = 'external-declarative'
export const DECLARATIVE_REFUSED_CODE = 'PINAX_DECLARATIVE_FIELD_REFUSED'

/** 逐字段拒装理由（记账矩阵与 doctor 的 fix 文案都吃这一份，不在别处抄第二遍）。 */
export const DECLARATIVE_REFUSED_FIELDS = Object.freeze([
  { field: 'tools', reason: '工具需要 JS 实现：外部声明型插件没有代码，声明了无人应答' },
  { field: 'services', reason: '服务需要宿主起子进程：沙箱未裁' },
  { field: 'mcp', reason: '外部 MCP 要起进程或连端点：沙箱未裁' },
  { field: 'entry', reason: '自带面板是第三方 HTML：沙箱未裁' },
  { field: 'commands', reason: '本批暂空：声明型命令没有执行路径，声明了不执行即拒' }
])

function hasContent(value) {
  return Array.isArray(value) ? value.length > 0 : Boolean(value)
}

/**
 * 声明型闸：跑在 validateCarrierManifest 之后，吃归一清单。
 * 空 tools/services/mcp/commands 与 null entry 是合法声明（@4 归一后就是 []／null），只有「有内容」才拒。
 */
export function gateDeclarativeManifest(manifest) {
  const refused = []
  for (const { field, reason } of DECLARATIVE_REFUSED_FIELDS) {
    if (hasContent(manifest?.[field])) refused.push({ field, reason })
  }
  if (refused.length) {
    return {
      ok: false,
      error: {
        code: DECLARATIVE_REFUSED_CODE,
        message: `外部声明型插件不收这些声明字段：${refused.map((item) => item.field).join(' / ')}`,
        details: { pluginId: String(manifest?.id ?? ''), refused }
      }
    }
  }
  return ok({ form: DECLARATIVE_FORM })
}

/**
 * 内核声明式 impl 工厂：外部插件唯一的 impl 来源（impl.mjs 就算在盘上也不 import——不执行第三方 JS）。
 * 效应合同不许跳过：setup 必须交回 disposer，哪怕这一份是无副作用的 noop。
 * 「注册了没法拆」= INVALID_EFFECT，宁可不注册也不留半截状态；所以声明型照注册、照交回，卸载链才有东西可拆。
 */
export function createDeclarativeImpl(manifest) {
  return {
    declarative: true,
    form: DECLARATIVE_FORM,
    pluginId: String(manifest?.id ?? ''),
    setup() {
      return () => {}
    }
  }
}

export function isDeclarativeImpl(impl) {
  return impl?.declarative === true
}
