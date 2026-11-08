/* workflow 版门禁：chdir 到仓库后跑 verify:next，stdout 只出一行紧凑 JSON。 */
import { execSync } from 'node:child_process'

process.chdir('D:/Pinax-next')
let exitCode = 0
let tail = ''
try {
  const out = execSync('npm run verify:next', {
    encoding: 'utf8',
    timeout: 1_500_000,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 128 * 1024 * 1024
  })
  tail = String(out).slice(-2000)
} catch (error) {
  exitCode = error?.status ?? 1
  tail = String(error?.stdout || '').slice(-1200) + '\n[stderr]\n' + String(error?.stderr || error?.message || '').slice(-2400)
}
console.log(JSON.stringify({ exitCode, tail }))
