// Diagnostic only: record module initialization separately, without waiting on
// executeJavaScript while the renderer might be blocked.
async function main() {
  console.log('DIAGNOSTIC: start')
  await import('react')
  console.log('DIAGNOSTIC: react ready')
  await import('react-dom/client')
  console.log('DIAGNOSTIC: react-dom ready')
  await import('../../src/core/items.ts')
  console.log('DIAGNOSTIC: items ready')
  await import('../../src/data/persistentStorage.ts')
  console.log('DIAGNOSTIC: persistence ready')
  await import('../../src/data/repo.ts')
  console.log('DIAGNOSTIC: repository ready')
  await import('../../src/stores/app.store.ts')
  console.log('DIAGNOSTIC: app store ready')
  await import('../../src/ui/windows/satellite.tsx')
  console.log('DIAGNOSTIC: satellite ready')
  console.log('DIAGNOSTIC: completed')
}
void main().catch(error => console.error('DIAGNOSTIC: error', error instanceof Error ? error.stack : String(error)))
