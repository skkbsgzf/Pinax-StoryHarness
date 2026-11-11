/* 提交工作树中 next/ 与 docs/ 的全部变更到 feat 分支（2026-11-08 仓库收拢：工具入仓，工作树=本仓根）。
 * 从本仓任意目录跑：node devtools/commit-worktree.mjs <msg文件>；msg 文件等批次产物仍在 D:\Pinax-e2e。 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const ENV = {
  GIT_DIR: 'D:/Pinax-next/.git',
  GIT_WORK_TREE: 'D:/Pinax-next',
  GIT_INDEX_FILE: 'D:/Pinax-next/.git/commit-index',
  GIT_AUTHOR_NAME: 'miniflow',
  GIT_AUTHOR_EMAIL: 'miniflow@local',
  GIT_COMMITTER_NAME: 'miniflow',
  GIT_COMMITTER_EMAIL: 'miniflow@local'
}

function run(cmd) {
  return execSync(cmd, { env: { ...process.env, ...ENV }, encoding: 'utf8', timeout: 120000 })
}

const MSG_FILE = process.argv[2] || 'D:/Pinax-e2e/msg.txt'
run('git read-tree feat/pinax-electron-next')
run('git add -A next/ docs/ devtools/ shared/')
// 根级白名单（批次42 起 .gitattributes/eslint.config.js 有跨根改动；文件不在改动里时 add 是 no-op）
try { run('git add -A .gitattributes eslint.config.js package.json') } catch {}
const tree = run('git write-tree').trim()
const commit = run(`git commit-tree ${tree} -p feat/pinax-electron-next -F ${MSG_FILE}`).trim()
run('git update-ref refs/heads/feat/pinax-electron-next ' + commit)
// 临时索引提交后 real index 已落后 HEAD：不同步的话，下一次手动 git commit 会把旧索引
// 整个提交上去＝幻影回滚（2026-11-08 T4 后真实发生过）。这里用干净环境跑一次 git reset 对齐。
execSync('git reset -q', { cwd: 'D:/Pinax-next', encoding: 'utf8' })
console.log('commit =', commit)
const files = run('git diff --name-status ' + commit + '~1 ' + commit)
console.log(files)
