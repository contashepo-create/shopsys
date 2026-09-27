import { useMemo, type ReactNode } from 'react'
import { useWindowStore } from './windowStore.ts'
import { WindowHostContext, type WindowHostApi } from './windowHostContext.ts'

export function WindowHostProvider({ windowId, props, children }: { windowId: string; props: Record<string, unknown>; children: ReactNode }) {
  const closeWindow = useWindowStore((s) => s.closeWindow)
  const setWindowDirty = useWindowStore((s) => s.setWindowDirty)
  const setWindowTitle = useWindowStore((s) => s.setWindowTitle)
  const openWindow = useWindowStore((s) => s.openWindow)
  const api = useMemo<WindowHostApi>(() => ({
    windowId,
    props,
    close: () => closeWindow(windowId),
    setDirty: (dirty: boolean) => setWindowDirty(windowId, dirty),
    setTitle: (title: string, subtitle?: string) => setWindowTitle(windowId, title, subtitle),
    openChild: (input) => openWindow({ ...input, parentId: windowId }),
  }), [windowId, props, closeWindow, setWindowDirty, setWindowTitle, openWindow])
  return <WindowHostContext.Provider value={api}>{children}</WindowHostContext.Provider>
}
