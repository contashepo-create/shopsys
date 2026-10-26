// Browser-capability shim for UI/repository tests. The app itself still fails closed when
// Web Locks are genuinely unavailable; unsupported-browser behavior is covered explicitly
// by invoice_commit_lock.test.ts, which overrides this deterministic in-memory test lock.
const navigatorWithLocks = navigator as Navigator & {
  locks?: { request: <T>(name: string, options: { mode: 'exclusive' }, callback: () => Promise<T> | T) => Promise<T> }
}

Object.defineProperty(navigatorWithLocks, 'locks', {
  configurable: true,
  writable: true,
  value: {
    request: async <T>(_name: string, _options: { mode: 'exclusive' }, callback: () => Promise<T> | T): Promise<T> => callback(),
  },
})
