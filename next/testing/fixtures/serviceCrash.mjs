/**
 * 夹具服务：起来 200ms 后自己崩掉（退出码 3），用来验「崩溃重启」与「不重启」两种策略。
 * 传 argv[2] 数字＝崩前毫秒数；传 'never' 之类不影响本脚本行为（策略由清单决定）。
 */
const delayMs = Number.parseInt(process.argv[2] ?? '200', 10)
console.log(`fixture service will crash in ${delayMs}ms`)
setTimeout(() => {
  console.error('fixture service crashed on purpose')
  process.exit(3)
}, delayMs)
