/**
 * 稳定 id 与纯 JS SHA-1（fact 域纯函数，Core 平移件）。
 *
 * 只用 Web 标准接口（TextEncoder/DataView）：同一函数在 Node 与浏览器侧同值。
 * 只用于稳定 id 与 quote_hash，不做任何安全用途。
 */

function str(value) {
  return String(value ?? '')
}

function utf8Bytes(text) {
  return new TextEncoder().encode(text)
}

export function sha1Hex(input) {
  const bytes = utf8Bytes(str(input))
  const bitLength = bytes.length * 8
  const total = Math.ceil((bytes.length + 9) / 64) * 64
  const data = new Uint8Array(total)
  data.set(bytes)
  data[bytes.length] = 0x80
  const view = new DataView(data.buffer)
  view.setUint32(total - 8, Math.floor(bitLength / 0x100000000))
  view.setUint32(total - 4, bitLength >>> 0)

  let h0 = 0x67452301
  let h1 = 0xefcdab89
  let h2 = 0x98badcfe
  let h3 = 0x10325476
  let h4 = 0xc3d2e1f0
  const w = new Uint32Array(80)

  for (let offset = 0; offset < total; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4)
    for (let i = 16; i < 80; i += 1) {
      const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]
      w[i] = ((x << 1) | (x >>> 31)) >>> 0
    }
    let a = h0
    let b = h1
    let c = h2
    let d = h3
    let e = h4
    for (let i = 0; i < 80; i += 1) {
      let f
      let k
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999 }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1 }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc }
      else { f = b ^ c ^ d; k = 0xca62c1d6 }
      const temp = ((((a << 5) | (a >>> 27)) >>> 0) + (f >>> 0) + e + k + w[i]) >>> 0
      e = d
      d = c
      c = ((b << 30) | (b >>> 2)) >>> 0
      b = a
      a = temp
    }
    h0 = (h0 + a) >>> 0
    h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0
  }
  return [h0, h1, h2, h3, h4].map((value) => value.toString(16).padStart(8, '0')).join('')
}

/** 稳定 id：sha1(layer|domain|slot|name)[:12]；soft 层没有 slot 时按空串参与。 */
export function stableEntryId({ layer, domain = '', slot = '', name = '' } = {}) {
  const key = [str(layer), str(domain), str(slot), str(name)].join('|')
  return sha1Hex(key).slice(0, 12)
}
