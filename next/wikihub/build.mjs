/* eslint-disable no-console */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseWorldbookEntryFile } from '@pinax/core/domain/worldbookFileContract'
import { PEDIA_SCHEMA } from '../pedia/domain/pediaSchema.js'
import { worldbookToHub } from './convert.mjs'
import { WIKIHUB_HTML_VERSION, renderHubHtml } from './render.mjs'

/**
 * wikihub 离线视图的生成管线（世界书 → pedia/v2 hub → 单文件 HTML）。
 *
 * 一条链：读「世界书/」（顶层 md ＋ 一级类别目录里的 md）→ W1 的 worldbookToHub 转 hub
 * → renderHubHtml 出 HTML → 写 `.pinax/wikihub/index.html` 与 `hub.json`。
 *
 * 为什么要落 `.pinax/wikihub/`：那是项目自己的派生目录（和 project.json 同住 .pinax/），
 * 随项目走、不污染作者的「世界书/」原稿；删掉随时能重生成。HTML 是**静态快照**，
 * 断网双击就能读，不依赖 Next 外壳、服务或脚本。
 *
 * 用法（Node 侧）：
 *   import { buildWikihub } from './next/wikihub/build.mjs'
 *   const result = await buildWikihub({ projectRoot: 'D:/某项目' })
 *
 * 用法（命令行）：
 *   node next/wikihub/build.mjs --project D:/某项目 [--out .pinax/wikihub]
 *     [--book 书名] [--domain 域] [--title 页面标题] [--generated-at ISO] [--strip-content]
 *
 * 边界：本文件只做「读 + 转 + 写」，不注册工具、不碰 manifest；工具面与 pane 入口不在这里。
 */

export const WIKIHUB_OUTPUT_DIR = '.pinax/wikihub'
export const WIKIHUB_INDEX_FILE = 'index.html'
export const WIKIHUB_HUB_FILE = 'hub.json'

function firstText(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function byName(a, b) {
  return a.name.localeCompare(b.name, 'zh-Hans-CN')
}

/**
 * 读「世界书/」：顶层 md ＋ 一级类别子目录里的 md（一层封顶，与内核 pinax_worldbook_list 同口径）。
 * 不符合文件契约的裸 md 仍然收录（整篇当正文，name 取文件名），并由转换器如实记 loss。
 * 第二层目录与读失败都记账返回，不静默。
 */
export async function readWorldbookEntries(projectRoot) {
  const root = resolve(String(projectRoot ?? ''))
  const dir = join(root, '世界书')
  let top
  try {
    top = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'WORLDBOOK_DIR_MISSING',
        message: `项目里没有可读的「世界书/」目录：${dir}`,
        cause: error?.code ?? ''
      },
      entries: [],
      files: [],
      skippedDirs: [],
      readErrors: []
    }
  }

  const entries = []
  const files = []
  const skippedDirs = []
  const readErrors = []

  const consume = async (absolutePath, relativePath, catDir) => {
    files.push(relativePath)
    let content
    try {
      content = await readFile(absolutePath, 'utf8')
    } catch (error) {
      readErrors.push({ path: `世界书/${relativePath}`, message: error?.message ?? String(error) })
      return
    }
    const parsed = parseWorldbookEntryFile(content)
    if (parsed.ok) {
      entries.push({
        ...parsed.entry,
        contract: true,
        catDir,
        path: `世界书/${relativePath}`
      })
      return
    }
    // 裸 md：没有 frontmatter/id，按整篇正文收录；转换器会给 worldbook-frontmatter-unavailable 的 loss。
    const name = basename(absolutePath).replace(/\.md$/iu, '')
    entries.push({ name, content, catDir, path: `世界书/${relativePath}` })
  }

  const sortedTop = [...top].sort(byName)
  for (const item of sortedTop) {
    if (item.isFile() && /\.md$/iu.test(item.name)) {
      await consume(join(dir, item.name), item.name, '')
      continue
    }
    if (!item.isDirectory()) continue
    const subDir = join(dir, item.name)
    let children
    try {
      children = await readdir(subDir, { withFileTypes: true })
    } catch (error) {
      readErrors.push({ path: `世界书/${item.name}`, message: error?.message ?? String(error) })
      continue
    }
    for (const child of [...children].sort(byName)) {
      if (child.isDirectory()) {
        skippedDirs.push(`世界书/${item.name}/${child.name}`)
        continue
      }
      if (child.isFile() && /\.md$/iu.test(child.name)) {
        await consume(join(subDir, child.name), `${item.name}/${child.name}`, item.name)
      }
    }
  }

  return { ok: true, entries, files, skippedDirs, readErrors }
}

async function readProjectName(projectRoot) {
  try {
    const doc = JSON.parse(await readFile(join(projectRoot, '.pinax', 'project.json'), 'utf8'))
    return firstText(doc?.name)
  } catch {
    return ''
  }
}

/**
 * 生成离线 wiki：读世界书 → 转 hub → 渲染 → 落盘。
 * 返回摘要（不含整页 HTML）：{ ok, indexFile, hubFile, entries, warnings, losses, issues, ... }。
 * 失败时返回 { ok:false, error:{ code, message } }，不抛异常（CLI 与测试都按返回值判）。
 */
export async function buildWikihub(options = {}) {
  const projectRoot = resolve(String(options.projectRoot ?? process.cwd()))
  const read = await readWorldbookEntries(projectRoot)
  if (!read.ok) return { ok: false, error: read.error, projectRoot }

  const book = firstText(options.book, await readProjectName(projectRoot), basename(projectRoot), '世界书')
  const domain = firstText(options.domain, book)
  const generatedAt = firstText(options.generatedAt) || new Date().toISOString()
  const hub = worldbookToHub({ entries: read.entries }, {
    book,
    domain,
    genre: firstText(options.genre) || undefined,
    stripContent: options.stripContent === true
  })
  if (!hub.ok) {
    return {
      ok: false,
      error: hub.issues[0] ?? { code: 'WIKIHUB_CONVERT_FAILED', message: '世界书转 pedia hub 失败' },
      projectRoot,
      read
    }
  }

  const notices = [
    ...read.readErrors.map((item) => `读取失败：${item.path}（${item.message}）`),
    ...read.skippedDirs.map((dir) => `${dir} 是第二层目录，本批只收一层，未收录`),
    ...hub.warnings.map((warning) => warning.message),
    ...hub.issues.map((issue) => issue.message ?? '转换有问题（详见 hub.json）')
  ]
  const html = renderHubHtml(hub, {
    book,
    domain,
    title: options.title,
    generatedAt,
    notices
  })

  const outDir = resolve(projectRoot, String(options.outDir ?? WIKIHUB_OUTPUT_DIR))
  const indexFile = join(outDir, WIKIHUB_INDEX_FILE)
  const hubFile = join(outDir, WIKIHUB_HUB_FILE)
  const hubDocument = {
    version: WIKIHUB_HTML_VERSION,
    schema: PEDIA_SCHEMA,
    generatedAt,
    book,
    domain,
    files: read.files,
    skippedDirs: read.skippedDirs,
    readErrors: read.readErrors,
    entries: hub.entries,
    index: hub.index,
    mappings: hub.mappings,
    // S1：文风能力包随 hub 落盘（pedia/v2 无 style 层），视图侧从 hub.json 直接取。
    stylePack: hub.stylePack,
    losses: hub.losses,
    warnings: hub.warnings,
    validationWarnings: hub.validationWarnings,
    issues: hub.issues
  }
  await mkdir(outDir, { recursive: true })
  await writeFile(indexFile, html, 'utf8')
  await writeFile(hubFile, `${JSON.stringify(hubDocument, null, 2)}\n`, 'utf8')

  return {
    ok: true,
    projectRoot,
    outDir,
    indexFile,
    hubFile,
    book,
    domain,
    generatedAt,
    entries: hub.entries.length,
    stylePack: hub.stylePack,
    styleEntries: Array.isArray(hub.stylePack?.entries) ? hub.stylePack.entries.length : 0,
    files: read.files,
    skippedDirs: read.skippedDirs,
    readErrors: read.readErrors,
    warnings: hub.warnings,
    validationWarnings: hub.validationWarnings,
    losses: hub.losses,
    issues: hub.issues,
    hub
  }
}

/* ---------- CLI ---------- */

function parseArgv(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) continue
    const eq = token.indexOf('=')
    if (eq > 0) {
      args[token.slice(2, eq)] = token.slice(eq + 1)
      continue
    }
    const key = token.slice(2)
    const next = argv[i + 1]
    if (next && !next.startsWith('--')) {
      args[key] = next
      i += 1
    } else {
      args[key] = true
    }
  }
  return args
}

function isMainModule() {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return pathToFileURL(resolve(entry)).href === import.meta.url
  } catch {
    return false
  }
}

if (isMainModule()) {
  const args = parseArgv(process.argv.slice(2))
  const result = await buildWikihub({
    projectRoot: firstText(args.project) || process.cwd(),
    outDir: firstText(args.out) || undefined,
    book: firstText(args.book) || undefined,
    domain: firstText(args.domain) || undefined,
    title: firstText(args.title) || undefined,
    generatedAt: firstText(args['generated-at']) || undefined,
    genre: firstText(args.genre) || undefined,
    stripContent: args['strip-content'] === true || args['strip-content'] === 'true'
  })
  if (!result.ok) {
    console.error(JSON.stringify({ ok: false, error: result.error }, null, 2))
    process.exitCode = 2
  } else {
    console.log(JSON.stringify({
      ok: true,
      projectRoot: result.projectRoot,
      outDir: result.outDir,
      indexFile: result.indexFile,
      hubFile: result.hubFile,
      book: result.book,
      entries: result.entries,
      styleEntries: result.styleEntries,
      files: result.files,
      skippedDirs: result.skippedDirs,
      readErrors: result.readErrors,
      warnings: result.warnings.length,
      losses: result.losses.length,
      issues: result.issues.length,
      generatedAt: result.generatedAt
    }, null, 2))
  }
}

export default buildWikihub
