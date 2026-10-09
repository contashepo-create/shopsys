import { webcrypto, createPublicKey, verify as nodeVerify } from 'node:crypto'
const { subtle } = webcrypto
const L = 2n ** 252n + 27742317777372353535851937790883648493n
const pair = await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
const msg = new TextEncoder().encode('{"v":1,"deviceId":"SHOP-AAAA-BBBB-CCCC","plan":"pro"}')
const sig = new Uint8Array(await subtle.sign('Ed25519', pair.privateKey, msg))
const Sbytes = sig.slice(32)
let S = 0n; for (let i = 31; i >= 0; i--) S = (S << 8n) | BigInt(Sbytes[i])
const S2 = S + L
console.log('S < L ?', S < L, ' S+L fits 256 bits?', S2 < 2n ** 256n)
if (S2 < 2n ** 256n) {
  const alt = new Uint8Array(64); alt.set(sig.slice(0, 32), 0)
  let t = S2; for (let i = 0; i < 32; i++) { alt[32 + i] = Number(t & 0xffn); t >>= 8n }
  const pub = await subtle.importKey('raw', new Uint8Array(await subtle.exportKey('raw', pair.publicKey)), 'Ed25519', true, ['verify'])
  console.log('original verifies (webcrypto):', await subtle.verify('Ed25519', pub, sig, msg))
  console.log('malleated S+L verifies (webcrypto):', await subtle.verify('Ed25519', pub, alt, msg))
  const spki = new Uint8Array(await subtle.exportKey('spki', pair.publicKey))
  const kobj = createPublicKey({ key: Buffer.from(spki), format: 'der', type: 'spki' })
  console.log('malleated S+L verifies (node crypto.verify):', nodeVerify(null, Buffer.from(msg), kobj, Buffer.from(alt)))
  console.log('fingerprint differs:', Buffer.from(sig).toString('base64url') !== Buffer.from(alt).toString('base64url'))
}
