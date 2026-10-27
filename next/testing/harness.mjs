import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import net from 'node:net'

/**
 * Next 测试工装（M1 · WP6）。
 * 两条硬规矩来自上一轮踩坑：
 *   1) 隔离 appData/mirrorRoot 一律落 os.tmpdir()，绝不指真实注册表；
 *   2) 中文路径不走 `node -e` 传参（会被 shell 编码破坏，导致 pinax_project_open 假失败），
 *      所有用例都在本进程内用字符串常量拼路径，不经过 shell。
 */
export async function createTempWorkspace(label = 'next') {
  const base = await mkdtemp(join(tmpdir(), `pinax-next-${label}-`))
  const appData = join(base, 'appdata')
  const mirrorRoot = join(base, 'mirror')
  const projects = join(base, 'projects')
  await mkdir(appData, { recursive: true })
  await mkdir(mirrorRoot, { recursive: true })
  await mkdir(projects, { recursive: true })
  process.env.PINAX_APP_DATA = appData
  process.env.PINAX_MIRROR_ROOT = mirrorRoot
  process.env.PINAX_PYTHON = process.env.PINAX_PYTHON || 'node'
  const roots = { base, appData, mirrorRoot, projects }
  return {
    ...roots,
    async projectPath(name) {
      const target = join(projects, name)
      await mkdir(target, { recursive: true })
      return target
    },
    /** 造一个非空目录，用于「目标目录非空即拒」的用例。 */
    async dirtyDir(name) {
      const target = join(projects, name)
      await mkdir(join(target, '已存在'), { recursive: true })
      await writeFile(join(target, '已存在', 'notes.md'), '外来内容', 'utf-8')
      return target
    },
    async cleanup() {
      await rm(base, { recursive: true, force: true, maxRetries: 3 })
    }
  }
}

/** 端口探针：证明运行时全程没开监听（一级公民不该靠 HTTP 活着）。 */
export function probePort(port, host = '127.0.0.1', timeoutMs = 250) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port })
    const done = (listening) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(listening)
    }
    socket.setTimeout(timeoutMs)
    socket.on('connect', () => done(true))
    socket.on('timeout', () => done(false))
    socket.on('error', () => done(false))
  })
}

export function pathExists(target) {
  return existsSync(String(target || ''))
}
