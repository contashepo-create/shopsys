import { useLayoutEffect, useRef } from 'react'
import { openPrintPreview, usePrintPreview } from '../components/printPreviewStore.ts'

/** يربط معاينة واحدة بالمحرر الذي فتحها، دون اعتراض معاينة محرر آخر. */
export function useLivePrintPreview<T>(build: (args: T) => string) {
  const latest = useRef(build)
  const owned = useRef<(() => string) | null>(null)
  useLayoutEffect(() => {
    latest.current = build
    const preview = usePrintPreview.getState()
    if (preview.open && preview.handle?.rebuild === owned.current) preview.refresh()
  })
  return (args: T, options: { wide: boolean; title: string }) => {
    const rebuild = () => latest.current(args)
    const html = rebuild()
    owned.current = rebuild
    openPrintPreview({ html, rebuild, ...options })
  }
}
