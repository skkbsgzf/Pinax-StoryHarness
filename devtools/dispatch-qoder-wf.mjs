/* workflow 版派发：Qoder CLI 执行工单，stdout 只出一行紧凑 JSON（全程流进日志文件）。
   world.run 的 stdout 上限 256KB，所以进度与事件流全落盘，结果才走 stdout。
   实测（2026-10-31，v1.1.70）：stdin 提示词可用；-p --output-format json 结束时单发
   {"type":"result",...}（duration_ms/num_turns/result 字段与 CodeBuddy 同形）。 */
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync, writeSync, openSync, closeSync } from 'node:fs'

const MODEL = process.argv[2] || 'DeepSeek-Flash'
const TICKET = process.argv[3]
const LOG = process.argv[4] || 'D:/Pinax-e2e/dispatch-wf.log'
const REPO = 'D:/Pinax-next'
const QODER = 'C:/Users/Administrator/.qoder/entry/qoder.cmd'

if (!TICKET) { console.log(JSON.stringify({ spawnError: '缺少工单路径参数' })); process.exit(1) }

const ticketText = readFileSync(TICKET, 'utf-8')
const prompt = [
  '你是 Pinax-Electron-Next 的实现工程师。',
  '请阅读并完成以下工单的全部任务。',
  '完成后运行 npm run verify:next 自查；若工单声明了已知红（known-red），以工单口径为准并在 result 里说明。',
  '不执行 git 命令。不启动/不杀 electron 进程。',
  '只改工单允许的文件。做不到的写进 limitations。',
  '',
  '=== 工单开始 ===',
  ticketText,
  '=== 工单结束 ==='
].join('\n')

const started = Date.now()
const child = spawn(QODER, [
  '-p',
  '--model', MODEL,
  '--output-format', 'json',
  '--no-session-persistence',
  '--dangerously-skip-permissions'
], {
  cwd: REPO,
  stdio: ['pipe', 'pipe', 'pipe'],
  shell: true,
  timeout: 10_800_000
})

const logFd = openSync(LOG, 'w')
child.stdout.on('data', (d) => writeSync(logFd, d))
child.stderr.on('data', (d) => writeSync(logFd, d))
child.stdin.write(prompt)
child.stdin.end()

child.on('close', (code) => {
  closeSync(logFd)
  // 从日志里配对括号取出 type:"result" 事件
  let outcome
  try {
    const raw = readFileSync(LOG, 'utf-8')
    const marker = /"type":\s*"result"/.exec(raw)
    if (marker) {
      const start = raw.lastIndexOf('{', marker.index)
      let depth = 0, inStr = false, esc = false, end = -1
      for (let i = start; i < raw.length; i++) {        const ch = raw[i]
        if (esc) { esc = false; continue }
        if (ch === '\\') { esc = true; continue }
        if (ch === '"') { inStr = !inStr; continue }
        if (inStr) continue
        if (ch === '{') depth++
        else if (ch === '}') { depth--; if (depth === 0) { end = i + 1; break } }
      }
      const obj = JSON.parse(raw.slice(start, end))
      outcome = {
        exitCode: code,
        durationMs: obj.duration_ms ?? Date.now() - started,
        numTurns: obj.num_turns ?? null,
        result: String(obj.result || '').slice(0, 9000)
      }
    } else {
      outcome = { exitCode: code, durationMs: Date.now() - started, numTurns: null, result: null, note: '日志里没有 result 事件（全文见日志文件）' }
    }
  } catch (error) {
    outcome = { exitCode: code, durationMs: Date.now() - started, numTurns: null, result: null, note: `结果解析失败：${String(error?.message || error)}` }
  }
  console.log(JSON.stringify(outcome))
})

child.on('error', (err) => {
  closeSync(logFd)
  console.log(JSON.stringify({ spawnError: String(err?.message || err) }))
  process.exit(1)
})
