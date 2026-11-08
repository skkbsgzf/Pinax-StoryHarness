/* 批次26：用 Codebuddy CLI 执行工单（DeepSeek v4.1 Flash），调度方监督。
   Windows 上 codebuddy 是 .cmd 垫片：spawn 必须 shell:true；工单走 stdin 避开 argv 转义。 */
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO = 'D:/Pinax-next'
const TICKET = process.argv[3] || join(REPO, 'docs/plan/pinax-electron-next-m2-batch27-ticket-20261029.md')
const PROMPT_FILE = 'D:/Pinax-e2e/prompt-dispatch.txt'
const MODEL = process.argv[2] || 'deepseek-v4.1-flash'

// 读工单内容作为 prompt，落盘后从 stdin 喂入
const ticketText = readFileSync(TICKET, 'utf-8')
const prompt = [
  '你是 Pinax-Electron-Next 的实现工程师。',
  '请阅读并完成以下工单的全部任务。',
  '完成后运行 npm run verify:next 确认五段全绿。',
  '不执行 git 命令。不启动/不杀 electron 进程。',
  '只改工单允许的文件。做不到的写进 limitations。',
  '',
  '=== 工单开始 ===',
  ticketText,
  '=== 工单结束 ==='
].join('\n')
writeFileSync(PROMPT_FILE, prompt, 'utf-8')

console.log('工单长度:', prompt.length, '字符')
console.log('启动 Codebuddy CLI（' + MODEL + '），工单经 stdin 喂入...')

const child = spawn('codebuddy', [
  '-p',
  '--model', MODEL,
  '--output-format', 'json',
  '--dangerously-skip-permissions'
], {
  cwd: REPO,
  stdio: ['pipe', 'pipe', 'pipe'],
  shell: true,
  timeout: 3_600_000
})

let stdout = ''
child.stdout.on('data', (d) => { stdout += d; process.stdout.write('[cb] ' + d) })
child.stderr.on('data', (d) => { process.stderr.write('[cb-err] ' + d) })

// stdin 喂完工单即关闭，CLI 收到 EOF 开始干活
child.stdin.write(prompt)
child.stdin.end()

child.on('close', (code) => {
  console.log('\nCodebuddy 退出码:', code)
  console.log('stdout 长度:', stdout.length)
  try {
    const jsonStart = stdout.indexOf('{"')
    if (jsonStart >= 0) {
      const result = JSON.parse(stdout.slice(jsonStart))
      console.log('Codebuddy 结果类型:', result.type)
      console.log('Codebuddy 结果:', String(result.result || '').slice(0, 800))
    }
  } catch { /* not json */ }
})

child.on('error', (err) => {
  console.error('Codebuddy spawn error:', err.message)
})
