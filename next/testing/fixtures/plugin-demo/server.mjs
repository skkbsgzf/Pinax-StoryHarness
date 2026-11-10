import http from 'node:http'

/**
 * 夹具插件自带的 HTTP 服务（协议 v3 `services` 声明面的真靶子）。
 *
 * 宿主按清单把它起成子进程，工作目录＝插件目录（相对路径的解析基准），
 * 端口与健康路径由宿主探针来问。所以这一份只管三件事：
 *   GET /health → 200（探针的靶子）
 *   GET /        → 200 带一行身份（证明「谁在监听」）
 *   GET /whoami  → JSON 说出进程号与端口（证明是这一份子进程在答，不是别的）
 * 不读盘、不联网、不碰作者项目。
 */
const port = Number.parseInt(process.env.PORT ?? '0', 10)
const pluginId = process.env.PINAX_PLUGIN_ID ?? 'demo.v3'

const server = http.createServer((req, res) => {
  if (req.url === '/whoami') {
    const address = server.address()
    const body = JSON.stringify({ ok: true, pluginId, pid: process.pid, port: address?.port ?? null })
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    res.end(body)
    return
  }
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
  res.end(`ok ${req.url}`)
})

server.listen(port, '127.0.0.1', () => {
  const address = server.address()
  console.log(`demo plugin service listening on ${address.port} (pid ${process.pid})`)
})

process.on('SIGTERM', () => {
  server.close(() => process.exit(0))
})
