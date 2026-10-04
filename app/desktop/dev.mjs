/**
 * تشغيل نسخة سطح المكتب للتطوير: vite وelectron معاً —
 *Electron يحمّل خادم vite (HMR كامل)، والقاعدة shopsys.db في userData الحقيقي.
 * الاستخدام: npm run desktop:dev
 */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'

const vitePort = Number(process.env.VITE_PORT ?? 5173)

const free = (port) =>
  new Promise((resolve) => {
    const srv = createServer()
    srv.once('error', () => resolve(false))
    srv.once('listening', () => srv.close(() => resolve(true)))
    srv.listen(port, '127.0.0.1')
  })

const waitPort = async (port, timeoutMs = 60_000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const listening = !(await free(port)) /* المنفذ مشغول = vite يستمع */
    if (listening) return true
    await new Promise((r) => setTimeout(r, 400))
  }
  throw new Error(`vite لم يفتح المنفذ ${port}`)
}

const npx = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const vite = spawn(npx, ['run', 'dev', '--', '--port', String(vitePort), '--strictPort'], { stdio: 'inherit' })
vite.on('exit', () => process.exit(0))

await waitPort(vitePort)

const electron = spawn(npx, ['exec', 'electron', 'dist-desktop/main.cjs'], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_START_URL: `http://localhost:${vitePort}` },
})
electron.on('exit', () => {
  vite.kill()
  process.exit(0)
})
await once(process, 'SIGINT').catch(() => undefined)
electron.kill()
vite.kill()
process.exit(0)
