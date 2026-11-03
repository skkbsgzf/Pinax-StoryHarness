import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as espree from 'espree'
import { parse as parseSfc } from '@vue/compiler-sfc'

/**
 * 批次69 任务 2 的排查断言（工单写「grep 级即可」，这里做成 AST 级，因为 grep 拦不住跨行的链）。
 *
 * 要拦的是**一类**问题，不是一个点：任何「返回 promise 的调用」在语句位置被丢掉，它的拒绝就没人接住。
 * 并行全量跑时那条偶发的 `MCP error -32000: Connection closed` 正是这么冒出来的——
 * 请求还在途、会话被关掉，SDK 的 `Protocol._onclose()` 把拒绝沿 await 链一路上抛，链顶是个没人 await 的 promise。
 *
 * 三条规则，全是确定性的结构判据，不设数值阈值：
 *   R1 语句位置的 promise 调用链没被消费（没有 await／return／赋值接收，链脊上没有 `.catch` 或双参 `.then`）。
 *      「promise 调用」的判据只有两条，都是本仓的硬事实：
 *        · 链上出现 ASYNC_MEMBERS 里的属性名（渲染层桥 `request`、主进程分发器 `dispatch`）；
 *        · 链的根是本文件里声明的 async 函数。
 *   R2 `.then(fulfilled)` 只给一个参数且链脊上没有 `.catch`：拒绝分支没人接。
 *   R3 async 回调交给「不等 promise」的调度器（setTimeout／setInterval／watch／事件注册／数组方法不带 Promise.all）。
 *
 * 扫描面与闸口（批次69 的允许文件边界，如实留名）：
 *   GATED ＝ next/runtime/** ＋ 本批允许改的 next/shell/main.mjs／AppNext.vue —— 这些必须零命中，红就停。
 *   其余 next/shell/** 里的命中**照样扫出来**，但不进本批闸口：那批文件此刻正被并行批次编辑，
 *   本批越界改它们会互相抹。面外清单落在批次记录里，随下一批收口。
 *
 * 解析失败＝当场报错，不静默跳过（扫不动不等于没找到）。
 * 审计口径：`node next/tests/floating-promise.test.mjs --audit` 打全树命中，不做断言。
 */

const here = dirname(fileURLToPath(import.meta.url))
const NEXT_DIR = resolve(here, '..')
const RUNTIME_DIR = join(NEXT_DIR, 'runtime')
const SHELL_DIR = join(NEXT_DIR, 'shell')

/** 闸口面（本批允许文件）。 */
const GATED = new Set([
  'runtime',
  join('shell', 'main.mjs'),
  join('shell', 'AppNext.vue')
])

/** 本仓 IPC 的两个入口名：它们必然返回 promise。 */
const ASYNC_MEMBERS = new Set(['request', 'dispatch'])

/** 这些调度器不会 await 回调返回的 promise。 */
const FIRE_AND_FORGET_SCHEDULERS = new Set([
  'setTimeout', 'setInterval', 'setImmediate', 'queueMicrotask',
  'watch', 'watchEffect', 'watchPostEffect', 'watchSyncEffect',
  'addEventListener', 'on', 'once',
  'forEach', 'map', 'filter', 'some', 'every', 'reduce'
])

/** 数组方法的返回值只有被这几个包起来才算被消费。 */
const CONSUMED_WRAPPERS = new Set(['all', 'allSettled', 'race', 'any'])

function walk(node, visit, parent = null) {
  if (!node || typeof node.type !== 'string') return
  visit(node, parent)
  for (const [key, value] of Object.entries(node)) {
    if (key === 'parent' || key === 'loc' || key === 'range') continue
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item.type === 'string') walk(item, visit, node)
      }
    } else if (value && typeof value === 'object' && typeof value.type === 'string') {
      walk(value, visit, node)
    }
  }
}

function parentsOf(ast) {
  const parents = new Map()
  walk(ast, (node, parent) => {
    if (parent) parents.set(node, parent)
  })
  return parents
}

function isAsyncFunctionNode(node) {
  return node?.type === 'FunctionDeclaration' || node?.type === 'FunctionExpression' || node?.type === 'ArrowFunctionExpression'
    ? node.async === true
    : false
}

/** 一个文件里所有「本文件声明的 async 函数名」——R1/R3 的判据来源。 */
function asyncNamesIn(ast) {
  const names = new Set()
  walk(ast, (node) => {
    if (node.type === 'FunctionDeclaration' && node.async && node.id) names.add(node.id.name)
    if (node.type === 'VariableDeclarator' && isAsyncFunctionNode(node.init) && node.id?.type === 'Identifier') names.add(node.id.name)
    if (node.type === 'AssignmentExpression' && node.left?.type === 'Identifier' && isAsyncFunctionNode(node.right)) names.add(node.left.name)
  })
  return names
}

/** 沿链脊往上爬到最外层的那次调用（`a.b().c()` → `a.b().c()` 的 CallExpression）。 */
function climbChain(node, parents) {
  let top = node
  for (;;) {
    const parent = parents.get(top)
    if (parent?.type === 'MemberExpression' && parent.object === top) {
      const grand = parents.get(parent)
      if (grand?.type === 'CallExpression' && grand.callee === parent) {
        top = grand
        continue
      }
      break
    }
    if (parent?.type === 'ChainExpression') {
      top = parent
      continue
    }
    break
  }
  return { top, parent: parents.get(top) }
}

/** 链脊（只走 `.x(...)` 的宿主那一侧，不进实参子树）上有没有接住拒绝的 `.catch`／双参 `.then`。 */
function spineHasCatch(top) {
  let current = top
  while (current?.type === 'CallExpression') {
    const callee = current.callee
    if (callee?.type !== 'MemberExpression') break
    const prop = callee.property?.name
    if (prop === 'catch') return true
    if (prop === 'then' && current.arguments.length >= 2) return true
    const object = callee.object
    current = object?.type === 'ChainExpression' ? object.expression : object
  }
  return false
}

/** 链脊上出现过的属性名＋链根的标识符名——R1 判断「这是不是一次 promise 调用」用的材料。 */
function spineNames(top) {
  const members = []
  let current = top
  let root = null
  while (current?.type === 'CallExpression') {
    const callee = current.callee
    if (callee?.type === 'MemberExpression') {
      members.push(callee.property?.name)
      const object = callee.object
      current = object?.type === 'ChainExpression' ? object.expression : object
      continue
    }
    root = callee
    break
  }
  if (root?.type === 'Identifier') return { members, rootName: root.name }
  if (root?.type === 'MemberExpression') return { members: [...members, root.property?.name], rootName: null }
  // `getBridge().request(...)` 这种：根是一次调用，递归看它自己的脊。
  if (root?.type === 'CallExpression') {
    const inner = spineNames(root)
    return { members: [...members, ...inner.members], rootName: inner.rootName }
  }
  return { members, rootName: null }
}

function isPromiseCall(top, asyncNames) {
  const { members, rootName } = spineNames(top)
  if (members.some((name) => ASYNC_MEMBERS.has(name))) return true
  return Boolean(rootName) && asyncNames.has(rootName)
}

function consumedByParent(top, parent, parents) {
  if (!parent) return false
  if (parent.type === 'AwaitExpression') return true
  if (parent.type === 'ReturnStatement') return true
  if (parent.type === 'VariableDeclarator') return true
  if (parent.type === 'Property' || parent.type === 'ArrayExpression') return true
  if (parent.type === 'UnaryExpression' && parent.operator === 'void') return true
  if (parent.type === 'ArrowFunctionExpression' && parent.expression) return true
  if (parent.type === 'AssignmentExpression' && parent.right === top) return true
  if (parent.type === 'ConditionalExpression' || parent.type === 'LogicalExpression' || parent.type === 'SequenceExpression') {
    return consumedByParent(parent, parents.get(parent), parents)
  }
  return false
}

function baseName(callee) {
  if (callee?.type === 'Identifier') return callee.name
  if (callee?.type === 'MemberExpression') return callee.property?.name
  return null
}

function scriptBlocks(source, filePath) {
  if (extname(filePath) !== '.vue') return [{ content: source, firstLine: 1 }]
  const { descriptor, errors } = parseSfc(source, { filename: filePath })
  if (errors?.length) throw new Error(`${filePath} 的 SFC 解析失败：${errors.map((error) => error.message).join('；')}`)
  return [descriptor.script, descriptor.scriptSetup]
    .filter(Boolean)
    .map((block) => ({ content: block.content, firstLine: block.loc?.start?.line ?? 1 }))
}

function scanFile(filePath) {
  const raw = readFileSync(filePath, 'utf-8')
  const findings = []
  for (const block of scriptBlocks(raw, filePath)) {
    let ast = null
    try {
      ast = espree.parse(block.content, { ecmaVersion: 'latest', sourceType: 'module', loc: true, ranges: true })
    } catch (error) {
      throw new Error(`${filePath} 解析失败：${error.message}`)
    }
    const parents = parentsOf(ast)
    const asyncNames = asyncNamesIn(ast)
    const line = (node) => (node.loc?.start?.line ?? 1) + block.firstLine - 1
    const describe = (top) => {
      const { members, rootName } = spineNames(top)
      const head = rootName ?? members[members.length - 1] ?? '调用'
      return block.content.slice(top.range[0], Math.min(top.range[1], top.range[0] + 72)).replace(/\s+/gu, ' ') + `（入口 ${head}）`
    }

    walk(ast, (node) => {
      // R1：语句位置的 promise 调用链没人接住
      if (node.type !== 'ExpressionStatement') return
      const expr = node.expression?.type === 'ChainExpression' ? node.expression.expression : node.expression
      if (expr?.type !== 'CallExpression') return
      const { top } = climbChain(expr, parents)
      if (spineHasCatch(top)) return
      if (consumedByParent(top, parents.get(node.expression), parents)) return
      if (!isPromiseCall(top, asyncNames)) return
      findings.push({ line: line(node), rule: 'R1', detail: `语句位置的 promise 调用没被 await/return/.catch 接住：${describe(top)}` })
    })

    walk(ast, (node) => {
      // R2：单参 .then 且链脊上没有 .catch
      if (node.type !== 'CallExpression' || node.callee?.type !== 'MemberExpression') return
      if (node.callee.property?.name !== 'then') return
      if (node.arguments.length >= 2) return
      const { top, parent } = climbChain(node, parents)
      if (spineHasCatch(top)) return
      if (consumedByParent(top, parent, parents)) return
      if (top !== node) return
      findings.push({ line: line(node), rule: 'R2', detail: '`.then(fulfilled)` 只有一个参数且链上没有 .catch：拒绝分支没人接' })
    })

    walk(ast, (node) => {
      // R3：async 回调交给不等 promise 的调度器
      if (node.type !== 'CallExpression') return
      const name = baseName(node.callee)
      if (!FIRE_AND_FORGET_SCHEDULERS.has(name)) return
      if (['forEach', 'map', 'filter', 'some', 'every', 'reduce'].includes(name)) {
        const { top } = climbChain(node, parents)
        const outerParent = parents.get(top)
        const wrap = outerParent?.type === 'CallExpression' ? outerParent.callee : null
        if (wrap?.type === 'MemberExpression' && CONSUMED_WRAPPERS.has(wrap.property?.name)) return
      }
      for (const argument of node.arguments) {
        if (isAsyncFunctionNode(argument)) {
          findings.push({ line: line(node), rule: 'R3', detail: `${name} 的回调是 async 函数：调度器不会 await 它，拒绝必然浮出（在回调内部 try/catch 并记账，或挂 .catch 记录）` })
        }
        if (argument?.type === 'Identifier' && asyncNames.has(argument.name)) {
          findings.push({ line: line(node), rule: 'R3', detail: `${name} 直接登记了本文件的 async 函数 ${argument.name}()：调度器不会 await 它` })
        }
      }
    })
  }
  return findings.sort((a, b) => a.line - b.line)
}

function filesUnder(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      // .build 是打包产物副本，不是源码——扫它只会把已修的旧形态重新报一遍。
      if (name === '.build') continue
      out.push(...filesUnder(full))
      continue
    }
    if (!['.mjs', '.vue', '.js'].includes(extname(name))) continue
    out.push(full)
  }
  return out.sort()
}

function relative(filePath) {
  return filePath.slice(NEXT_DIR.length + 1)
}

function gated(filePath) {
  return GATED.has(relative(filePath))
}

function audit() {
  const targets = [...filesUnder(RUNTIME_DIR), ...filesUnder(SHELL_DIR)]
  const findings = []
  for (const filePath of targets) {
    for (const finding of scanFile(filePath)) {
      findings.push({ ...finding, file: relative(filePath).replace(/\\/gu, '/'), gated: gated(filePath) })
    }
  }
  return { targets, findings }
}

if (process.argv.includes('--audit')) {
  const { targets, findings } = audit()
  const inGate = findings.filter((item) => item.gated)
  const outside = findings.filter((item) => !item.gated)
  // eslint-disable-next-line no-console -- --audit 是一次性人工排查口，输出就是它的产物
  console.log(`扫描 ${targets.length} 个文件；命中 ${findings.length} 处（闸口面 ${inGate.length}、闸口外 ${outside.length}）`)
  for (const item of findings) {
    // eslint-disable-next-line no-console -- 同上
    console.log(`${item.gated ? '闸口' : '面外'} ${item.file}:${item.line} [${item.rule}] ${item.detail}`)
  }
} else {
  test('批次69 任务2：闸口面（runtime＋shell/main.mjs＋AppNext.vue）里没有未接住的 promise', () => {
    const { targets, findings } = audit()
    assert.ok(targets.length >= 60, `扫描面异常收缩：只找到 ${targets.length} 个文件（runtime＋shell 应有上百）`)
    const report = findings
      .filter((item) => item.gated)
      .map((item) => `${item.file}:${item.line} [${item.rule}] ${item.detail}`)
    assert.deepEqual(report, [], `闸口面发现未接住的 promise（同类点必须清）：\n${report.join('\n')}`)
  })

  test('批次69 任务2：闸口外的同类点按文件记账，不许新增（清了只能减不能加）', () => {
    // 这六处在本批允许文件之外（工单的边界：并行批次正在改这批 shell 组件，越界改会互相抹）。
    // 记成台账而不是口头欠账：出现**新文件**即红，老点被清掉不挡路——债务只能减。
    // 行号会随并行改动漂移，所以台账认「文件」不认行；具体位置看 `node next/tests/floating-promise.test.mjs --audit`。
    const LEDGER = [
      'shell/AssistantDialog.vue',
      'shell/CarrierPaneHost.vue',
      'shell/CommandPalette.vue',
      'shell/EntryDetailPanel.vue',
      'shell/MaterialGallery.vue'
    ]
    const { findings } = audit()
    const outside = [...new Set(findings.filter((item) => !item.gated).map((item) => item.file))].sort()
    const fresh = outside.filter((file) => !LEDGER.includes(file))
    assert.deepEqual(fresh, [], `闸口外出现了新的未接住的 promise（本批不动这批文件，须先登记进批次记录的欠账台账）：\n${fresh.join('\n')}`)
  })

  test('批次69 任务1：进程内链路的 drain 与拒绝记账在代码里（守卫标记，grep 级）', () => {
    const surface = readFileSync(join(RUNTIME_DIR, 'transportInProcess.mjs'), 'utf-8')
    const runtime = readFileSync(join(RUNTIME_DIR, 'agentRuntime.mjs'), 'utf-8')
    const entry = readFileSync(join(NEXT_DIR, 'index.mjs'), 'utf-8')
    assert.match(surface, /DEFAULT_DRAIN_TIMEOUT_MS/, 'transportInProcess 缺 drain 超时常量')
    assert.match(surface, /async function drain/, 'transportInProcess 缺 drain 等待实现')
    assert.match(surface, /inflight/, 'transportInProcess 缺在途请求表')
    assert.match(runtime, /link\.close\(\{ drainTimeoutMs/, 'agentRuntime.stop() 没把 drain 预算传下去')
    assert.match(runtime, /lastCloseReport/, 'agentRuntime.stop() 没带回关闭报告')
    assert.match(entry, /retireRuntime/, 'index.mjs 的 close 链没有统一的退役出口')
    assert.doesNotMatch(entry, /if \(session\.runtime\) await session\.runtime\.stop\(\)/, 'index.mjs 里还留着丢弃 stop 报告的旧写法')
  })

  test('批次69 本批改动面内不许留空 catch（吞错误不记账＝工单禁止项）', () => {
    // 只闸本批改过的文件：全仓另有若干历史空 catch，那属于「记在账上的欠账」，见批次记录，不由本批偷偷改。
    const owned = [
      join(RUNTIME_DIR, 'transportInProcess.mjs'),
      join(RUNTIME_DIR, 'agentRuntime.mjs'),
      join(NEXT_DIR, 'index.mjs'),
      join(SHELL_DIR, 'main.mjs')
    ]
    const hits = []
    for (const filePath of owned) {
      const code = readFileSync(filePath, 'utf-8')
      code.split('\n').forEach((text, index) => {
        // 不用正则：`.catch(() => {})` 这种串里成对的括号会让 eslint 的正则校验器直接报解析错，
        // 这里只认「去掉空白后的字面量」，够覆盖三种空吞写法。
        const packed = text.replace(/\s+/gu, '')
        if (packed.includes('.catch(()=>{})') || packed.includes('.catch(()=>null)') || packed.includes('.catch(()=>undefined)')) {
          hits.push(`${relative(filePath).replace(/\\/gu, '/')}:${index + 1} ${text.trim()}`)
        }
      })
    }
    assert.deepEqual(hits, [], `本批文件里仍有空 catch（拒绝被抹平成「什么都没发生」）：\n${hits.join('\n')}`)
  })
}
