/**
 * 建库／导库两整页的共享工具（前端工单 A-4／A-6）。
 * 纯函数与常量：无 Vue、无 IPC——组件只消费；形态识别规则不在这里（那是适配器的事）。
 */

/** 逐类导入的类别清单（与 projectImportAdapter.IMPORT_SOURCE_CATEGORIES 同名同序）。 */
export const IMPORT_CLASSES = Object.freeze([
  { category: 'chapter', label: '正文（小说稿）', carrier: 'pinax.carrier.novel' },
  { category: 'script', label: '剧本', carrier: 'pinax.carrier.script' },
  { category: 'worldbook', label: '世界书', carrier: 'pinax.carrier.worldbook' },
  { category: 'outline', label: '大纲', carrier: 'pinax.carrier.outline' },
  { category: 'rule', label: '约束', carrier: 'pinax.carrier.dossier' },
  { category: 'idea', label: '构思', carrier: 'pinax.carrier.notes' },
  { category: 'source', label: '资料', carrier: 'pinax.carrier.dossier' },
  { category: 'log', label: '日志', carrier: null }
])

/** 导入计划的 decision → 人话（顺序即展示顺序）。 */
export const DECISION_ORDER = Object.freeze([
  ['chapter', '正文'],
  ['script', '剧本'],
  ['outline', '大纲'],
  ['outline-json', '大纲（结构化）'],
  ['worldbook', '世界书'],
  ['rule', '约束'],
  ['idea', '构思'],
  ['source', '资料'],
  ['source-json', '资料（归档 JSON）'],
  ['material', '资料（章节衍生）'],
  ['auxiliary', '资料（世界书辅助）'],
  ['log', '日志']
])

/** 目录路径的最后一段（作为默认库名）。 */
export function folderName(fullPath) {
  return String(fullPath ?? '').split(/[\\/]/).filter(Boolean).pop() ?? ''
}

/** Windows／POSIX 通吃的路径同判（大小写不敏感，尾分隔符无关）。 */
export function samePath(a, b) {
  return String(a ?? '').replace(/[\\/]+$/u, '').toLowerCase() === String(b ?? '').replace(/[\\/]+$/u, '').toLowerCase()
}

/** 库名校验（工单 A-4：1–120 字）。返回 null 或人话错误。 */
export function validateLibraryName(name) {
  const text = String(name ?? '').trim()
  if (!text) return '给库起个名字（1–120 字），或者就用文件夹名。'
  if (text.length > 120) return '库名最多 120 字，请缩短后再创建。'
  return null
}

/**
 * 打开失败的错误码 → 人话与修复动作（工单 A-5）。
 * 返回 { title, detail, action }：action ∈ 'create-here'（在此新建库）| 'import-here'（导入这个文件夹）
 * | 'pick-primary'（去选主模块）| 'open-modules'（打开模块管理）| null（无修复动作）。
 * 错误码原文只在 detail 里出现，不上主文案（工单 A-5 明文）。
 * fsInfo＝主进程在打开失败时附带的 { hasPinax, dirEmpty }（缺省按「未知」处理，给通用动作）。
 */
export function describeOpenFailure(error, fsInfo = {}) {
  const code = String(error?.code ?? '')
  const hasPinax = fsInfo.hasPinax
  const dirEmpty = fsInfo.dirEmpty
  if (!hasPinax && dirEmpty === true) {
    return {
      title: '这个文件夹还不是库',
      detail: '里面没有找到库标记，也没有其他文件。',
      action: 'create-here',
      actionLabel: '在这里新建库'
    }
  }
  if (!hasPinax && dirEmpty === false) {
    return {
      title: '这个文件夹里已经有稿子',
      detail: '可以新建一个库并把稿子复制进去：原文件夹一个字都不会动。',
      action: 'import-here',
      actionLabel: '导入这个文件夹'
    }
  }
  if (code === 'PRIMARY_CARRIER_MISSING') {
    return {
      title: '这个库还没选主模块',
      detail: '选一个主模块（小说或剧本）就能开始写了。',
      action: 'pick-primary',
      actionLabel: '去选'
    }
  }
  if (code === 'DEPENDENCY_UNMET') {
    return {
      title: '这个库缺一些模块',
      detail: String(error?.message ?? '').replace(/DEPENDENCY_UNMET[:：]?\s*/u, '') || '有模块的依赖没有就位。',
      action: 'open-modules',
      actionLabel: '打开模块管理'
    }
  }
  return {
    title: '这个库打不开',
    detail: String(error?.message ?? '未知原因'),
    action: null,
    actionLabel: null
  }
}
