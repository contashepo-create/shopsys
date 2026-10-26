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

const { secureStorage, flushSecureStorageWrites } = await import('../src/data/secureStorage.ts')

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
})
