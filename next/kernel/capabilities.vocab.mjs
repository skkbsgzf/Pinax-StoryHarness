/**
 * 能力词表定稿（M1 · WP1 收口项）。
 * 规范第 4 节 D3/D4 的传递闭包只能按能力算，不能按插件 id 算——所以词表必须先定死，
 * 否则「谁提供了 script.scenes」无从判定，闸门形同虚设。
 * canonicalDirs 只做提示与归档判定，不构成权限；权限一律来自 manifest.scopes。
 */
export const CAPABILITY_VERSION = '1'

export const CAPABILITIES = Object.freeze({
  'text.chapters': { title: '章节正文', canonicalDirs: ['正文', '文档'] },
  'outline.tree': { title: '大纲节点树', canonicalDirs: ['大纲'] },
  'setting.entries': { title: '设定条目（世界书）', canonicalDirs: ['世界书'] },
  'notes.ideas': { title: '构思与随想', canonicalDirs: ['构思'] },
  'reference.documents': { title: '资料与归档', canonicalDirs: ['资料'] },
  'lexicon.rules': { title: '词汇表口径', canonicalDirs: [] },
  'constraint.rules': { title: '约束与禁忌', canonicalDirs: ['约束'] },
  'log.journal': { title: '创作日志', canonicalDirs: ['日志'] },
  'script.scenes': { title: '剧本场景', canonicalDirs: ['剧本'] },
  'character.roster': { title: '人物表', canonicalDirs: ['人物'] },
  'location.board': { title: '场景板', canonicalDirs: ['场景'] },
  'storyboard.shots': { title: '分镜脚本', canonicalDirs: ['分镜'] },
  'media.assets': { title: '素材资产', canonicalDirs: ['素材', '资产'] },
  'video.render': { title: '出片与渲染', canonicalDirs: ['成片'] },
  'session.runs': { title: '体验会话（跑团/互动）', canonicalDirs: ['会话'] },
  'collaboration.rooms': { title: '联机房间', canonicalDirs: [] }
})

export const CAPABILITY_IDS = Object.freeze(Object.keys(CAPABILITIES))

export function isKnownCapability(id) {
  return Object.prototype.hasOwnProperty.call(CAPABILITIES, String(id || ''))
}

export function capabilityTitle(id) {
  return CAPABILITIES[id]?.title ?? id
}

/** 归档视图用：某个既不属于骨架、又没人声明的目录，给一句可读的猜测。 */
export function guessCapabilityByDir(dir) {
  const hit = CAPABILITY_IDS.find((id) => CAPABILITIES[id].canonicalDirs.includes(dir))
  return hit ?? null
}
