/** Test-only encoder for fixtures written by historical Electron releases. */
const ENC_PREFIX = 'enc:v1:'

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function encryptLegacySnapshotForTest(payloadJson: string, keyBytes: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes as unknown as ArrayBuffer,
    { name: 'AES-GCM' },
    false,
    ['encrypt'],
  )
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as ArrayBuffer },
    key,
    new TextEncoder().encode(payloadJson) as unknown as ArrayBuffer,
  )
  return `${ENC_PREFIX}${bytesToBase64Url(iv)}:${bytesToBase64Url(new Uint8Array(ciphertext))}`
}
