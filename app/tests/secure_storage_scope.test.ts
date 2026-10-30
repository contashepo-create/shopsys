import { describe, expect, it, vi } from 'vitest'

const cryptoMocks = vi.hoisted(() => {
  const resolvers = new Map<string, (ciphertext: string) => void>()
  const encryptText = vi.fn((plain: string) => new Promise<string>((resolve) => {
    resolvers.set(plain, resolve)
  }))
  return { resolvers, encryptText }
})

vi.mock('../src/core/security.ts', () => ({
  deriveKey: vi.fn(async () => ({} as CryptoKey)),
  encryptText: cryptoMocks.encryptText,
  decryptText: vi.fn(async (value: string) => value),
  isEncrypted: (value: string) => value.startsWith('SSENC1.'),
}))

const { secureStorage, flushSecureStorageWrites, setDeviceSecret, unsealStorageAfterReload } = await import('../src/data/secureStorage.ts')

describe('انتظار كتابات secureStorage حسب المخزن', () => {
  it('يفرّغ shopsys-data من دون انتظار أو تفريغ shopsys-app', async () => {
    localStorage.clear()
    localStorage.setItem('shopsys-k', 'a'.repeat(64))
    cryptoMocks.resolvers.clear()
    cryptoMocks.encryptText.mockClear()

    const appWrite = secureStorage.setItem('shopsys-app', 'app-settings')
    const dataWrite = secureStorage.setItem('shopsys-data', 'invoice-data')
    await vi.waitFor(() => expect(cryptoMocks.encryptText).toHaveBeenCalledTimes(2))

    const dataFlush = flushSecureStorageWrites('shopsys-data')
    cryptoMocks.resolvers.get('invoice-data')?.('SSENC1.invoice-data')
    await Promise.all([dataWrite, dataFlush])
    expect(localStorage.getItem('shopsys-data')).toBe('SSENC1.invoice-data')
    expect(localStorage.getItem('shopsys-app')).toBeNull()

    cryptoMocks.resolvers.get('app-settings')?.('SSENC1.app-settings')
    await appWrite
    await flushSecureStorageWrites()
    expect(localStorage.getItem('shopsys-app')).toBe('SSENC1.app-settings')
  })

  it('يحفظ اللقطة الأحدث ولو انتهى تشفيرها قبل الأقدم', async () => {
    localStorage.clear()
    cryptoMocks.resolvers.clear()
    cryptoMocks.encryptText.mockClear()
    const first = secureStorage.setItem('shopsys-data', 'old')
    const second = secureStorage.setItem('shopsys-data', 'new')
    await vi.waitFor(() => expect(cryptoMocks.encryptText).toHaveBeenCalledTimes(2))
    cryptoMocks.resolvers.get('new')!('SSENC1.new')
    // أعطِ الكتابة السريعة فرصة للإنجاز قبل اكتمال التشفير البطيء.
    await new Promise(resolve => setTimeout(resolve, 0))
    cryptoMocks.resolvers.get('old')!('SSENC1.old')
    await Promise.all([first, second])
    await flushSecureStorageWrites('shopsys-data')
    expect(localStorage.getItem('shopsys-data')).toBe('SSENC1.new')
  })


  it('لا تكتب عملية بدأت قبل تغيير السر حتى لو فُتح الختم قبل اكتمال التشفير', async () => {
    localStorage.clear()
    localStorage.setItem('shopsys-k', 'a'.repeat(64))
    cryptoMocks.resolvers.clear()
    cryptoMocks.encryptText.mockClear()
    const pending = secureStorage.setItem('shopsys-data', 'old-key-data')
    await vi.waitFor(() => expect(cryptoMocks.encryptText).toHaveBeenCalledTimes(1))
    setDeviceSecret('b'.repeat(64))
    unsealStorageAfterReload()
    cryptoMocks.resolvers.get('old-key-data')!('SSENC1.old-key-data')
    await pending
    expect(localStorage.getItem('shopsys-data')).toBeNull()
  })

})
