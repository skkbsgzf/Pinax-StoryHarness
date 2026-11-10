/**
 * slash 命令（批次27 · 任务二）：四条预设问句 ＋ 各自的 context.omit。
 *
 * 诚实剪裁：omit 里的块种只是「这次提问跳过这一块素材」——信封那头本来就把跳过的块记成
 * 一条 warning（next/runtime/contextProfiles.mjs 的 `context.omit` 既有能力），
 * 不是「专注模式」，也不假装模型换了人。当前档案没有那个块种时 omit 无害（同一条 warning 路）。
 *
 * 批次25 的四条提示只显示不路由；这一份把它升级成真路由：
 *   - 提示层可点/可 Enter 选中，选中把模板填进草稿（命令词本身不留在草稿里）；
 *   - 发送时若草稿以命令词开头（作者自己敲的），resolveSlash 剥掉命令词并带回命令本身，
 *     RuntimeDock 把 omit 并进 runtimeAsk 的 context.omit，消息流里 user 那行挂命令徽章。
 *
 * 纯数据模块，不 import Vue。
 */

/**
 * 四条命令：name＝命令词，desc＝提示层的一句话，template＝填进草稿的问句，
 * omit＝这次提问要跳过的上下文块种（块种清单见 shared/agentContextProfiles.js）。
 * skill（M2.5-B）：命令指向的方法说明书名。命令是入口，技能是方法，两者不合并——
 * 只有「确实有对应技能包」的命令才带这一项，其余留空，别为凑齐而虚构方法。
 */
export const SLASH_COMMANDS = Object.freeze([
  Object.freeze({
    name: '/审阅',
    desc: '审阅当前正文',
    template: '请以审稿人视角审阅当前正文：问题按严重度列出，每条配一句可执行动作。',
    omit: Object.freeze([]),
    skill: null
  }),
  Object.freeze({
    name: '/大纲',
    desc: '梳理大纲结构',
    template: '请梳理当前项目的大纲结构：主线走向、悬而未决的线头、结构上的风险。',
    omit: Object.freeze(['scene', 'memory', 'history']),
    skill: 'outline-restructure'
  }),
  Object.freeze({
    name: '/总结',
    desc: '总结当前项目',
    template: '请总结当前项目的核心内容：一句话主线＋各板块要点。',
    omit: Object.freeze(['style']),
    skill: null
  }),
  Object.freeze({
    name: '/资料',
    desc: '只依据本书资料',
    template: '请只依据本书资料（世界书/资料/规则）回答：',
    omit: Object.freeze(['scene', 'memory', 'outline']),
    skill: null
  })
])

/** 草稿是不是「正在敲命令」：只有开头那个 / 才算，正文里的 / 不弹提示。 */
export function isSlashDraft(draft) {
  return String(draft ?? '').trimStart().startsWith('/')
}

/**
 * 识别草稿开头的命令词。
 * 边界按「命令词之后是空白或结尾」判：`/资料库怎么建` 不是 `/资料` 命令，仍是一句普通提问。
 * 返回 { command, rest }，rest 是命令词之后的正文（未剥正文里的 token——那是 RuntimeDock 的事）。
 */
export function resolveSlash(draft) {
  const text = String(draft ?? '').trimStart()
  if (!text.startsWith('/')) return null
  for (const command of SLASH_COMMANDS) {
    if (!text.startsWith(command.name)) continue
    const next = text.slice(command.name.length, command.name.length + 1)
    if (next && !/\s/u.test(next)) continue
    return { command, rest: text.slice(command.name.length).trim() }
  }
  return null
}

/**
 * 一条 user 消息该带哪些字段（命令徽章 ＋ 剥掉命令词后的正文 ＋ 这次要 omit 的块种）。
 * 徽章字段落成 `command: '/资料'`，与消息 schema 的其它字段一样是 JSON 安全的。
 */
export function slashMessageFields(command, rest) {
  const text = String(rest ?? '').trim()
  return {
    text,
    command: command?.name ? String(command.name) : '',
    omit: Array.isArray(command?.omit) ? [...command.omit] : []
  }
}
