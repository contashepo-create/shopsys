import { createContext, useContext } from 'react'
import type { OpenWindowInput } from './windowStore.ts'

export interface WindowHostApi {
  /** معرّف النافذة الحاوية للمحتوى الحالي */
  windowId: string
  /** خصائص فُتحت بها النافذة (مثل editId للفاتورة) */
  props: Record<string, unknown>
  /** إغلاق هذه النافذة وحدها (وبناتها) */
  close: () => void
  /** تعليم/إلغاء «تعديلات غير محفوظة» — يجعل زر الإغلاق يسأل أولاً */
  setDirty: (dirty: boolean) => void
  setTitle: (title: string, subtitle?: string) => void
  /** فتح نافذة ابنة فوق هذه النافذة */
  openChild: (input: Omit<OpenWindowInput, 'parentId'>) => string
}

export const WindowHostContext = createContext<WindowHostApi | null>(null)

/** يرجع واجهة النافذة الحاوية، أو null إذا كان المكوّن معروضاً كصفحة عادية. */
export function useWindowHost(): WindowHostApi | null {
  return useContext(WindowHostContext)
}
