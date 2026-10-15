// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { createCipheriv, createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ShopsysDatabase } from '../desktop/sqlite/storage.ts'
import { probeSnapshotKey } from '../desktop/snapshotKeyProbe.ts'

const directories: string[] = []
const makeDirectory = () => {
  const directory = mkdtempSync(join(tmpdir(), 'shopsys-key-preflight-'))
  directories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function encryptSnapshot(key: Buffer, payload: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final(), cipher.getAuthTag()])
  return `enc:v1:${iv.toString('base64url')}:${ciphertext.toString('base64url')}`
}

async function createDatabase(filename: string, payloadJson: string): Promise<void> {
  const database = await ShopsysDatabase.open(filename)
  try {
    database.saveSnapshot({ storeName: 'shopsys-data', expectedRevision: 0, payloadJson })
  } finally {
    database.close()
  }
}

describe('فحص مفتاح اللقطات قبل ترحيل قاعدة SQLite', () => {
  it('يثبت أن المفتاح الحالي يفتح اللقطة المشفرة، ويكشف المفتاح المختلف', async () => {
    const directory = makeDirectory()
    const filename = join(directory, 'shopsys.db')
    const correctKey = randomBytes(32)
    const payload = JSON.stringify({ state: { balance: 98766 }, version: 0 })
    await createDatabase(filename, encryptSnapshot(correctKey, payload))

    expect(probeSnapshotKey(filename, correctKey)).toEqual({ status: 'verified', stores: ['shopsys-data'] })
    expect(probeSnapshotKey(filename, randomBytes(32))).toEqual({ status: 'mismatch', stores: ['shopsys-data'] })
  })

  it('يفحص كل المتاجر ويرفض قاعدة فيها لقطة واحدة لا يطابقها المفتاح', async () => {
    const directory = makeDirectory()
    const filename = join(directory, 'shopsys.db')
    const key = randomBytes(32)
    const database = await ShopsysDatabase.open(filename)
    try {
      database.saveSnapshot({ storeName: 'shopsys-app', expectedRevision: 0, payloadJson: encryptSnapshot(key, '{"state":{}}') })
      database.saveSnapshot({ storeName: 'shopsys-data', expectedRevision: 0, payloadJson: encryptSnapshot(randomBytes(32), '{"state":{}}') })
    } finally {
      database.close()
    }

    expect(probeSnapshotKey(filename, key)).toEqual({ status: 'mismatch', stores: ['shopsys-data'] })
  })

  it('لا يكتب شيئاً في قاعدة البيانات أثناء الفحص الفاشل', async () => {
    const directory = makeDirectory()
    const filename = join(directory, 'shopsys.db')
    const key = randomBytes(32)
    await createDatabase(filename, encryptSnapshot(key, '{"state":{"balance":10}}'))
    const before = createHash('sha256').update(readFileSync(filename)).digest('hex')

    expect(probeSnapshotKey(filename, randomBytes(32)).status).toBe('mismatch')

    const after = createHash('sha256').update(readFileSync(filename)).digest('hex')
    expect(after).toBe(before)
  })

  it('يتجاوز القواعد الغائبة أو اللقطات النصية القديمة، ولا يعتبرها فشل مفتاح', async () => {
    const directory = makeDirectory()
    const missing = join(directory, 'missing.db')
    expect(probeSnapshotKey(missing, randomBytes(32))).toEqual({ status: 'missing', stores: [] })

    const plain = join(directory, 'plain.db')
    await createDatabase(plain, '{"state":{"legacy":true}}')
    expect(probeSnapshotKey(plain, randomBytes(32))).toEqual({ status: 'no-encrypted-snapshots', stores: [] })
  })
})
