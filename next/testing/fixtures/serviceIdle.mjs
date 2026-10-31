/**
 * 夹具服务：只活着，不监听任何端口（用来验「端口探不通」的那条路径）。
 */
console.log('fixture service idling (no port)')
setInterval(() => {}, 1 << 30)
