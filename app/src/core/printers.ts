/**
 * §102 (مراجعة المالك — تعدد الطابعات الحرارية): مسارات الطباعة المسماة —
 * فاتورة واحدة تُطبع نسخاً متعددة، كل نسخة إلى طابعتها (عميل/مطبخ/محطة).
 *
 * قاعدة الصراحة (سؤال المالك): **المتصفح لا يستطيع** تعداد طابعات النظام ولا
 * الطباعة الصامتة على طابعة باسمها — هذه قدرة نسخة EXE فقط عبر جسر
 * `shopsysPrint`/`shopsysPrinters` (Electron: webContents.getPrinters +
 * خيار printerName في print). في المتصفح: الطباعة تمر بحوار النظام،
 * وطابعات الشبكة يراها التطبيق إذا رآها نظام التشغيل (مثبتة عليه).
 */

export type PrintRoute = 'clientReceipt' | 'kitchenTicket' | 'stationTicket'

export interface PrinterProfile {
  /** اسم الطابعة كما يعرفه نظام التشغيل — '' يعني طابعة النظام الافتراضية */
  printerName: string
  /** الطباعة الآلية عند الحدث (إقفال أمر مطعم…) — مطفأة افتراضياً */
  autoPrint: boolean
}

export type PrinterProfiles = Record<PrintRoute, PrinterProfile>

export interface PrintRouteMeta {
  route: PrintRoute
  nameAr: string
  icon: string
  descAr: string
  /** متى تُطلق النسخة الآلية */
  autoEventAr: string
}

export const PRINT_ROUTES: readonly PrintRouteMeta[] = [
  {
    route: 'clientReceipt', nameAr: 'إيصال العميل', icon: '🧾',
    descAr: 'فاتورة العميل الحرارية عند إقفال أمر المطعم/الكافيه',
    autoEventAr: 'عند إقفال الأمر وفوترته',
  },
  {
    route: 'kitchenTicket', nameAr: 'بون المطبخ', icon: '👨‍🍳',
    descAr: 'بون 80mm بلا أسعار للمطبخ — أصناف فقط',
    autoEventAr: 'عند إقفال الأمر (نسخة المطبخ)',
  },
  {
    route: 'stationTicket', nameAr: 'بون المحطة', icon: '🥤',
    descAr: 'نسخة ثانية لطابعة المحطة (عصائر/بار/تحضير)',
    autoEventAr: 'عند إقفال الأمر (نسخة المحطة)',
  },
]

export const DEFAULT_PRINTER_PROFILES: PrinterProfiles = {
  clientReceipt: { printerName: '', autoPrint: false },
  kitchenTicket: { printerName: '', autoPrint: false },
  stationTicket: { printerName: '', autoPrint: false },
}

/**
 * دفاعية الهجرة (دالة خالصة تُفحص بالبوابة): أي شكل قديم/ناقص/فاسد
 * يُستكمل بالافتراضي — الأسماء تُقص بحدود معقولة والمفاتيح المنطقية صارمة.
 */
export function normalizePrinterProfiles(input: unknown): PrinterProfiles {
  const out: PrinterProfiles = {
    clientReceipt: { ...DEFAULT_PRINTER_PROFILES.clientReceipt },
    kitchenTicket: { ...DEFAULT_PRINTER_PROFILES.kitchenTicket },
    stationTicket: { ...DEFAULT_PRINTER_PROFILES.stationTicket },
  }
  if (!input || typeof input !== 'object') return out
  const rows = input as Record<string, unknown>
  for (const meta of PRINT_ROUTES) {
    const row = rows[meta.route]
    if (!row || typeof row !== 'object') continue
    const { printerName, autoPrint } = row as Record<string, unknown>
    out[meta.route] = {
      printerName: typeof printerName === 'string' ? printerName.trim().slice(0, 120) : '',
      autoPrint: autoPrint === true,
    }
  }
  return out
}
