/** التثبيت يبدأ صراحةً قبل app.exit؛ لا اعتماد على حدث quit الذي لا يرسله exit. */
export interface SilentUpdateDeps {
  flush: () => Promise<void>
  protect: () => Promise<void>
  backup: () => Promise<void>
  close: () => void
  install: () => void
  exit: () => void
}

export async function installSilentUpdate(deps: SilentUpdateDeps): Promise<void> {
  // أي فشل قبل close يُبقي القاعدة مفتوحة ولا يبدأ المثبّت.
  await deps.flush()
  await deps.protect()
  await deps.backup()
  deps.close()
  deps.install()
  deps.exit()
}

export async function withDeadline<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([work, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms)
    })])
  } finally { if (timer) clearTimeout(timer) }
}
