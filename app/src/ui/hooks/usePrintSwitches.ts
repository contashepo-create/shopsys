/**
 * hook مفاتيح الطباعة الثلاثة — أُنقل من ملف مكونات PrintSwitches.tsx
 * (سياسة اللينت الصارم: ملف المكونات يصدّر مكونات فقط — Fast Refresh).
 * يقرأ حالة المفاتيح من إعدادات الطباعة فتبقى بين الفواتير والجلسات.
 */
import { useAppStore } from '../../stores/app.store.ts'

export type PrintSwitchState = { silentPrint: boolean; cashierPrint: boolean; printAfterSave: boolean }

export function usePrintSwitches(): PrintSwitchState {
  const receipt = useAppStore((s) => s.receipt)
  return {
    silentPrint: receipt.silentPrint ?? false,
    cashierPrint: receipt.cashierPrint ?? false,
    printAfterSave: receipt.printAfterSave ?? false,
  }
}
