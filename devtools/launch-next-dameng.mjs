/* 大梦项目启动器（自愈版）：spawn → CIM 轮询 renderer 子进程 → 没出来就杀掉重试（最多 4 次）。
   本机实测：node 裸 spawn electron 约一半概率丢 renderer；重试 + renderer 子进程检测是自愈手段。 */
import { spawn, execSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const REPO = 'D:/Pinax-next'
const ROOT = 'D:/Projects/大梦'
const APPDATA = 'C:/Users/Administrator/AppData/Local/PinaxNext'
const ELECTRON = join(REPO, 'node_modules', 'electron', 'dist', 'electron.exe')
const BUNDLE = join(REPO, 'next', '.build', 'pinax-next-shell-main.mjs')
const PS_CHECK = 'D:/Pinax-e2e/check-renderer.ps1'

mkdirSync(APPDATA, { recursive: true })
mkdirSync(join(APPDATA, 'mirror'), { recursive: true })

function hasRendererChild(pid) {
  try {
    const out = execSync(
      'powershell -NoProfile -ExecutionPolicy Bypass -File "' + PS_CHECK + '" -TargetPid ' + pid,
      { encoding: 'utf8', timeout: 20000 }
    )
    const n = Number.parseInt(String(out).trim(), 10)
    return Number.isFinite(n) && n >= 3
  } catch {
    return false
  }
}

function alive(pid) {
  try {
    const out = execSync(
      'tasklist /FI "PID eq ' + pid + '" /NH',
      { encoding: 'utf8', timeout: 15000 }
    )
    return String(out).includes(String(pid))
  } catch {
    return false
  }
}

let launched = false
for (let attempt = 1; attempt <= 4 && !launched; attempt += 1) {
  const child = spawn(ELECTRON, [BUNDLE], {
    cwd: REPO,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, PINAX_NEXT_ROOT: ROOT, PINAX_APP_DATA: APPDATA, PINAX_MIRROR_ROOT: join(APPDATA, 'mirror') }
  })
  child.unref()
  console.log('attempt ' + attempt + ': pid ' + child.pid)

  for (let wait = 0; wait < 6; wait += 1) {
    await new Promise((r) => setTimeout(r, 3000))
    if (!alive(child.pid)) { console.log('attempt ' + attempt + ': died early'); break }
    if (hasRendererChild(child.pid)) {
      console.log('attempt ' + attempt + ': renderer up -> LAUNCHED OK')
      launched = true
      break
    }
  }
  if (!launched) {
    try { execSync('taskkill /PID ' + child.pid + ' /T /F', { timeout: 20000 }) } catch {}
    console.log('attempt ' + attempt + ': killed, retrying')
    await new Promise((r) => setTimeout(r, 2500))
  }
}

console.log(launched ? 'LAUNCHED OK' : 'ALL ATTEMPTS FAILED')
process.exit(launched ? 0 : 1)
