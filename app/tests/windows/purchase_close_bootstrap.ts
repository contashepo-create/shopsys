/* Keep document load independent of application module initialization so CI can report failures. */
console.log('Purchase smoke bootstrap started')
Object.assign(window, { __smokeStage: 'loading application modules' })
void import('./purchase_close_fixture.tsx').catch(error => {
  Object.assign(window, { __smokeError: error instanceof Error ? error.stack ?? error.message : String(error) })
})
