// CI فقط: يعمل داخل Electron الحقيقي لفك DPAPI وفحص SQLite ABI بعد إعادة البناء.
const { app, safeStorage } = require('electron')
const { readFileSync, writeFileSync, existsSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { createCipheriv, createDecipheriv, randomBytes } = require('node:crypto')
const Database = require('better-sqlite3')
const [mode, ud, file, output, destination] = process.argv.slice(2)
// safeStorage على Windows يستعمل مفتاح Chromium في Local State؛ DPAPI وحده
// لا يكفي لفك ciphertext من profile آخر. التطبيق مثبت لكنه مغلق أثناء الفحص.
app.setName('Tahakom')
app.setPath('userData', ud)
app.setPath('sessionData', ud)
app.whenReady().then(async () => {
  try {
    const encryptedKey = readFileSync(join(ud, 'device.key.enc'), 'utf8')
    // ابق العقد مطابقاً لوحدة deviceKeyStore بدلاً من طباعة المفتاح.
    const actualMagic = require('node:fs').readFileSync(resolve('desktop/deviceKeyStore.ts'), 'utf8').match(/const ENC_MAGIC = ['"]([^'"]+)/)?.[1]
    if (!actualMagic || !encryptedKey.startsWith(actualMagic)) throw new Error('Invalid encrypted key format')
    const key = Buffer.from(safeStorage.decryptString(Buffer.from(encryptedKey.slice(actualMagic.length).trim(), 'base64')), 'base64')
    if (key.length !== 32) throw new Error('Invalid device key length')
    const expected = JSON.stringify({ state: { ciSentinel: 'actual-native-nsis-update', balance: ['advance', 'verify-latest', 'copy-latest'].includes(mode) ? 98766 : 98765 } })
    const db = new Database(file, { readonly: !['seed', 'advance'].includes(mode), fileMustExist: true })
    try {
      if (mode === 'seed' || mode === 'advance') {
        const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv)
        const bytes = Buffer.concat([cipher.update(expected), cipher.final(), cipher.getAuthTag()])
        const payload = `enc:v1:${iv.toString('base64url')}:${bytes.toString('base64url')}`
        const id = db.prepare("SELECT value FROM meta WHERE key='device_id'").get().value
        if (mode === 'advance') {
          if (db.prepare("UPDATE snapshots SET payload_json=?, revision=revision+1, updated_at=? WHERE store_name='ci-native-update'").run(payload, new Date().toISOString()).changes !== 1) throw new Error('Expected one original fixture snapshot')
        } else db.prepare('INSERT INTO snapshots (store_name,revision,payload_json,origin_device,origin_branch,updated_at) VALUES (?,?,?,?,?,?)').run('ci-native-update', 1, payload, id, '', new Date().toISOString())
        db.pragma('wal_checkpoint(TRUNCATE)') // fixture سيُنسخ ملفياً بعد غلق الاتصال
      } else {
        if (db.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('SQLite integrity failed')
        const payload = db.prepare("SELECT payload_json FROM snapshots WHERE store_name='ci-native-update'").get()?.payload_json
        if (!payload) throw new Error('Original snapshot missing in ' + file + '; stores=' + JSON.stringify(db.prepare('SELECT store_name,revision FROM snapshots').all()))
        const [, , iv, ct] = payload.split(':'); const bytes = Buffer.from(ct, 'base64url')
        const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'))
        decipher.setAuthTag(bytes.subarray(-16))
        const plain = Buffer.concat([decipher.update(bytes.subarray(0, -16)), decipher.final()]).toString('utf8')
        if (plain !== expected) throw new Error('Original encrypted data changed')
        if (mode === 'copy' || mode === 'copy-latest') {
          if (!destination || existsSync(destination)) throw new Error('Backup destination missing or already exists')
          await db.backup(destination)
        }
      }
    } finally { db.close() }
    writeFileSync(output, JSON.stringify({ ok: true, mode, file }))
    app.exit(0)
  } catch (error) {
    writeFileSync(output, JSON.stringify({ ok: false, error: error.message }))
    app.exit(1)
  }
})
