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
 * `gesture`（批次62 起真吃值，词汇见下方 GESTURE_FORMS／GESTURE_ACTIONS）：
 * 手势不改变「去哪一页」的判定，只改变「那一页以什么形态出现」，以及中键这种「就要关掉它」的直令。
 */

import { instanceIdFor, parseInstanceId } from './workspace.mjs'

/** 落点动作全集。 */
export const OPEN_ACTIONS = Object.freeze(['reveal', 'replace-page', 'open-page', 'raise-tab', 'block', 'close-page'])

/**
 * 手势词汇（批次62 任务五）。批次61 留的 `gesture` 形参从今天起真吃值：
 *
 *   { form: 'floating' }  Alt+点击竖条图标／页签——**以另一形态执行同一动作**：
 *     落点判定（reveal／replace-page／open-page／raise-tab）一条都不改，只在答案上多带一个
 *     `form:'floating'`。调用方（AppNext.routeOpen）据此把那一页落成浮窗态。
 *     之所以不改动作，是因为「去哪儿」与「以什么形态在那儿」是两条轴——混成六个新动作，
 *     每条调用路径都要重判一次，v2 那七套各写一份的旧病就回来了。
 *   { action: 'close', instance }  中键点击页签——关的必须是**被点的那一页**，
 *     所以入口把页实例一起交进来；这里只核对它确实开着（不在页列表里就 block，不猜第二页）。
 *
 * 认不出的手势一律 `block` + 明确 reason，不悄悄忽略：作者按了一个没接住的组合键，
 * 界面至少要能解释为什么什么都没发生。
 */
export const GESTURE_FORMS = Object.freeze(['floating'])
export const GESTURE_ACTIONS = Object.freeze(['close'])

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

/** 这块 pane 是否已经开着（任何形态都算——页、浮窗、收进悬浮球是一页的三种此刻形态，不是三种东西）。 */
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
 *   gesture      批次62 起真吃值：{ form:'floating' } 或 { action:'close', instance }
 * 出参：{ action, instance, group, resource, pane, ...补充位 }；带手势形态时补 `form`
 */
export function resolveOpenTarget({ pane, multiplicity = 'single', resource = null, pages = [], groups = {}, gesture = {} } = {}) {
  const id = String(pane ?? '').trim()
  if (!instanceIdFor(id)) return { action: 'block', instance: '', group: null, resource: null, pane: id, reason: 'INVALID_PANE' }
  const keys = gesture && typeof gesture === 'object' ? Object.keys(gesture) : []
  const gestureForm = gesture?.form ?? ''
  const gestureAction = gesture?.action ?? ''
  // instance 只是 close 的搭档（「关哪一页」），单独传它不构成一个手势。
  const meaningful = keys.filter((key) => key !== 'instance' || (!gestureForm && !gestureAction))
  if (meaningful.length) {
    // 认不出的手势不悄悄忽略：作者按了一个没接住的组合键，界面至少能解释为什么什么都没发生。
    if (gestureForm) {
      if (!GESTURE_FORMS.includes(gestureForm)) {
        return { action: 'block', instance: '', group: null, resource: null, pane: id, reason: 'GESTURE_FORM_UNSUPPORTED' }
      }
    } else if (gestureAction) {
      if (gestureAction === 'close' && GESTURE_ACTIONS.includes(gestureAction)) {
        const target = String(gesture.instance ?? '').trim()
        const found = pages.find((page) => page.instance === target && page.pane === id)
        if (!found) {
          return { action: 'block', instance: target, group: null, resource: null, pane: id, reason: 'GESTURE_NO_TARGET' }
        }
        return { action: 'close-page', instance: found.instance, group: found.group, resource: found.resource, pane: id }
      }
      return { action: 'block', instance: '', group: null, resource: null, pane: id, reason: 'GESTURE_UNSUPPORTED' }
    } else {
      return { action: 'block', instance: '', group: null, resource: null, pane: id, reason: 'GESTURE_UNSUPPORTED' }
    }
  }
  const kind = multiplicity === 'keyed' ? 'keyed' : 'single'
  const key = typeof resource === 'string' && resource.trim() ? resource.trim() : null
  const mine = existingOf(pages, id)
  const focusGroup = ['main', 'side'].includes(groups.focus) ? groups.focus : 'main'
  // 带形态的手势：落点动作照常判，只在答案上多带一个 form（调用方据此把那一页落成那个形态）。
  const withForm = (decision) => (gestureForm ? { ...decision, form: gestureForm } : decision)

  // 一、这一份文档已经开着 → 回到那一页（绝不新建）。
  const holder = key ? mine.find((page) => page.resource === key) : mine.find((page) => !page.resource)
  if (holder) {
    return withForm(holder.form === 'tab'
      ? { action: 'raise-tab', instance: holder.instance, group: holder.group, resource: holder.resource, pane: id }
      : { action: 'reveal', instance: holder.instance, group: holder.group, resource: holder.resource, pane: id, form: holder.form })
  }

  // 二、single 硬闸：这块 pane 只许一条记录，换文档＝换那一页装哪份稿子。
  if (mine.length && kind !== 'keyed') {
    const page = mine.find((item) => item.form === 'page') || mine[0]
    return withForm({ action: 'replace-page', instance: page.instance, group: page.group, resource: key, pane: id, replaced: page.resource })
  }

  // 三、没有这样一页：开一页，进焦点组
  //（焦点组空了状态机会退到另一组，见 workspace.afterShapeChange）。
  return withForm({
    action: 'open-page',
    instance: pageIdOf(id, key, { pages, multiplicity: kind }),
    group: focusGroup,
    resource: key,
    pane: id
  })
}
