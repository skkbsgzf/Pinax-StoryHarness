/* workflow 版门禁 v2（T20）：verify:next 的五段各自跑、互不截断；内核段支持 known-red 名单——
   名单里的失败放行并在回执里点名（修掉对应债后从 KNOWN_RED 删除即可，别让它变永久豁免）。
   stdout 只出一行紧凑 JSON：{ exitCode, segments, tail }。全程约 8-10 分钟（bundle 段含 build:next）。 */
import { execSync } from 'node:child_process'

process.chdir('D:/Pinax-next')

// known-red 名单：门禁放行的已知失败（按用例名子串匹配）。空＝当前无豁免。
// 用法：出现新的已知债时在此登记 { file, name, ticket }，修掉后立刻删除——别让豁免变永久。
// 历史：T1（世界书 AGENT.md 8000 字记账）曾在此挂账，2026-11-08 T1 批瘦身后真实转绿，条目退役。
const KNOWN_RED = Object.freeze([])

function run(cmd, timeout) {
  try {
    const out = execSync(cmd, { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 128 * 1024 * 1024 })
    return { code: 0, out: String(out) }
  } catch (error) {
    return { code: error?.status ?? 1, out: String(error?.stdout || '') + '\n[stderr]\n' + String(error?.stderr || error?.message || '') }
  }
}

/** 从 node --test 的 spec 输出里取失败用例名（✖ 行，排除汇总头）。 */
function failingNames(out) {
  return out.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith('✖') && !l.includes('failing tests')).map((l) => l.replace(/^✖\s*/, ''))
}

const segments = {}

{
  const r = run('node next/testing/acceptance.mjs', 420_000)
  segments.acceptance = { ok: r.code === 0, tail: r.out.slice(-500) }
}

{
  const r = run('node --test "next/tests/*.test.mjs"', 300_000)
  const failing = [...new Set(failingNames(r.out))]
  const unmatched = failing.filter((name) => !KNOWN_RED.some((k) => name.includes(k.name)))
  const knownRed = failing.filter((name) => KNOWN_RED.some((k) => name.includes(k.name)))
  segments.kernel = {
    ok: r.code === 0 || (unmatched.length === 0 && failing.length > 0),
    allGreen: r.code === 0,
    knownRed,
    unmatched,
    tail: r.out.slice(-700)
  }
}

{
  const r = run('npm run test:next:ui', 600_000)
  segments.ui = { ok: r.code === 0, tail: r.out.slice(-400) }
}

{
  const r = run('npm run lint:next', 300_000)
  segments.lint = { ok: r.code === 0, tail: r.out.slice(-400) }
}

{
  const r = run('npm run build:next && node next/testing/bundleAssertions.mjs', 900_000)
  segments.bundle = { ok: r.code === 0, tail: r.out.slice(-500) }
}

const exitCode = Object.values(segments).every((s) => s.ok) ? 0 : 1
const summary = Object.entries(segments).map(([k, s]) => `${k}=${s.ok ? 'ok' : 'FAIL'}`).join(' ')
const firstFail = Object.entries(segments).find(([, s]) => !s.ok)
const tail = `分段门禁：${summary}` + (firstFail ? `\n[首败 ${firstFail[0]}]\n${String(firstFail[1].tail).slice(-1600)}` : '')
console.log(JSON.stringify({ exitCode, segments, tail }))
