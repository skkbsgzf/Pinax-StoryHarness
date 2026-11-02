/**
 * 开窗落点的唯一决策口径（批次61 任务三，研究文档 §5.3 的代码化）。
 *
 * 纯函数：不吃 DOM、不吃 IPC、不碰状态机——给它「这块 pane 的声明 ＋ 现在的页列表 ＋ 页组」，
 * 它回一个动作。之所以要独立成一个模块，是因为在 v2 里"点一下载体"这件事有七条调用路径
 * （竖条、左树、看板卡、蓝链、检索命中、图谱节点、命令），每条各抄了一套「没有窗就开一扇浮窗」。
 * 从今往后这七条只问这里一次。
 *
 * 缺省语义（作者裁定①）：先切换、再分屏、浮窗只在用户显式指定时出现。
 * 所以本函数的返回值里**没有任何一档是"新建浮窗"**——浮窗只能经右键菜单的
 * 「浮出为窗」显式到达（作者裁定③，走 workspace.setForm）。
 *
 * multiplicity 的消费（作者裁定④：底座＋D 一轮，声明从此真生效）：
 *   single → 这块 pane 永远只有一条记录；换文档＝换那一页的内容（replace-page）
 *   keyed  → 按 resource 各开一页（全仓现值只有 worldbook.entries，keyField:'path'）
 *   list   → 会话级覆层小部件，按 single 办事
 *
 * `gesture` 本批恒为空对象：留这个形参是为了批次62（修饰键／中键／拖出）不再改函数签名。
 * 现在没有任何调用方该往里传东西。
 */

import { instanceIdFor, parseInstanceId } from './workspace.mjs'

/** 落点动作全集。 */
export const OPEN_ACTIONS = Object.freeze(['reveal', 'replace-page', 'open-page', 'raise-tab', 'block'])

/**
 * 页身份算法只有一处（铁律五〔裁定④后真吃 resource〕）。
 * 同 pane 同 resource 已开着 → 返回那条实例（这就是「同一资源已开就回到那一页」，
 * 老前端 src/stores/workspaceTabsStore.js:119-144 openOrFocus 的语义）；
 * 否则给下一个空位序号（`#1` 被占就 `#2`）。
 * `single`／`list` 的 pane 不分配新序号：它们的第二份文档走 replace-page 换当前页。
 */
export function pageIdOf(paneId, resource, { pages = [], multiplicity = 'single' } = {}) {
  const id = String(paneId ?? '').trim()
  if (!instanceIdFor(id)) return ''
  const mine = pages.filter((page) => page.pane === id)
  const key = typeof resource === 'string' && resource.trim() ? resource.trim() : null
  if (key) {
    const holder = mine.find((page) => page.resource === key)
    if (holder) return holder.instance
  } else {
    // 没给 resource＝「就要这块 pane 的缺省那份」；已开着就回去，不另起一页。
    const plain = mine.find((page) => !page.resource)
    if (plain) return plain.instance
  }
  if (multiplicity !== 'keyed') {
    // single／list：不许多页。有记录就复用那一条（调用方随后 setResource 换内容）。
    return mine.length ? mine[0].instance : instanceIdFor(id, 1)
  }
  let index = 1
  while (mine.some((page) => parseInstanceId(page.instance)?.index === index)) index += 1
  return instanceIdFor(id, index)
}

/** 这块 pane 是否已经开着（任何形态都算——页、浮窗、侧缘标签是一页的三种此刻形态，不是三种东西）。 */
function existingOf(pages, paneId) {
  const id = String(paneId ?? '').trim()
  return pages.filter((page) => page.pane === id)
}

/**
 * 唯一口径。入参：
 *   pane         目标 pane id
 *   multiplicity 清单声明（single|keyed|list；未声明按 single）
 *   resource     这页要装的文档标识（null＝该 pane 的缺省那份）
 *   pages        工作区当前全部页记录（list() 的原样输出）
 *   groups       { main, side, focus }：每组当前页与焦点组
 *   gesture      本批保留，恒空
 * 出参：{ action, instance, group, resource, pane, ...补充位 }
 */
export function resolveOpenTarget({ pane, multiplicity = 'single', resource = null, pages = [], groups = {}, gesture = {} } = {}) {
  const id = String(pane ?? '').trim()
  if (!instanceIdFor(id)) return { action: 'block', instance: '', group: null, resource: null, pane: id, reason: 'INVALID_PANE' }
  if (gesture && Object.keys(gesture).length) {
    // 本批不实现手势：与其悄悄忽略一个已经传进来的修饰键，不如如实拒绝（批次62 解除这条）。
    return { action: 'block', instance: '', group: null, resource: null, pane: id, reason: 'GESTURE_NOT_IMPLEMENTED' }
  }
  const kind = multiplicity === 'keyed' ? 'keyed' : 'single'
  const key = typeof resource === 'string' && resource.trim() ? resource.trim() : null
  const mine = existingOf(pages, id)
  const focusGroup = ['main', 'side'].includes(groups.focus) ? groups.focus : 'main'

  // 一、这一份文档已经开着 → 回到那一页（绝不新建）。
  const holder = key ? mine.find((page) => page.resource === key) : mine.find((page) => !page.resource)
  if (holder) {
    return holder.form === 'tab'
      ? { action: 'raise-tab', instance: holder.instance, group: holder.group, resource: holder.resource, pane: id }
      : { action: 'reveal', instance: holder.instance, group: holder.group, resource: holder.resource, pane: id, form: holder.form }
  }

  // 二、single 硬闸：这块 pane 只许一条记录，换文档＝换那一页装哪份稿子。
  if (mine.length && kind !== 'keyed') {
    const page = mine.find((item) => item.form === 'page') || mine[0]
    return { action: 'replace-page', instance: page.instance, group: page.group, resource: key, pane: id, replaced: page.resource }
  }

  // 三、没有这样一页：开一页，进焦点组
  //（焦点组空了状态机会退到另一组，见 workspace.afterShapeChange）。
  return {
    action: 'open-page',
    instance: pageIdOf(id, key, { pages, multiplicity: kind }),
    group: focusGroup,
    resource: key,
    pane: id
  }
}
