import http from 'node:http'

/**
 * 夹具服务：真起一个 HTTP 服务，监听 PORT，供服务监督器的端口探针与健康检查使用。
 * 只回两件事：GET /health → 200，GET / → 200。别的路径也回 200（监督器只看「有没有应答」）。
 */
const port = Number.parseInt(process.env.PORT ?? '0', 10)
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
  res.end(`ok ${req.url}`)
})
server.listen(port, '127.0.0.1', () => {
  const address = server.address()
  console.log(`fixture service listening on ${address.port}`)
})
process.on('SIGTERM', () => {
  server.close(() => process.exit(0))
})
