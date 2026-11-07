/**
 * 工具面那一叠的**读数规则**（批次68-R1 任务1）。
 *
 * 一句话：界面上给作者看的那一行必须是工具清单里**已有的中文名**，
 * 清单没给中文名的就如实写「未命名工具」——编一个名字比不写更糟（作者会拿它去猜功能）。
 *
 * 三条边界写在这里，不在组件里：
 *   · 只读：本模块不认识桥、不认识运行时，输入就是 `dockViewModel().tools` 那一份形状（`{name,title,owner}`）；
 *   · 不造词：候选文本里没有中日韩字符就一律回落，绝不把 `pinax_project_list` 音译成「项目列表」；
 *   · 不吞 id：裸 id 仍是次要行与悬浮提示的来源（`toolRawIdLine`），排查问题时要能一眼看到真名。
 */

/** 中日韩字符（含扩展 A 区与假名）：判定「这串里到底有没有能给作者读的名字」用的那一条线。 */
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/u

/** 清单没给中文名时的那一句实话。 */
export const UNNAMED_TOOL = '未命名工具'

/**
 * 从工具的 title 取作者能读的那一句。
 *
 * 载体的工具在注册表里被拼成「载体名 · 工具 id」（pluginRegistry 那一条），
 * 尾巴上的 id 和次要行会重复，所以先把尾巴摘掉再判有没有中文——摘完只剩英文的就回落。
 */
export function toolDisplayName(tool) {
  const raw = String(tool?.title ?? '').trim()
  if (!raw) return UNNAMED_TOOL
  const id = String(tool?.name ?? '').trim()
  let label = raw
  if (id) {
    if (label.endsWith(`· ${id}`)) label = label.slice(0, -(id.length + 2))
    else if (label.endsWith(id)) label = label.slice(0, -id.length)
  }
  label = label.replace(/[\s·・|｜/:：\-–—_]+$/u, '').trim()
  if (!label || !CJK.test(label)) return UNNAMED_TOOL
  return label
}

/** 次要行那一串：原始 id 原样给出（不翻译、不改大小写），空面时留空由调用方决定摆不摆。 */
export function toolRawIdLine(tool) {
  return String(tool?.name ?? '').trim()
}

/**
 * 整叠读数的成型：给对话框直接 v-for 的那一份。
 * 序不动（工具清单的序是注册序，界面无权重排），只补两个读数列。
 */
export function toolDisplayRows(tools) {
  return (Array.isArray(tools) ? tools : []).map((tool) => Object.freeze({
    name: toolRawIdLine(tool),
    displayName: toolDisplayName(tool)
  }))
}
