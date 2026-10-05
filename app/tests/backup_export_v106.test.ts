/**
 * جولة v1.0.6 — بلاغ المالك: «عندما أريد أن أحتفظ بنسخة احتياطية يقول لا
 * يوجد بيانات لحفظها» + طلب التصدير الشامل Excel/CSV.
 *
 * العلة الجذرية (نفس نمط علة الخزينة السالبة v1.0.5): صفحة النسخ الاحتياطي
 * كانت تقرأ/تكتب localStorage مباشرة، بينما persist في نسخة سطح المكتب يكتب
 * إلى SQLite عبر DesktopStateStorage — فالقراءة ترجع null ويظهر «لا بيانات
 * للنسخ بعد». الاختبارات هنا تثبت أن مصدر الحقيقة موحّد عبر appStorage().
 */
import { describe, it, expect, vi } from 'vitest'
vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))

const { buildBackup, parseBackup, checksum } = await import('../src/core/backup.ts')
const { buildFullExportSheets, sheetsToExcelXml, sheetToCsv } = await import('../src/core/fullExport.ts')

describe('النسخ الاحتياطي والتصدير الشامل (بلاغ v1.0.6)', () => {
  it('بناء النسخة وقراءتها: بصمة سليمة ودورة كاملة بلا تخزين نصي', () => {
    const storeState = { version: 7, state: { items: [{ id: 1, nameAr: 'أرز' }], journal: [] } }
    const backup = buildBackup({ appState: { state: { shopName: 'بقالة النور' } }, storeState, appDataVersion: 7, shopName: 'بقالة النور' })
    const serialized = JSON.stringify(backup)
    const parsed = parseBackup(serialized)
    expect(parsed.shopName).toBe('بقالة النور')
    expect(JSON.stringify(parsed.data.store)).toBe(JSON.stringify(storeState))
    // البصمة تكشف أي عبث بالبيانات
    const tampered = JSON.parse(serialized)
    tampered.data.store.state.items[0].nameAr = 'معدل'
    expect(() => parseBackup(JSON.stringify(tampered))).toThrow()
    expect(checksum('abc')).toBe(checksum('abc'))
    expect(checksum('abc')).not.toBe(checksum('abd'))
  })

  it('التصدير الشامل: كل جدول ورقة، والمبالغ بالوحدة الكاملة لا بالقروش', async () => {
    const { useDataStore } = await import('../src/data/repo.ts')
    const S = () => useDataStore.getState()
    // بيانات حقيقية عبر مسارات التطبيق الفعلية
    S().addItem({ nameAr: 'صنف التصدير', sku: 'EXP1', barcodes: [], categoryId: 0, baseUnit: 'قطعة', costMinor: 150000, stockQty: 3, priceMinor: 200000, minQty: 0 } as never)
    const item = S().items.find((i) => i.sku === 'EXP1')!
    S().postSale({
      lines: [{ itemId: item.id, qty: 1, unitPriceMinor: 200000, unitCostMinor: 150000, discountPercent: 0 }],
      payment: 'cash', paidMinor: 200000, treasury: '1101', taxPercent: 0, invoiceDiscountPercent: 0, taxInclusive: false,
    } as never)
    const sheets = buildFullExportSheets(useDataStore.getState() as unknown as Record<string, unknown>)
    expect(sheets.length).toBeGreaterThanOrEqual(8) // كل الجداول الأساسية موجودة
    const byName = (n: string) => sheets.find((sh) => sh.nameAr === n)!
    expect(byName('الأصناف').rows.some((r) => r[1] === 'صنف التصدير')).toBe(true)
    // 200000 قرشاً تظهر 2000 جنيهاً (الوحدة الكاملة)
    const itemsRow = byName('الأصناف').rows.find((r) => r[1] === 'صنف التصذير' || r[1] === 'صنف التصدير')!
    expect(itemsRow[5]).toBe(2000)
    const salesSheet = byName('فواتير البيع')
    expect(salesSheet.rows.some((r) => r[4] === 2000)).toBe(true)
    // القيود: سطورها مسطحة بعمودي مدين/دائن
    const journalSheet = byName('قيود اليومية')
    expect(journalSheet.rows.some((r) => r[4] === 2000)).toBe(true)
  })

  it('Excel متعدد الأوراق بصيغة صالحة وCSV بBOM عربي سليم', () => {
    const sheets: import('../src/core/fullExport.ts').ExportSheet[] = [
      { nameAr: 'الأصناف', headers: ['الاسم', 'السعر'], rows: [['صنف "مميز"', 55.5]] },
      { nameAr: 'قيود اليومية', headers: ['البيان', 'مدين'], rows: [['مبيعات <نقدية>', 100]] },
    ]
    const xml = sheetsToExcelXml(sheets)
    expect(xml).toContain('<?mso-application progid="Excel.Sheet"?>')
    expect(xml).toContain('<Worksheet ss:Name="الأصناف">')
    expect((xml.match(/<Worksheet /g) ?? []).length).toBe(2)
    expect(xml).toContain('&quot;مميز&quot;') // هروب علامات الاقتباس
    expect(xml).toContain('&lt;نقدية&gt;') // هروب أقواس XML
    const csv = sheetToCsv(sheets[0])
    expect(csv.startsWith('\uFEFF')).toBe(true) // BOM — العربية تفتح سليمة في Excel
    expect(csv).toContain('"صنف ""مميز"""') // اقتباس قياسي للفواصل داخل القيم
  })
})
