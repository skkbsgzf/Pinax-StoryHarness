import { fail, ok } from '../kernel/errors.mjs'
import { isSameProjectRoot, normalizeProjectRoot } from '../fs/projectPath.mjs'
import { tools as kernelTools } from '../../server/mcp/createMcpServer.js'

/**
 * 内核写族闸（M2 批次 2 的口径收口）。
 *
 * 要治的是什么：M2 批次 1 把小说／设定两块板块上盘后，工具面＝内核 19 ∪ 载体声明，
 * 但内核那 14 个未认领的名字仍然原样兜底，而它们的实现只按 `projectPath` 或
 * 「服务端注册表里的 projectId」定位项目（server/mcp/localProjects.js:62）。
 * 也就是说：模型只要肯给一个绝对路径，就能绕过板块的 file:<目录>:r 授权、
 * 绕过「一目录一主人」（C3）、绕过修订号并发闸，直接写作者的原稿目录。
 * 「只新增不动原稿」这条最硬的约束在那条路径上没有闸，本模块把它补在调用链路上。
 *
 * 三条判据，全部可机读（顺序即执行顺序）：
 *   1) 定位只认当前项目根：Next 的项目不在服务端注册表里，所以 `projectId` 一律拒；
 *      给了 `projectPath` 但不是当前根（按 next/fs 的同一份归一规则比）→ PATH_OUTSIDE_PROJECT；
 *      两者都没给 → 由闸注入当前根，调用方无从选择别的目录。
 *   2) 目录有没有主人：目标目录被某块已安装板块认领时，写只走认领者——
 *      板块申请了 rw 就点名它自有的写工具（小说＝pinax_chapter_save，带 expectedRevision），
 *      板块只有 r 就不给任何写通道，改动只能以提案形式落 .pinax/proposals/。
 *      没被认领的骨架目录（资料/日志）才允许内核兜底写。
 *   3) 结构动作不放行：建项目／整目录导入会改骨架本身或跨多个目录，Next 侧由内核
 *      createProject 负责；索引 sync 要 HTTP 打本机 3001，与 Next 的零端口口径冲突，只放 status。
 *
 * 名单不手写：写族从内核自己的 annotations（readOnlyHint === false）现取，
 * 分类表必须逐条点名——新增一把内核写工具而这里没定性，next/tests/kernel-write-guard.test.mjs 直接红。
 * 载体自有工具同理：写工具身份取自载体 impl 的 annotations，落点（写哪块目录）由 CARRIER_WRITE_CLASS 点名，
 * 拒绝提示只列「写这块目录的写工具」——只读工具与写别的目录的工具不混进来（批次16 记账，批次19 H1 收尾）。
 */

/** 内核自己声明的写族（不是「我们想拦哪些」，而是「annotations 说这些会写盘」）。 */
export const KERNEL_WRITE_TOOL_NAMES = Object.freeze(
  kernelTools.filter((tool) => tool?.annotations?.readOnlyHint === false).map((tool) => tool.name)
)

const KERNEL_NAME_SET = new Set(kernelTools.map((tool) => tool.name))

/** 每把写工具的落点定性：dir＝受「一目录一主人」约束，structural＝结构动作，derived＝只出产物的只读盘点族。 */
export const KERNEL_WRITE_CLASS = Object.freeze({
  pinax_chapter_write: Object.freeze({ dir: '正文' }),
  pinax_chapter_import: Object.freeze({ dir: '正文' }),
  pinax_worldbook_write: Object.freeze({ dir: '世界书' }),
  pinax_rule_write: Object.freeze({ dir: '约束' }),
  pinax_project_init: Object.freeze({ structural: true }),
  pinax_project_import: Object.freeze({ structural: true }),
  // 派生轨：status 是「按同一套规则盘点输入集」，sync 才会 HTTP 打本机服务。
  pinax_project_index: Object.freeze({ derived: true, writeAction: 'sync' })
})

/**
 * 载体自有写工具的落点（批次16 记账，批次19 H1 收尾；协议 v1.1-A 起落点随工具搬家）。
 * 名字 → 它写的那块 dataDir。dir: null ＝写的是内核元数据（提案目录 .pinax/proposals/），不归任何载体目录，任何目录提示都不列它。
 *
 * 为什么落点要在这里点名：载体工具描述里只有 annotations.readOnlyHint，没有「写哪块目录」的字段，
 * 而拒绝提示要说出「写「正文/」请走哪把」——只有知道落点才说得准。写工具的身份仍以载体 impl 的
 * annotations 为准（见 carrierToolAnnotations），这张表只补落点；guardCarrierWriteGaps() 在门禁里
 * 与「载体 impl 现列的写工具」逐条对账：漏点名／点名了却不是写工具／点名的目录不归该载体，都直接红。
 *
 * 协议 v1.1-A（作者 2026-10-28 裁定）把混合板拆成六栏后，落点表本身不变（工具名与目标目录没变），
 * 变的是主人：pinax_outline_save 写「大纲」归 pinax.carrier.outline、pinax_notes_save 写「构思」归
 * pinax.carrier.notes、pinax_worldbook_save 写「世界书」归 pinax.carrier.worldbook；pinax_chapter_save
 * 仍归 pinax.carrier.novel（正文），pinax_rule_save 仍归 pinax.carrier.setting（约束）——dirOutsideOwner
 * 就是这条主人关系的机器核对面。
 */
export const CARRIER_WRITE_CLASS = Object.freeze({
  pinax_chapter_save: Object.freeze({ dir: '正文' }),
  pinax_outline_save: Object.freeze({ dir: '大纲' }),
  pinax_notes_save: Object.freeze({ dir: '构思' }),
  pinax_worldbook_save: Object.freeze({ dir: '世界书' }),
  pinax_rule_save: Object.freeze({ dir: '约束' }),
  pinax_document_save: Object.freeze({ dir: '资料' }),
  pinax_proposal_discard: Object.freeze({ dir: null })
})

/** 分类表与内核写族名单的对账结果：漏定性／定了性但内核没这把工具，都算清单说谎。 */
export function guardClassificationGaps() {
  const declared = Object.keys(KERNEL_WRITE_CLASS)
  return {
    unclassified: KERNEL_WRITE_TOOL_NAMES.filter((name) => !declared.includes(name)),
    staleEntries: declared.filter((name) => !KERNEL_WRITE_TOOL_NAMES.includes(name)),
    outsideKernel: declared.filter((name) => !KERNEL_NAME_SET.has(name))
  }
}

/**
 * 载体写工具落点表的对账（门禁用，运行时不用）：
 *   unmapped         —— 载体 impl 说是写工具、落点表却没点名（拒绝提示会说不准）；
 *   staleEntries     —— 落点表点了名，已安装载体里却没有这把写工具（表在说谎）；
 *   dirOutsideOwner  —— 点名的目录不归该载体（提示会把作者指到别人的目录上）。
 * 写工具身份取自载体 impl 的 annotations（readOnlyHint === false），与提示列表同一个数据源。
 */
export function guardCarrierWriteGaps(registry) {
  const unmapped = []
  const staleEntries = []
  const dirOutsideOwner = []
  const seen = new Set()
  for (const manifest of registry?.list?.() ?? []) {
    const owned = (manifest.tools ?? []).filter((tool) => !KERNEL_NAME_SET.has(tool))
    const annotations = carrierToolAnnotations(registry, manifest)
    for (const name of owned) {
      if (annotations?.get(name)?.readOnlyHint !== false) continue
      seen.add(name)
      const klass = CARRIER_WRITE_CLASS[name]
      if (!klass) {
        unmapped.push({ pluginId: manifest.id, name })
        continue
      }
      if (klass.dir && !Object.values(manifest.dataDirs ?? {}).includes(klass.dir)) {
        dirOutsideOwner.push({ pluginId: manifest.id, name, dir: klass.dir })
      }
    }
  }
  for (const name of Object.keys(CARRIER_WRITE_CLASS)) if (!seen.has(name)) staleEntries.push(name)
  return { unmapped, staleEntries, dirOutsideOwner }
}

/**
 * 拦一道内核调用。返回 {ok:true,value:{tool,args,guard}} 时 args 可能已被注入 projectPath；
 * 返回 {ok:false,error} 时调用方（聚合面）把这份失败载荷原样变成 MCP 结果，不吞、不改写。
 */
export function guardKernelToolCall({ tool, args = {}, root = null, registry = null } = {}) {
  const name = String(tool ?? '')
  const klass = KERNEL_WRITE_CLASS[name]
  if (!klass) return ok({ tool: name, args, guard: { guarded: false, reason: '非写族：原样交给内核实现' } })

  const input = args && typeof args === 'object' && !Array.isArray(args) ? { ...args } : {}
  const givenPath = typeof input.projectPath === 'string' ? input.projectPath.trim() : ''
  const current = normalizeProjectRoot(root)

  if (klass.structural) {
    return fail('SCOPE_NOT_GRANTED', `${name} 是结构动作（建骨架／跨目录导入），Next 运行时不放行：项目由内核 createProject 按固化中文骨架建，整目录导入仍走服务端 MCP 轨`, {
      tool: name,
      root: current || null
    })
  }
  if (klass.derived && String(input.action ?? '').trim() === klass.writeAction) {
    return fail('DEPENDENCY_UNMET', `${name} 的 action:"${klass.writeAction}" 要经 HTTP 打本机 Pinax 服务，与 Next「零端口」的口径冲突：本运行时只放 action:"status" 的只读盘点`, {
      tool: name,
      action: input.action
    })
  }
  if (!current) {
    return fail('SCOPE_NOT_GRANTED', `${name} 是写盘工具，而当前运行时没有绑定已打开的项目根（Next 只在项目根内放行写）：请先打开含 .pinax/project.json 的本地文件夹`, {
      tool: name
    })
  }
  // 只要这个键出现过就拒——空串／纯空格也算含糊的形状，不许静默当成没给然后写到当前根去。
  if (input.projectId !== undefined) {
    return fail('INVALID_INPUT', `${name} 不接受 projectId：Next 打开的项目不在服务端注册表里，按 id 找会读到别的项目或凭空失败。写族只按当前项目根定位（要写本项目就别带这个键，本闸会替你注入项目根）`, {
      tool: name,
      projectId: input.projectId,
      currentRoot: current
    })
  }
  if (givenPath && !isSameProjectRoot(givenPath, current)) {
    return fail('PATH_OUTSIDE_PROJECT', `${name} 只允许写当前打开的 Next 项目（${current}），不给第二个路径`, {
      tool: name,
      projectPath: givenPath,
      currentRoot: current
    })
  }

  if (klass.dir) {
    const owner = findDirOwner({ dir: klass.dir, registry })
    if (owner) {
      const sanctioned = owner.ownedTools.length
        ? `写「${klass.dir}/」请走它自己认领的 ${owner.ownedTools.join(' / ')}（带 expectedRevision，过修订号并发闸）`
        : `「${klass.dir}/」被声明为只读作用域，Next 里不给任何写通道：要改设定，让运行时出提案（.pinax/proposals/），等板块认领写工具后再开`
      return fail('SCOPE_NOT_GRANTED', `${klass.dir}/ 的主人是「${owner.title}」板块，内核的 ${name} 在 Next 运行时不放行——${sanctioned}`, {
        tool: name,
        dir: klass.dir,
        owner: owner.pluginId,
        ownerScopes: owner.scopes.filter((scope) => scope.includes(klass.dir))
      })
    }
  }

  // 走到这里：目录没有主人（或只是产物轨），且调用方要么没给路径、给的就是当前根。注入当前根后放行。
  return ok({
    tool: name,
    args: { ...input, projectPath: current },
    guard: {
      guarded: true,
      projectRoot: current,
      injectedProjectPath: !givenPath,
      class: klass.dir ? { dir: klass.dir, unclaimed: true } : { derived: true }
    }
  })
}

/** 目录 → 认领它的板块（用注册表的 dirClaims，不另立一份目录表）。 */
function findDirOwner({ dir, registry }) {
  const claims = typeof registry?.dirClaims === 'function' ? registry.dirClaims() : null
  const owners = claims?.get?.(dir)
  if (!owners || !owners.size) return null
  const pluginId = [...owners][0]
  const manifest = registry?.get?.(pluginId)
  if (!manifest) return null
  const scopes = manifest.scopes ?? []
  return {
    pluginId,
    title: manifest.title ?? pluginId,
    scopes,
    // 板块自有的写工具里，只取落在这一块目录上的那几把（批次19 H1 收尾：提示精确化）。
    ownedTools: carrierWriteToolsForDir({ manifest, dir, registry })
  }
}

/**
 * 板块自有工具里「写在 dir 上」的写工具。
 * 只认 impl 的 annotations.readOnlyHint === false（与内核写族同一个身份来源）：
 * 只读工具（如 pinax_rule_list／pinax_proposal_list）与写别的目录的工具（如 pinax_outline_save）
 * 都不混进「写「正文/」请走…」这句话。落点由 CARRIER_WRITE_CLASS 点名。
 * impl 取不到 annotations 时退回落点表——那张表只收写工具，于是也不会把只读工具说成写入口。
 */
function carrierWriteToolsForDir({ manifest, dir, registry }) {
  const owned = (manifest.tools ?? []).filter((tool) => !KERNEL_NAME_SET.has(tool))
  const annotations = carrierToolAnnotations(registry, manifest)
  return owned.filter((name) => {
    if (CARRIER_WRITE_CLASS[name]?.dir !== dir) return false
    return annotations ? annotations.get(name)?.readOnlyHint === false : true
  })
}

/** 载体 impl 现列的工具 → annotations。取不到（没实现／工厂抛错）返回 null：不猜，也不把只读工具当写入口。 */
function carrierToolAnnotations(registry, manifest) {
  const impl = registry?.impl?.(manifest.id)
  if (typeof impl?.tools !== 'function') return null
  try {
    const provided = impl.tools({ pluginId: manifest.id, manifest, fileService: null, registry }) ?? []
    return new Map(provided
      .filter((tool) => tool && typeof tool.name === 'string')
      .map((tool) => [tool.name, tool.annotations ?? {}]))
  } catch {
    return null
  }
}
