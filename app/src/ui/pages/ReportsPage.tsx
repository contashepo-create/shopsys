import { QuickSelect } from '../components/KeyboardPickers.tsx'
/**
 * مركز التقارير (المرحلة 5) — كل الأرقام من المستندات المرحّلة وقيودها:
 * ملخص المبيعات والأرباح، مبيعات يومية (أعمدة)، أفضل الأصناف،
 * أرصدة العملاء والموردين، تنبيهات وقيمة المخزون — بفترات جاهزة أو مخصصة.
 */
import { useEffect, useMemo, useState } from 'react'
import { BarChart3, TrendingUp, PackageSearch, Users, Truck, AlertTriangle, Boxes, ReceiptText, Coins } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor } from '../../core/money.ts'
import {
  salesSummary, topItems, dailySales, stagnantItems, stagnantVariants, sizeCurveAnalysis, activityRevenueRows,
  stockAlerts, inventoryValue, periodPresets, returnReasonsSummary, abcAnalysis, demandForecast, gradeProfitReport, type Period,
} from '../../core/reports.ts'
import { GRADE_LABELS } from '../../core/items.ts'
import { PENDING_PART_ORDER_STATUS_AR, buildPartArrivedMessage } from '../../core/partOrders.ts'
import { waChatLink } from '../../core/whatsapp.ts'
import { returnReasonName } from '../../core/returns.ts'
import { ACCOUNT_MODULE_MAP } from '../../core/coaVisibility.ts'
import { MODULE_LABELS, isInvoiceFirst, effectiveModules } from '../../core/activities.ts'
import { visibleReportTabs, type ReportTabId } from '../../core/reportTabs.ts'
import { reportCentersForModules } from '../../core/moduleCatalog.ts'
import { expiryAlerts, markdownSuggestions, expiryValueAtRisk, supplierReturnCandidates } from '../../core/batches.ts'
import { warrantyAttachRate, warrantyClaimRateByItem } from '../../core/warrantyReports.ts'
import { deliveryOnTimeRate } from '../../core/deliveryReports.ts'
import { variantLowStockAlerts } from '../../core/variants.ts'
import { purchaseReceivingVarianceReport } from '../../core/purchases.ts'
import { productionVarianceReport } from '../../core/recipes.ts'
import { wastageRatioReport, wastageByItemReport } from '../../core/wastage.ts'
import { agingFromStatement, supplierRowsForAging } from '../../core/statements.ts'
import { expensesSummary, expenseDetails, invoiceExpensesByCostCenter, journalExpensesByCostCenter, costCenterBudgetReport, returnsByCostCenter, costCenterExpensesCsv, expenseSummaryCsv, expenseDetailsCsv, invoiceExpensesByCategory, invoiceExpenseCategoriesCsv } from '../../core/expenseReports.ts'
import { accountName } from './accountNames.ts'
import { inputCls, useToast } from '../components/ui.tsx'
import { FinancialReportsTab } from './FinancialReportsTab.tsx'
import { FxTreasuryTab } from './FxTreasuryTab.tsx'
import { renderReportShell } from '../../core/reportPrint.ts'
import { printHtml } from '../print/printReceipt.ts'
import { Printer } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Landmark } from 'lucide-react'
import { todayLocalIso, localIsoTimestamp } from '../../core/time.ts'

/* التبويبات من السجل الواحد `core/reportTabs.ts` — لا نسخة محلية تتقادم (سدّ ف1) */
type TabId = ReportTabId
const TAB_ICONS: Record<TabId, typeof BarChart3> = {
  sales: BarChart3, items: Boxes, parties: Users, inventory: PackageSearch,
  expenses: ReceiptText, financial: Landmark, currencies: Coins,
}

/** تسميات مصادر العمليات لتقرير المصروفات */
const EXP_SOURCE_LABELS: Record<string, string> = {
  sale: 'فاتورة بيع', purchase: 'فاتورة شراء', payment_voucher: 'سند صرف', payroll: 'رواتب',
  manual: 'قيد يدوي', depreciation: 'إهلاك', wastage: 'هالك', logistics_trip: 'نقلة',
  reversal: 'قيد عاكس', adjustment: 'تسوية', asset_payment: 'سداد أصل', asset_disposal: 'استبعاد أصل', external_commission: 'عمولات',
  contracting: 'مقاولات', lab: 'معمل', sale_return: 'مرتجع بيع', purchase_return: 'مرتجع شراء',
}

export function ReportsPage() {
  const { sales, saleReturns, purchases, purchaseReturns, vouchers, items, customers, suppliers, batches, journal, customAccounts, projects, costCenters, costCenterBudgets, productionOrders, variantStocks, deliveryJobs, scheduleDelivery, setDeliveryStatus, serials, tickets, pendingPartOrders, addPendingPartOrder, setPendingPartOrderStatus, deletePendingPartOrder, purchaseOrders, wastages } = useDataStore()
  const { setup } = useAppStore()
  const cur = useMemo(
    () => (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' },
    [setup.countryCode],
  )
  const fmt = (m: number) => formatMinor(m, cur, false)
  const today = localIsoTimestamp()
  const toast = useToast()

  const presets = useMemo(() => periodPresets(today), [today])
  const [presetId, setPresetId] = useState('month')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const period: Period = useMemo(() => {
    if (presetId === 'custom' && customFrom && customTo) return { from: customFrom, to: customTo }
    return presets.find((p) => p.id === presetId)?.period ?? presets[2].period
  }, [presetId, customFrom, customTo, presets])

  const [tab, setTab] = useState<TabId>('sales')
  const [costProject, setCostProject] = useState<string>('all')
  const [costCenter, setCostCenter] = useState<string>('all')
  const [costSettlement, setCostSettlement] = useState<'all' | 'paid_now' | 'payable_later'>('all')

  /* ─── الحسابات (كلها نواة خالصة) ─── */
  const summary = useMemo(() => salesSummary(sales, saleReturns, period), [sales, saleReturns, period])
  const daily = useMemo(() => dailySales(sales, period), [sales, period])
  const top = useMemo(() => topItems(sales, saleReturns, period, 10), [sales, saleReturns, period])
  // الراكد (سد فجوة DEXEF): مخزون بلا حركة بيع — عتبة قابلة للتعديل (سد فجوة
  // فورية #1 — النشاط #7: قطع غيار): الدالة كانت تقبل عتبة فعلياً لكن الواجهة
  // تستدعيها بقيمة ثابتة 30 دائماً؛ الافتراضي يختلف حسب طبيعة النشاط (قطع
  // الغيار: ركودها الطبيعي أطول بكثير من بقالة سريعة الدوران فتوصية الدليل
  // الداخلي لها تحديداً 6 أشهر لا شهر واحد).
  const defaultStagnantDays = setup.activityId === 'spare_parts' ? 180 : 30
  const [stagnantThresholdDays, setStagnantThresholdDays] = useState(defaultStagnantDays)
  const stagnant = useMemo(() => stagnantItems(items, sales, todayLocalIso(), stagnantThresholdDays), [items, sales, stagnantThresholdDays])

  /**
   * تقرير الربح حسب درجة القطعة (سد فجوة فورية #3 — النشاط #7: قطع غيار):
   * يفصل الهامش بين الأصلي/البديل التجاري/المستعمل — الهدف المعلَن من حقل
   * `grade` أصلاً. يظهر فقط حين توجد أصناف عليها درجة مسجَّلة فعلياً.
   */
  const gradeProfit = useMemo(() => gradeProfitReport(sales, saleReturns, items, period), [sales, saleReturns, items, period])
  const hasGradedItems = useMemo(() => items.some((it) => it.grade), [items])
  // ركود التركيبات لون×مقاس (فجوة فورية ③ — نشاط الملابس): مكمِّل لتقرير ركود الصنف أعلاه
  const stagnantVariantRows = useMemo(
    () => (variantStocks.length ? stagnantVariants(items, variantStocks, sales, todayLocalIso(), 30) : []),
    [items, variantStocks, sales],
  )
  // منحنى المقاسات (تطوير مستقبلي ② — نشاط الملابس): نسبة كل مقاس من مبيعات الصنف بالفترة المحددة
  const sizeCurveRows = useMemo(() => sizeCurveAnalysis(items, sales, period.from, period.to), [items, sales, period])
  const sizeCurveByItem = useMemo(() => {
    const m = new Map<number, { nameAr: string; rows: typeof sizeCurveRows }>()
    for (const r of sizeCurveRows) {
      if (!m.has(r.itemId)) m.set(r.itemId, { nameAr: r.nameAr, rows: [] })
      m.get(r.itemId)!.rows.push(r)
    }
    return Array.from(m.values())
  }, [sizeCurveRows])
  // أسباب الإرجاع (سد فجوة التوثيق — دليل الأغذية كان يَعِد بهذا التقرير دون وجوده فعلياً)
  const returnReasons = useMemo(() => returnReasonsSummary(saleReturns, period, returnReasonName), [saleReturns, period])
  // تحليل ABC (سد فجوة: لا تصنيف أصناف حسب مساهمتها بالإيراد — باريتو 80/95)
  const abcRows = useMemo(() => abcAnalysis(sales, saleReturns, period), [sales, saleReturns, period])
  // توقع طلب إحصائي (سد فجوة مستقبلية: تنبؤ ذكاء اصطناعي — نسخة إحصائية محلية بلا سحابة)
  const forecastRows = useMemo(() => demandForecast(sales, todayLocalIso(), 8), [sales])
  // اقتراح تسعير تصاعدي قرب الانتهاء (سد فجوة مستقبلية: تسعير ديناميكي)
  const markdowns = useMemo(() => markdownSuggestions(batches, items, todayLocalIso(), 7), [batches, items])
  /** سد فجوة النشاط #2 (تجارة الأعلاف والحبوب): تقرير مجمَّع لفرق الوزن — استلام من موردين + تصنيع داخلي */
  const receivingVariance = useMemo(() => purchaseReceivingVarianceReport(purchases, suppliers), [purchases, suppliers])
  const productionVariance = useMemo(() => productionVarianceReport(productionOrders, items), [productionOrders, items])
  // نسبة الهالك الأسبوعية + أكثر الأصناف هالكاً (سد فجوة النشاط #20 — مخبز وحلويات)
  const wastageRatio = useMemo(() => wastageRatioReport(wastages, sales.map((s) => ({ date: s.date, cogsMinor: s.totals.cogsMinor }))), [wastages, sales])
  const wastageByItem = useMemo(() => wastageByItemReport(wastages), [wastages])
  // الرصيد الموحّد من repo (إصلاح بلاغ المالك: سداد بسند قبض + رصيد افتتاحي لم يكونا محسوبين هنا)
  // نفس مصدر كشف الحساب وشاشات الأطراف — فلا تتناقض الأرقام أبداً
  const getCustomerBalance = useDataStore((s) => s.getCustomerBalance)
  const getSupplierBalance = useDataStore((s) => s.getSupplierBalance)
  const journalLen = useDataStore((s) => s.journal.length)
  const custRows = useMemo(
    () => {
      void journalLen
      return customers
      .map((c) => ({ customerId: c.id, balanceMinor: getCustomerBalance(c.id) }))
      .filter((r) => r.balanceMinor !== 0)
      .sort((a, b) => b.balanceMinor - a.balanceMinor)
    },
    // journalLen يحدّث القائمة بعد أي عملية مالية جديدة
    [customers, getCustomerBalance, journalLen],
  )
  const suppRows = useMemo(
    () => {
      void journalLen
      return suppliers
      .map((sp) => ({ supplierId: sp.id, balanceMinor: getSupplierBalance(sp.id) }))
      .filter((r) => r.balanceMinor !== 0)
      .sort((a, b) => b.balanceMinor - a.balanceMinor)
    },
    [suppliers, getSupplierBalance, journalLen],
  )
  // أعمار الديون (المقارنة العالمية: QuickBooks/Xero يقدمان A/R Aging 30/60/90 — كان غائباً)
  const getCustomerStatementRows = useDataStore((s) => s.getCustomerStatementRows)
  const getSupplierStatementRows = useDataStore((s) => s.getSupplierStatementRows)
  const todayYmd = today.slice(0, 10)
  const custAging = useMemo(
    () => custRows.map((r) => ({ customerId: r.customerId, aging: agingFromStatement(getCustomerStatementRows(r.customerId), todayYmd) })).filter((r) => r.aging.totalMinor > 0),
    [custRows, getCustomerStatementRows, todayYmd],
  )
  const suppAging = useMemo(
    () => suppRows.map((r) => ({ supplierId: r.supplierId, aging: agingFromStatement(supplierRowsForAging(getSupplierStatementRows(r.supplierId)), todayYmd) })).filter((r) => r.aging.totalMinor > 0),
    [suppRows, getSupplierStatementRows, todayYmd],
  )
  const alerts = useMemo(() => stockAlerts(items), [items])
  // نقص مخزون على مستوى تركيبة لون/مقاس (فجوة فورية ② — نشاط الملابس)
  const variantLowStockRows = useMemo(() => variantLowStockAlerts(variantStocks, items), [variantStocks, items])
  const invValue = useMemo(() => inventoryValue(items), [items])

  /* ─── إيراد الفترة من دفتر اليومية — مصدر واحد لكل الأنشطة (تدقيق 2026-10-11) ───
     بطاقات المبيعات أعلاه تقرأ مستندات الكاشير فقط؛ هذه القراءة تشمل كل الوحدات
     والمحركات التخصصية (معمل/عيادة/لوجستيات/مقاولات/عقارات/مغسلة/إيجار/سيارات)
     فلا يرى صاحبها «صفر مبيعات» وله إيراد حقيقي في اليومية. */
  const revenueCodes = useMemo(() => new Set(customAccounts.filter((a) => a.rootType === 'revenue').map((a) => a.code)), [customAccounts])
  const revenueNames = useMemo(() => {
    const map: Record<string, string> = {}
    for (const a of customAccounts) map[a.code] = a.nameAr
    return map
  }, [customAccounts])
  const revenueByModule = useMemo(
    () => activityRevenueRows(journal, period, {
      extraNames: revenueNames,
      customRevenueCodes: revenueCodes,
      moduleOf: ACCOUNT_MODULE_MAP,
      moduleNames: Object.fromEntries(Object.entries(MODULE_LABELS).map(([k, v]) => [k, v.nameAr])),
      activeModules: setup.modules,
      coreModules: ['pos', 'inventory', 'purchases'],
    }),
    [journal, period, revenueNames, revenueCodes, setup.modules],
  )
  // عنوان البطاقة حسب طريقة بيع النشاط — «مبيعات» للكاشير، «إيراد» لغيره
  const salesCardTitle = (() => {
    const base = isInvoiceFirst(setup.activityId) ? 'إيراد الفواتير' : 'إيراد البيع (كاشير)'
    return setup.modules.includes('pos') ? base : 'إيراد الفترة'
  })()

  const expAlerts = useMemo(
    () => expiryAlerts(batches, (id) => items.find((it) => it.id === id)?.nameAr ?? `صنف #${id}`, todayLocalIso()),
    [batches, items],
  )
  // قيمة المخزون المعرَّض لخطر الانتهاء بالعملة لكل أفق (سد فجوة فورية — النشاط #5: صيدلية)
  const expiryValueRows = useMemo(() => expiryValueAtRisk(batches, items, todayLocalIso(), [30, 60, 90]), [batches, items])
  // مرشحات إرجاع المورد: دفعات لا تزال داخل نافذة إرجاع موردها المسجَّلة (سد فجوة فورية — النشاط #5: صيدلية)
  const returnCandidates = useMemo(
    () => supplierReturnCandidates(batches, items, purchases, suppliers, todayLocalIso()),
    [batches, items, purchases, suppliers],
  )
  const returnCandidatesBySupplier = useMemo(() => {
    const m = new Map<number, { supplierName: string; rows: typeof returnCandidates }>()
    for (const r of returnCandidates) {
      if (!m.has(r.supplierId)) m.set(r.supplierId, { supplierName: r.supplierName, rows: [] })
      m.get(r.supplierId)!.rows.push(r)
    }
    return Array.from(m.entries()).map(([supplierId, v]) => ({ supplierId, ...v }))
  }, [returnCandidates])

  /**
   * سد فجوة فورية — النشاط #6 (أجهزة كهربائية): طلبات التوصيل/التركيب
   * المجدولة — بديل منظَّم لبند رسوم «شحن وتوصيل» النصي الحر على الفاتورة.
   */
  const [deliveryInvoiceQuery, setDeliveryInvoiceQuery] = useState('')
  const [deliveryDate, setDeliveryDate] = useState('')
  const [deliveryAssignee, setDeliveryAssignee] = useState('')
  const pendingDeliveries = useMemo(
    () => deliveryJobs
      .filter((j) => j.status !== 'done')
      .map((j) => ({ job: j, sale: sales.find((s) => s.id === j.saleId) }))
      .sort((a, b) => a.job.scheduledAt.localeCompare(b.job.scheduledAt)),
    [deliveryJobs, sales],
  )
  const scheduleDeliveryFromInvoice = () => {
    const sale = sales.find((s) => s.invoiceNumber === deliveryInvoiceQuery.trim() || s.refCode === deliveryInvoiceQuery.trim())
    if (!sale) { toast.show('رقم فاتورة غير موجود', 'error'); return }
    if (!deliveryDate) { toast.show('اختر تاريخ التوصيل', 'error'); return }
    try {
      scheduleDelivery({ saleId: sale.id, scheduledAt: deliveryDate, assignedTo: deliveryAssignee })
      setDeliveryInvoiceQuery(''); setDeliveryDate(''); setDeliveryAssignee('')
      toast.show(`جُدول توصيل الفاتورة ${sale.invoiceNumber} ✓`)
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  /**
   * سد فجوة فورية — النشاط #6 (أجهزة كهربائية): معدل إقران الضمان الممتد
   * خلال الفترة المختارة + معدل تكرار مطالبات الضمان لكل صنف (كل الفترات —
   * مؤشر جودة طويل المدى لا يُقيَّد بنطاق تاريخ التقرير).
   */
  /**
   * سد فجوة مستقبلية #3 — النشاط #6 (أجهزة كهربائية): نسبة التزام مواعيد
   * التوصيل/التركيب خلال الفترة المختارة — مبنية فوق scheduledAt/completedAt.
   */
  const deliveryOnTime = useMemo(() => deliveryOnTimeRate(deliveryJobs, period.from, period.to), [deliveryJobs, period])
  const warrantyAttach = useMemo(() => warrantyAttachRate(serials, period.from, period.to), [serials, period])
  const warrantyClaims = useMemo(
    () => warrantyClaimRateByItem(serials, tickets).filter((r) => r.soldUnderWarranty > 0),
    [serials, tickets],
  )
  const itemName = (id: number) => items.find((it) => it.id === id)?.nameAr ?? `صنف #${id}`

  /**
   * طلبات العملاء المعلّقة (سد فجوة فورية #2 — النشاط #7: قطع غيار):
   * طلب خاص لقطعة غير متوفرة بالمخزون — أول مهمة يومية بدليل تشغيل محلات
   * قطع الغيار. تتحول تلقائياً إلى «وصلت» عند اكتمال استلام أمر الشراء
   * المرتبط (إن وُجد)، وتظهر عندها كتنبيه في لوحة التحكم.
   */
  const [newPartOrderItemId, setNewPartOrderItemId] = useState('')
  const [newPartOrderCustomerId, setNewPartOrderCustomerId] = useState('')
  const [newPartOrderCustomerName, setNewPartOrderCustomerName] = useState('')
  const [newPartOrderCustomerPhone, setNewPartOrderCustomerPhone] = useState('')
  const [newPartOrderQty, setNewPartOrderQty] = useState('1')
  const [newPartOrderPoId, setNewPartOrderPoId] = useState('')
  const sortedPartOrders = useMemo(
    () => [...pendingPartOrders].sort((a, b) => (a.status === b.status ? b.orderedAt.localeCompare(a.orderedAt) : a.status === 'pending' ? -1 : b.status === 'pending' ? 1 : a.status === 'arrived' ? -1 : 1)),
    [pendingPartOrders],
  )
  const openPurchaseOrders = useMemo(() => purchaseOrders.filter((o) => o.status !== 'closed' && o.status !== 'cancelled'), [purchaseOrders])
  const submitPartOrder = () => {
    const itemId = Number(newPartOrderItemId)
    if (!itemId) { toast.show('اختر الصنف المطلوب', 'error'); return }
    try {
      addPendingPartOrder({
        itemId,
        itemNameAr: itemName(itemId),
        customerId: newPartOrderCustomerId ? Number(newPartOrderCustomerId) : null,
        customerName: newPartOrderCustomerId ? custName(Number(newPartOrderCustomerId)) : newPartOrderCustomerName,
        customerPhone: newPartOrderCustomerPhone,
        qty: Number(newPartOrderQty) || 1,
        orderedAt: new Date().toISOString(),
        linkedPurchaseOrderId: newPartOrderPoId ? Number(newPartOrderPoId) : null,
      })
      setNewPartOrderItemId(''); setNewPartOrderCustomerId(''); setNewPartOrderCustomerName(''); setNewPartOrderCustomerPhone(''); setNewPartOrderQty('1'); setNewPartOrderPoId('')
      toast.show('سُجِّل طلب العميل ✓')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  /* ─── تقارير المصروفات (طلب المالك): مجمّع + تفصيلي بفلترة محترفة ─── */
  const customExpenseCodes = useMemo(() => new Set(customAccounts.filter((a) => a.rootType === 'expenses').map((a) => a.code)), [customAccounts])
  const [expAccount, setExpAccount] = useState('') // '' = التقرير المجمّع لكل البنود
  const [expSource, setExpSource] = useState('')
  const expFilter = useMemo(() => ({ from: period.from, to: period.to, sourceType: expSource || undefined }), [period, expSource])
  const expSummary = useMemo(() => expensesSummary(journal, expFilter, accountName, customExpenseCodes), [journal, expFilter, customExpenseCodes])
  const invoiceExpenseDocuments = useMemo(() => [...sales, ...purchases.map(purchase => ({ date: purchase.date, internalExpenses: purchase.expenses.map(expense => ({ label: expense.nameAr, accountCode: expense.accountCode ?? '5108', costCenterId: expense.costCenterId ?? null, projectId: purchase.projectId ?? null, amountMinor: expense.amountMinor, settlement: expense.paidBy === 'treasury' || expense.paidBy === 'custody' ? 'paid_now' as const : 'payable_later' as const, taxTreatment: expense.taxTreatment, taxPercent: expense.taxPercent })) })), ...vouchers.filter(voucher => voucher.kind === 'payment' && (voucher.counterAccountCode.startsWith('5') || customExpenseCodes.has(voucher.counterAccountCode))).map(voucher => ({ date: voucher.date, internalExpenses: [{ label: voucher.description || 'سند صرف', accountCode: voucher.counterAccountCode, costCenterId: voucher.costCenterId ?? null, projectId: null, amountMinor: voucher.amountMinor, settlement: 'paid_now' as const }] }))], [sales, purchases, vouchers, customExpenseCodes])
  const costCenterExpenses = useMemo(() => invoiceExpensesByCostCenter(invoiceExpenseDocuments, { from: period.from, to: period.to, costCenterId: costCenter === 'all' ? 'all' : costCenter === 'none' ? null : Number(costCenter), projectId: costProject === 'all' ? 'all' : costProject === 'none' ? null : Number(costProject), settlement: costSettlement }), [invoiceExpenseDocuments, period, costCenter, costProject, costSettlement])
  const expenseCategories = useMemo(() => invoiceExpensesByCategory(invoiceExpenseDocuments, { from: period.from, to: period.to }), [invoiceExpenseDocuments, period])
  const journalCostCenterExpenses = useMemo(() => journalExpensesByCostCenter(journal, { from: period.from, to: period.to, costCenterId: costCenter === 'all' ? 'all' : costCenter === 'none' ? null : Number(costCenter) }, customExpenseCodes), [journal, period, costCenter, customExpenseCodes])
  const costCenterBudgetsReport = useMemo(() => costCenterBudgetReport(costCenterBudgets, journal, { from: period.from, to: period.to }, customExpenseCodes, costCenters), [costCenterBudgets, journal, period, customExpenseCodes, costCenters])
  const costCenterReturns = useMemo(() => returnsByCostCenter([
    ...saleReturns.map((row) => ({ date: row.date, totalMinor: row.totals.totalMinor, costCenterIds: row.costCenterIds, kind: 'sale_return' as const })),
    ...purchaseReturns.map((row) => ({ date: row.date, totalMinor: row.totalMinor, costCenterIds: row.costCenterIds, kind: 'purchase_return' as const })),
  ], { from: period.from, to: period.to }), [saleReturns, purchaseReturns, period])
  const expDetail = useMemo(
    () => expenseDetails(journal, { ...expFilter, accountCode: expAccount || undefined }, customExpenseCodes),
    [journal, expFilter, expAccount, customExpenseCodes],
  )
  const expSources = useMemo(() => [...new Set(journal.flatMap((e) => e.lines.some((l) => l.accountCode.startsWith('5') || customExpenseCodes.has(l.accountCode)) ? [e.sourceType] : []))], [journal, customExpenseCodes])
  const exportExpenses = () => {
    const csv = expAccount ? expenseDetailsCsv(expDetail.rows) : expenseSummaryCsv(expSummary.rows)
    const url = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a'); link.href = url; link.download = expAccount ? `expenses-${expAccount}.csv` : 'expenses-summary.csv'; link.click(); URL.revokeObjectURL(url)
  }

  const printExpenses = () => {
    const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const { reportPrint, receipt } = useAppStore.getState()
    const body = expAccount
      ? `<table><thead><tr><th>القيد</th><th>التاريخ</th><th>البيان</th><th>المصدر</th><th>المبلغ</th></tr></thead><tbody>
          ${expDetail.rows.map((r) => `<tr><td class="num">#${r.entryNumber}</td><td class="num">${r.date}</td><td>${esc(r.description)}</td><td>${esc(EXP_SOURCE_LABELS[r.sourceType] ?? r.sourceType)}</td><td class="num">${fmt(r.amountMinor)}</td></tr>`).join('')}
          <tr class="total"><td colspan="4">إجمالي «${esc(accountName(expAccount))}»</td><td class="num">${fmt(expDetail.totalMinor)}</td></tr></tbody></table>`
      : `<table><thead><tr><th>الكود</th><th>البند</th><th>عدد الحركات</th><th>النسبة</th><th>الإجمالي</th></tr></thead><tbody>
          ${expSummary.rows.map((r) => `<tr><td class="num">${r.accountCode}</td><td>${esc(r.accountName)}</td><td class="num">${r.txCount}</td><td class="num">${r.sharePercent}%</td><td class="num">${fmt(r.totalMinor)}</td></tr>`).join('')}
          <tr class="total"><td colspan="4">إجمالي مصروفات الفترة</td><td class="num">${fmt(expSummary.grandTotalMinor)}</td></tr></tbody></table>`
    printHtml(renderReportShell({
      title: expAccount ? `تقرير مصروفات تفصيلي — ${accountName(expAccount)}` : 'تقرير المصروفات المجمّع',
      subtitle: `الفترة ${period.from} → ${period.to}${expSource ? ` · المصدر: ${EXP_SOURCE_LABELS[expSource] ?? expSource}` : ''}`,
      companyName: setup.shopName || '',
      logoDataUrl: receipt.logoDataUrl,
      settings: reportPrint,
      bodyHtml: body,
    }))
  }

  const printCostCenterExpenses = () => {
    const esc = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const projectName = (id: number | null) => id == null ? '—' : projects.find((project) => project.id === id)?.nameAr ?? `مشروع #${id}`
    const costCenterName = (id: number | null) => id == null ? 'بدون مركز عام' : costCenters.find((center) => center.id === id)?.nameAr ?? `مركز #${id}`
    const body = `<table><thead><tr><th>المركز العام</th><th>المشروع</th><th>الحركات</th><th>مدفوع</th><th>مستحق</th><th>الإجمالي</th></tr></thead><tbody>${costCenterExpenses.rows.map((row) => `<tr><td>${esc(costCenterName(row.costCenterId ?? null))}</td><td>${esc(projectName(row.projectId))}</td><td class="num">${row.txCount}</td><td class="num">${fmt(row.paidMinor)}</td><td class="num">${fmt(row.accruedMinor)}</td><td class="num">${fmt(row.totalMinor)}</td></tr>`).join('')}<tr class="total"><td colspan="5">الإجمالي</td><td class="num">${fmt(costCenterExpenses.totalMinor)}</td></tr></tbody></table>`
    const { reportPrint, receipt } = useAppStore.getState()
    printHtml(renderReportShell({ title: 'تحليل مصروفات الفواتير حسب مركز التكلفة', subtitle: `الفترة ${period.from} → ${period.to} · ${costSettlement === 'paid_now' ? 'مدفوع' : costSettlement === 'payable_later' ? 'مستحق' : 'كل حالات السداد'}`, companyName: setup.shopName || '', logoDataUrl: receipt.logoDataUrl, settings: reportPrint, bodyHtml: body }))
  }

  /**
   * مستند مطالبة إرجاع للمورد (سد فجوة مستقبلية — النشاط #5: صيدلية):
   * يُصدَّر مباشرة من مرشحات إرجاع المورد (supplierReturnCandidates) —
   * مستند جاهز للطباعة/الإرسال بدل تجميع الدفعات يدوياً عند كل مطالبة.
   */
  const printSupplierReturnClaim = (supplierId: number, supplierName: string, rows: typeof returnCandidates) => {
    const esc = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const body = `<table><thead><tr><th>الصنف</th><th>التشغيلة</th><th>تاريخ الانتهاء</th><th>الكمية</th><th>المتبقي لنهاية نافذة الإرجاع</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r.nameAr)}</td><td class="num">${esc(r.lotNumber ?? '—')}</td><td class="num">${r.expiryDate}</td><td class="num">${r.qty}</td><td class="num">${r.daysLeft} يوم</td></tr>`).join('')}</tbody></table>`
    const { reportPrint, receipt } = useAppStore.getState()
    printHtml(renderReportShell({
      title: `مطالبة إرجاع — ${esc(supplierName)}`,
      subtitle: `${rows.length} بند — نافذة الإرجاع ${rows[0]?.returnWindowDays ?? ''} يوماً قبل الانتهاء`,
      companyName: setup.shopName || '',
      logoDataUrl: receipt.logoDataUrl,
      settings: reportPrint,
      bodyHtml: body,
    }))
    void supplierId
  }

  const printExpenseCategories = () => {
    const esc = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const body = `<table><thead><tr><th>النوع</th><th>الحساب</th><th>الحركات</th><th>المراكز</th><th>مدفوع</th><th>مستحق</th><th>الضريبة</th><th>الإجمالي</th></tr></thead><tbody>${expenseCategories.rows.map((row) => `<tr><td>${esc(row.label)}</td><td class="num">${esc(row.accountCode)}</td><td class="num">${row.txCount}</td><td class="num">${row.costCenterCount}</td><td class="num">${fmt(row.paidMinor)}</td><td class="num">${fmt(row.accruedMinor)}</td><td class="num">${fmt(row.taxMinor)}</td><td class="num">${fmt(row.totalMinor)}</td></tr>`).join('')}<tr class="total"><td colspan="6">الإجمالي</td><td class="num">${fmt(expenseCategories.taxMinor)}</td><td class="num">${fmt(expenseCategories.totalMinor)}</td></tr></tbody></table>`
    const { reportPrint, receipt } = useAppStore.getState()
    printHtml(renderReportShell({ title: 'تحليل أنواع مصروفات الفواتير', subtitle: `الفترة ${period.from} → ${period.to}`, companyName: setup.shopName || '', logoDataUrl: receipt.logoDataUrl, settings: reportPrint, bodyHtml: body }))
  }

  const custName = (id: number) => customers.find((c) => c.id === id)?.nameAr ?? `عميل #${id}`
  const suppName = (id: number) => suppliers.find((s) => s.id === id)?.nameAr ?? `مورد #${id}`

  const maxDaily = Math.max(1, ...daily.map((d) => d.totalMinor))

  const tabCls = (t: TabId) =>
    `px-4 py-2 rounded-xl text-[13px] font-bold transition-all ${tab === t ? 'bg-sky-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'}`

  const card = 'rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800'

  /* ─── سجل التبويبات (§6/ف1): شرط الوحدة أو وجود بيانات، ووسم «لا حركة بعد» ─── */
  const enabledModules = effectiveModules(setup.activityId, setup.modules)
  const tabHasData = (id: TabId): boolean => {
    switch (id) {
      case 'sales': return daily.length > 0
      case 'items': return top.length > 0
      case 'parties': return customers.length > 0 || suppliers.length > 0
      case 'inventory': return items.length > 0
      case 'expenses': return purchases.length > 0 || vouchers.length > 0
      case 'financial': return journal.length > 0
      case 'currencies': return customAccounts.length > 0
    }
  }
  const visibleTabs = visibleReportTabs(enabledModules, tabHasData)
  useEffect(() => {
    if (!visibleTabs.some((def) => def.id === tab)) setTab(visibleTabs[0]?.id ?? 'financial')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleTabs.map((def) => def.id).join(','), tab])
  /* بطاقة «تقارير أقسامك»: كل الأقسام المفعّلة — بما فيها الكاشير والمخزون والمشتريات
     (كانت روابط مرتجعات المبيعات والجرد وأوامر الشراء لا تظهر في المركز إلا من القائمة الجانبية) */
  const extraCenters = reportCentersForModules(enabledModules)

  return (
    <div className="space-y-4">
      {/* اختيار الفترة */}
      <div className="anim-up flex flex-wrap items-center gap-2">
        {presets.map((p) => (
          <button
            key={p.id}
            onClick={() => setPresetId(p.id)}
            className={`px-3 py-1.5 rounded-lg text-[12px] font-bold transition-all ${presetId === p.id ? 'bg-sky-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-sky-600'}`}
          >
            {p.label}
          </button>
        ))}
        <button
          onClick={() => setPresetId('custom')}
          className={`px-3 py-1.5 rounded-lg text-[12px] font-bold transition-all ${presetId === 'custom' ? 'bg-sky-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-sky-600'}`}
        >
          مخصصة
        </button>
        {presetId === 'custom' && (
          <div className="flex items-center gap-2">
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className={`${inputCls} !w-auto !py-1.5`} dir="ltr" />
            <span className="text-slate-400 text-[12px]">إلى</span>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className={`${inputCls} !w-auto !py-1.5`} dir="ltr" />
          </div>
        )}
        <span className="text-[11px] text-slate-400 ms-auto" dir="ltr">{period.from} → {period.to}</span>
      </div>

      {/* بطاقات الملخص */}
      <div className="anim-up grid grid-cols-2 lg:grid-cols-4 gap-3" style={{ animationDelay: '40ms' }}>
        <div className={`${card} p-4`}>
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400"><ReceiptText size={13} /> {salesCardTitle} ({summary.invoiceCount} فاتورة)</div>
          <div className="font-black text-xl mt-1">{fmt(summary.totalMinor)} <span className="text-[11px] font-bold text-slate-400">{cur.symbol}</span></div>
          <div className="text-[10px] text-slate-400 mt-0.5">نقدي {fmt(summary.cashMinor)} — آجل {fmt(summary.creditMinor)}</div>
        </div>
        <div className={`${card} p-4`}>
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400"><TrendingUp size={13} /> الربح الإجمالي</div>
          <div className={`font-black text-xl mt-1 ${summary.netProfitMinor >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmt(summary.netProfitMinor)} <span className="text-[11px] font-bold text-slate-400">{cur.symbol}</span></div>
          <div className="text-[10px] text-slate-400 mt-0.5">قبل المرتجعات {fmt(summary.profitMinor)}</div>
        </div>
        <div className={`${card} p-4`}>
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400"><PackageSearch size={13} /> تكلفة المبيعات</div>
          <div className="font-black text-xl mt-1">{fmt(summary.cogsMinor)} <span className="text-[11px] font-bold text-slate-400">{cur.symbol}</span></div>
          <div className="text-[10px] text-slate-400 mt-0.5">خصومات {fmt(summary.discountMinor)} — ضريبة {fmt(summary.taxMinor)}</div>
        </div>
        <div className={`${card} p-4`}>
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400"><AlertTriangle size={13} /> مرتجعات الفترة</div>
          <div className={`font-black text-xl mt-1 ${summary.returnsMinor > 0 ? 'text-rose-600' : ''}`}>{fmt(summary.returnsMinor)} <span className="text-[11px] font-bold text-slate-400">{cur.symbol}</span></div>
          <div className="text-[10px] text-slate-400 mt-0.5">قيمة المخزون الآن {fmt(invValue.totalMinor)}</div>
        </div>
        {/* إيراد الفترة من دفتر اليومية — يشمل كل الوحدات والمحركات التخصصية */}
        <div className={`${card} p-4 border-emerald-200 dark:border-emerald-900/60`}>
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-600 dark:text-emerald-400"><TrendingUp size={13} /> إيراد الفترة من الدفتر (كل الأقسام)</div>
          <div className="font-black text-xl mt-1 text-emerald-700 dark:text-emerald-300">{fmt(revenueByModule.totalMinor)} <span className="text-[11px] font-bold text-slate-400">{cur.symbol}</span></div>
          <div className="text-[10px] text-slate-400 mt-0.5">
            {setup.modules.includes('pos')
              ? (revenueByModule.totalMinor === summary.totalMinor - summary.taxMinor
                ? 'مطابق لمبيعات الكاشير في هذه الفترة ✓'
                : `منها غير الكاشير: ${fmt(revenueByModule.totalMinor - (summary.totalMinor - summary.taxMinor))}`)
              : 'نشاطك يبيع بمحركه التخصصي — هذا رقمه الصحيح'}
          </div>
        </div>
        {/* توزيع الإيراد على الأقسام: النشاط + كل وحدة مطعَّمة بمفتاح */}
        {revenueByModule.rows.filter((r) => r.module).length > 0 && (
          <div className={`${card} p-4`}>
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400"><Boxes size={13} /> الإيراد حسب القسم</div>
            <div className="mt-1 space-y-0.5">
              {(() => {
                const byModule = new Map<string, number>()
                for (const r of revenueByModule.rows) if (r.module) byModule.set(r.moduleNameAr ?? r.module, (byModule.get(r.moduleNameAr ?? r.module) ?? 0) + r.amountMinor)
                return [...byModule.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, amount]) => (
                  <div key={name} className="flex items-center justify-between text-[11.5px]">
                    <span className="text-slate-500 dark:text-slate-400">{name}</span>
                    <b className="text-slate-700 dark:text-slate-200">{fmt(amount)}</b>
                  </div>
                ))
              })()}
            </div>
          </div>
        )}
      </div>

      {/* تفصيل الإيراد بالحساب — بند «كم ربح كل قسم فعلاً» (يظهر عند تعدد مصادر الإيراد) */}
      {revenueByModule.rows.length > 1 && (
        <div className={`anim-up ${card} overflow-hidden`} style={{ animationDelay: '60ms' }}>
          <div className="px-4 py-3 text-[12px] font-extrabold text-slate-600 dark:text-slate-300 border-b border-slate-100 dark:border-slate-800">
            💰 الإيراد حسب البند والقسم — من دفتر اليومية (الفترة {period.from} → {period.to})
          </div>
          <table className="w-full text-[12.5px]">
            <tbody>
              {revenueByModule.rows.map((r) => (
                <tr key={r.accountCode} className="border-b border-slate-50 dark:border-slate-800/50">
                  <td className="px-4 py-2 text-slate-700 dark:text-slate-200">{accountName(r.accountCode)}</td>
                  <td className="px-4 py-2 text-[11px] text-slate-400">{r.moduleNameAr ?? 'إيراد عام'}</td>
                  <td className="px-4 py-2 font-black text-left text-emerald-600">{fmt(r.amountMinor)}</td>
                </tr>
              ))}
              <tr className="bg-slate-50/60 dark:bg-slate-800/30">
                <td className="px-4 py-2 font-black" colSpan={2}>الإجمالي</td>
                <td className="px-4 py-2 font-black text-left">{fmt(revenueByModule.totalMinor)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* التبويبات — من السجل: تبويب بلا وحدته وبلا بيانات لا يُعرض، وبلا حركة يُوسم (ف1) */}
      <div className="anim-up flex items-center gap-2 flex-wrap" style={{ animationDelay: '80ms' }}>
        {visibleTabs.map((def) => {
          const Icon = TAB_ICONS[def.id]
          const empty = !tabHasData(def.id)
          return (
            <button key={def.id} onClick={() => setTab(def.id)} className={tabCls(def.id)} data-report-tab={def.id} title={empty ? `لا حركة بعد — ${def.dataHintAr}` : def.dataHintAr}>
              <Icon size={14} className="inline -mt-0.5 me-1" /> {def.labelAr}
              {empty && <span className="ms-2 rounded-full bg-slate-200/70 px-1.5 py-0.5 text-[10px] font-bold text-slate-500 dark:bg-slate-700 dark:text-slate-300" data-report-empty>لا حركة بعد</span>}
            </button>
          )
        })}
      </div>

      {/* بطاقة «تقارير أقسامك» (سدّ ف2): تقرير الوحدة المطعَّمة كان بلا باب من المركز */}
      {extraCenters.length > 0 && (
        <section className={`anim-up ${card} p-4`} data-report-module-card>
          <div className="mb-3 text-[13px] font-black text-slate-700 dark:text-slate-200">🧩 تقارير أقسامك</div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {extraCenters.map(({ module, center }) => (
              <div key={module} className="rounded-xl border border-slate-200 dark:border-slate-800 p-3" data-report-module={module}>
                <div className="mb-2 text-[12.5px] font-bold text-slate-700 dark:text-slate-200">{MODULE_LABELS[module]?.icon} {center.labelAr}</div>
                <div className="flex flex-wrap gap-1.5">
                  {center.links.map((link) => (
                    <Link key={link.path} to={link.path} className="rounded-lg bg-slate-100 dark:bg-slate-800 px-2 py-1 text-[11px] font-bold text-sky-700 hover:bg-sky-100 dark:text-sky-300 dark:hover:bg-slate-700">{link.labelAr} ←</Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {tab === 'sales' && (
        <div className={`anim-up ${card} p-5`}>
          {setup.modules.includes('pos') && (
            <div className="mb-3 text-[11px] text-slate-400">الرسم أدناه لفواتير الكاشير وحدها — إيراد الوحدات التخصصية (معمل/عيادة/لوجستيات/مقاولات/عقارات/مغسلة…) في «القوائم المالية» وفي بطاقة «إيراد الفترة من الدفتر» أعلاه.</div>
          )}
          {daily.length === 0 ? (
            <div className="text-center text-slate-400 text-[13px] py-10">
              {setup.modules.includes('pos') ? 'لا مبيعات كاشير في هذه الفترة' : `لا فواتير كاشير — إيراد نشاطك في هذه الفترة: ${fmt(revenueByModule.totalMinor)} ${cur.symbol} (من الدفتر)`}
            </div>
          ) : (
            <>
              <div className="flex items-end gap-1.5 h-44 overflow-x-auto pb-1">
                {daily.map((d) => (
                  <div key={d.date} className="flex flex-col items-center gap-1 min-w-[44px] flex-1 group">
                    <div className="text-[9px] font-bold text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">{fmt(d.totalMinor)}</div>
                    <div
                      className="w-full max-w-[36px] rounded-t-lg bg-gradient-to-t from-sky-600 to-sky-400 transition-all hover:from-sky-500 hover:to-sky-300"
                      style={{ height: `${Math.max(4, (d.totalMinor / maxDaily) * 130)}px` }}
                      title={`${d.date}: ${fmt(d.totalMinor)} ${cur.symbol} (${d.invoiceCount} فاتورة)`}
                    />
                    <div className="text-[9px] text-slate-400" dir="ltr">{d.date.slice(5)}</div>
                  </div>
                ))}
              </div>
              <div className="mt-3 grid grid-cols-3 text-center text-[12px] border-t border-slate-100 dark:border-slate-800 pt-3">
                <div><span className="text-slate-400">أيام البيع:</span> <b>{daily.length}</b></div>
                <div><span className="text-slate-400">متوسط اليوم:</span> <b>{fmt(Math.round(summary.totalMinor / Math.max(1, daily.length)))}</b></div>
                <div><span className="text-slate-400">أفضل يوم:</span> <b dir="ltr">{daily.reduce((a, b) => (b.totalMinor > a.totalMinor ? b : a)).date}</b></div>
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'sales' && (
        <div className={`anim-up ${card} overflow-hidden`}>
          <div className="px-4 py-3 text-[12px] font-extrabold text-slate-600 dark:text-slate-300 border-b border-slate-100 dark:border-slate-800">
            🚚 طلبات التوصيل/التركيب <span className="text-[10px] font-normal text-slate-400">— سد فجوة فورية (أجهزة كهربائية): بديل منظَّم لبند رسوم «شحن وتوصيل» النصي الحر</span>
          </div>
          {deliveryOnTime.completedCount > 0 && (
            <div className="px-4 py-2 flex items-center gap-3 text-[11px] font-bold border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
              <span className="text-slate-400">معدل الالتزام بالموعد (الفترة المختارة):</span>
              <span className={deliveryOnTime.onTimeRatePercent >= 80 ? 'text-emerald-600' : 'text-amber-600'}>{deliveryOnTime.onTimeRatePercent}%</span>
              <span className="text-slate-400">({deliveryOnTime.onTimeCount} في الموعد / {deliveryOnTime.lateCount} متأخر من {deliveryOnTime.completedCount} مكتمل)</span>
            </div>
          )}
          <div className="p-4 grid md:grid-cols-[1fr_10rem_10rem_auto] gap-2 items-end border-b border-slate-100 dark:border-slate-800">
            <div>
              <label className="text-[11px] font-bold text-slate-500 block mb-1">رقم الفاتورة</label>
              <input value={deliveryInvoiceQuery} onChange={(e) => setDeliveryInvoiceQuery(e.target.value)} className={inputCls} dir="ltr" placeholder="SAL-… أو رقم الفاتورة" />
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-500 block mb-1">تاريخ التوصيل</label>
              <input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} className={inputCls} dir="ltr" />
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-500 block mb-1">المندوب/الفريق (اختياري)</label>
              <input value={deliveryAssignee} onChange={(e) => setDeliveryAssignee(e.target.value)} className={inputCls} />
            </div>
            <button type="button" onClick={scheduleDeliveryFromInvoice} className="h-9 px-3 rounded-lg bg-brand-600 text-white text-[12px] font-bold hover:bg-brand-700">جدولة</button>
          </div>
          {pendingDeliveries.length === 0 ? (
            <div className="text-center text-slate-400 text-[12px] py-8">لا طلبات توصيل معلَّقة ✅</div>
          ) : (
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-slate-400 text-[11px] border-b border-slate-100 dark:border-slate-800">
                  <th className="px-4 py-2 text-right font-bold">الفاتورة</th>
                  <th className="px-4 py-2 text-right font-bold">تاريخ التوصيل</th>
                  <th className="px-4 py-2 text-right font-bold">المندوب</th>
                  <th className="px-4 py-2 text-right font-bold">الحالة</th>
                  <th className="px-4 py-2 text-left font-bold">إجراء</th>
                </tr>
              </thead>
              <tbody>
                {pendingDeliveries.map(({ job, sale }) => (
                  <tr key={job.id} className="border-b border-slate-50 dark:border-slate-800/50">
                    <td className="px-4 py-2 font-bold text-slate-700 dark:text-slate-200">{sale?.invoiceNumber ?? `#${job.saleId}`}</td>
                    <td className="px-4 py-2 text-slate-400 text-[11px]" dir="ltr">{job.scheduledAt}</td>
                    <td className="px-4 py-2 text-slate-400 text-[11px]">{job.assignedTo ?? '—'}</td>
                    <td className="px-4 py-2">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${job.status === 'scheduled' ? 'bg-sky-500/10 text-sky-600' : 'bg-amber-500/10 text-amber-600'}`}>
                        {job.status === 'scheduled' ? 'مجدوَل' : 'جارٍ التنفيذ'}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-left">
                      {job.status === 'scheduled' && <button type="button" onClick={() => setDeliveryStatus(job.id, 'in_progress')} className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 ml-1">بدء التنفيذ</button>}
                      <button type="button" onClick={() => setDeliveryStatus(job.id, 'done')} className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20">تم التسليم</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'sales' && (
        <div className={`anim-up ${card} overflow-hidden`}>
          <div className="px-4 py-3 text-[12px] font-extrabold text-slate-600 dark:text-slate-300 border-b border-slate-100 dark:border-slate-800">
            🛡️ الضمان الممتد ومعدل المطالبات <span className="text-[10px] font-normal text-slate-400">— سد فجوة فورية (أجهزة كهربائية): معدل الإقران خلال الفترة + معدل تكرار مطالبات الضمان لكل صنف</span>
          </div>
          <div className="p-4 grid sm:grid-cols-2 gap-3 border-b border-slate-100 dark:border-slate-800 text-center">
            <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/20 py-3">
              <div className="text-[11px] font-bold text-slate-400">قطع مباعة في الفترة</div>
              <div className="text-xl font-black text-slate-700 dark:text-slate-200">{warrantyAttach.totalSold}</div>
            </div>
            <div className="rounded-xl bg-sky-500/5 border border-sky-500/20 py-3">
              <div className="text-[11px] font-bold text-slate-400">معدل إقران الضمان الممتد (Attach Rate)</div>
              <div className="text-xl font-black text-sky-600">{warrantyAttach.overallAttachRatePercent}% <span className="text-[11px] font-bold text-slate-400">({warrantyAttach.totalExtended} قطعة)</span></div>
            </div>
          </div>
          {warrantyAttach.rows.length > 0 && (
            <table className="w-full text-[12.5px] border-b border-slate-100 dark:border-slate-800">
              <thead>
                <tr className="text-slate-400 text-[11px] border-b border-slate-100 dark:border-slate-800">
                  <th className="px-4 py-2 text-right font-bold">الصنف</th>
                  <th className="px-4 py-2 text-right font-bold">قطع مباعة</th>
                  <th className="px-4 py-2 text-right font-bold">بضمان ممتد</th>
                  <th className="px-4 py-2 text-right font-bold">معدل الإقران</th>
                </tr>
              </thead>
              <tbody>
                {warrantyAttach.rows.map((r) => (
                  <tr key={r.itemId} className="border-b border-slate-50 dark:border-slate-800/50">
                    <td className="px-4 py-2 font-bold text-slate-700 dark:text-slate-200">{itemName(r.itemId)}</td>
                    <td className="px-4 py-2 text-slate-400">{r.soldCount}</td>
                    <td className="px-4 py-2 text-slate-400">{r.extendedCount}</td>
                    <td className="px-4 py-2 font-bold text-sky-600">{r.attachRatePercent}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="px-4 py-2 text-[11px] font-bold text-slate-400 border-b border-slate-100 dark:border-slate-800">معدل تكرار مطالبات الضمان لكل صنف (كل الفترات — مؤشر جودة)</div>
          {warrantyClaims.length === 0 ? (
            <div className="text-center text-slate-400 text-[12px] py-6">لا بيانات كافية (قطع مباعة مرتبطة بسيريال وضمان)</div>
          ) : (
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-slate-400 text-[11px] border-b border-slate-100 dark:border-slate-800">
                  <th className="px-4 py-2 text-right font-bold">الصنف</th>
                  <th className="px-4 py-2 text-right font-bold">قطع مباعة</th>
                  <th className="px-4 py-2 text-right font-bold">قطع فُتحت لها تذكرة ضمن الضمان</th>
                  <th className="px-4 py-2 text-right font-bold">معدل المطالبات</th>
                </tr>
              </thead>
              <tbody>
                {warrantyClaims.map((r) => (
                  <tr key={r.itemId} className="border-b border-slate-50 dark:border-slate-800/50">
                    <td className="px-4 py-2 font-bold text-slate-700 dark:text-slate-200">{itemName(r.itemId)}</td>
                    <td className="px-4 py-2 text-slate-400">{r.soldUnderWarranty}</td>
                    <td className="px-4 py-2 text-slate-400">{r.claimsCount}</td>
                    <td className={`px-4 py-2 font-bold ${r.claimRatePercent >= 15 ? 'text-rose-600' : 'text-slate-600 dark:text-slate-300'}`}>{r.claimRatePercent}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'sales' && (
        <div className={`anim-up ${card} overflow-hidden`}>
          <div className="px-4 py-3 text-[12px] font-extrabold text-slate-600 dark:text-slate-300 border-b border-slate-100 dark:border-slate-800">
            📦 طلبات العملاء المعلّقة <span className="text-[10px] font-normal text-slate-400">— سد فجوة فورية (قطع غيار): طلب خاص لقطعة غير متوفرة، يُربط اختيارياً بأمر شراء فيتحول تلقائياً إلى «وصلت» عند اكتمال استلامه</span>
          </div>
          <div className="p-4 grid md:grid-cols-6 gap-2 items-end border-b border-slate-100 dark:border-slate-800">
            <div className="md:col-span-2">
              <label className="text-[11px] font-bold text-slate-500 block mb-1">الصنف</label>
              <select value={newPartOrderItemId} onChange={(e) => setNewPartOrderItemId(e.target.value)} className={inputCls}>
                <option value="">اختر الصنف…</option>
                {items.filter((it) => it.isActive).map((it) => <option key={it.id} value={it.id}>{it.nameAr}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-500 block mb-1">عميل مسجّل (اختياري)</label>
              <select value={newPartOrderCustomerId} onChange={(e) => setNewPartOrderCustomerId(e.target.value)} className={inputCls}>
                <option value="">— بلا —</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.nameAr}</option>)}
              </select>
            </div>
            {!newPartOrderCustomerId && (
              <div>
                <label className="text-[11px] font-bold text-slate-500 block mb-1">اسم العميل</label>
                <input value={newPartOrderCustomerName} onChange={(e) => setNewPartOrderCustomerName(e.target.value)} className={inputCls} />
              </div>
            )}
            <div>
              <label className="text-[11px] font-bold text-slate-500 block mb-1">جوال العميل (لواتساب)</label>
              <input value={newPartOrderCustomerPhone} onChange={(e) => setNewPartOrderCustomerPhone(e.target.value)} className={inputCls} dir="ltr" placeholder="01x…" />
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-500 block mb-1">الكمية</label>
              <input type="number" min={1} value={newPartOrderQty} onChange={(e) => setNewPartOrderQty(e.target.value)} className={inputCls} dir="ltr" />
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-500 block mb-1">أمر شراء مرتبط (اختياري)</label>
              <select value={newPartOrderPoId} onChange={(e) => setNewPartOrderPoId(e.target.value)} className={inputCls}>
                <option value="">— بلا —</option>
                {openPurchaseOrders.map((o) => <option key={o.id} value={o.id}>{o.orderNumber} — {o.supplierName}</option>)}
              </select>
            </div>
            <button type="button" onClick={submitPartOrder} className="px-4 py-2 rounded-xl bg-sky-600 text-white text-[12.5px] font-bold hover:bg-sky-700 md:col-span-6 w-fit justify-self-start">+ تسجيل طلب عميل</button>
          </div>
          {sortedPartOrders.length === 0 ? (
            <div className="text-center text-slate-400 text-[12px] py-6">لا طلبات عملاء معلّقة مسجّلة</div>
          ) : (
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-slate-400 text-[11px] border-b border-slate-100 dark:border-slate-800">
                  <th className="px-4 py-2 text-right font-bold">الأمر</th>
                  <th className="px-4 py-2 text-right font-bold">الصنف</th>
                  <th className="px-4 py-2 text-right font-bold">العميل</th>
                  <th className="px-4 py-2 text-right font-bold">الكمية</th>
                  <th className="px-4 py-2 text-right font-bold">الحالة</th>
                  <th className="px-4 py-2 text-left font-bold">إجراء</th>
                </tr>
              </thead>
              <tbody>
                {sortedPartOrders.map((o) => (
                  <tr key={o.id} className="border-b border-slate-50 dark:border-slate-800/50">
                    <td className="px-4 py-2 font-bold text-slate-700 dark:text-slate-200" dir="ltr">{o.orderNumber}</td>
                    <td className="px-4 py-2">{o.itemNameAr}</td>
                    <td className="px-4 py-2">{o.customerName}</td>
                    <td className="px-4 py-2">{o.qty}</td>
                    <td className="px-4 py-2">
                      <span className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full ${o.status === 'pending' ? 'bg-amber-500/10 text-amber-600' : o.status === 'arrived' ? 'bg-sky-500/10 text-sky-600' : o.status === 'delivered' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-slate-500/10 text-slate-500'}`}>
                        {PENDING_PART_ORDER_STATUS_AR[o.status]}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-left whitespace-nowrap">
                      {o.status === 'pending' && <button type="button" onClick={() => setPendingPartOrderStatus(o.id, 'arrived')} className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-600 hover:bg-sky-500/20 ml-1">وصلت</button>}
                      {o.status === 'arrived' && o.customerPhone && (
                        <a href={waChatLink(o.customerPhone, buildPartArrivedMessage(o, setup.shopName || ''))} target="_blank" rel="noreferrer" className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 ml-1">📲 إخطار واتساب</a>
                      )}
                      {o.status === 'arrived' && <button type="button" onClick={() => setPendingPartOrderStatus(o.id, 'delivered')} className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 ml-1">تم التسليم</button>}
                      {(o.status === 'pending' || o.status === 'arrived') && <button type="button" onClick={() => setPendingPartOrderStatus(o.id, 'cancelled')} className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-600 hover:bg-rose-500/20 ml-1">إلغاء</button>}
                      <button type="button" onClick={() => deletePendingPartOrder(o.id)} className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-500/10 text-slate-500 hover:bg-slate-500/20">حذف</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'items' && (
        <div className="anim-up space-y-4">
        <div className={`${card} overflow-hidden`}>
          {top.length === 0 ? (
            <div className="text-center text-slate-400 text-[13px] py-10">
              {setup.modules.includes('pos') ? 'لا مبيعات أصناف في هذه الفترة' : 'نشاطك لا يبيع بالكاشير — الأصناف هنا تُعرض عند البيع عبر الفاتورة أو المحرك التخصصي'}
            </div>
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-slate-400 text-[11px] border-b border-slate-100 dark:border-slate-800">
                  <th className="px-4 py-3 text-right font-bold">#</th>
                  <th className="px-4 py-3 text-right font-bold">الصنف</th>
                  <th className="px-4 py-3 text-right font-bold">الكمية</th>
                  <th className="px-4 py-3 text-right font-bold">الإيراد</th>
                  <th className="px-4 py-3 text-right font-bold">التكلفة</th>
                  <th className="px-4 py-3 text-right font-bold">الربح</th>
                  <th className="px-4 py-3 text-right font-bold">هامش الربح</th>
                </tr>
              </thead>
              <tbody>
                {top.map((r, i) => (
                  <tr key={r.itemId} className="border-b border-slate-50 dark:border-slate-800/50 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="px-4 py-2.5 text-slate-400">{i + 1}</td>
                    <td className="px-4 py-2.5 font-bold text-slate-700 dark:text-slate-200">{r.nameAr}</td>
                    <td className="px-4 py-2.5">{r.qty}</td>
                    <td className="px-4 py-2.5 font-bold">{fmt(r.revenueMinor)}</td>
                    <td className="px-4 py-2.5 text-slate-500">{fmt(r.cogsMinor)}</td>
                    <td className={`px-4 py-2.5 font-black ${r.profitMinor >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmt(r.profitMinor)}</td>
                    <td className={`px-4 py-2.5 font-bold ${r.profitMinor >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {r.revenueMinor > 0 ? `${Math.round((r.profitMinor / r.revenueMinor) * 1000) / 10}٪` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {/* تحليل ABC (سد فجوة: لا تصنيف أصناف حسب مساهمتها بالإيراد — باريتو 80/95) */}
          {abcRows.length > 0 && (
            <div className="border-t border-slate-100 dark:border-slate-800">
              <div className="px-4 py-3 text-[12px] font-black text-slate-600 dark:text-slate-300 flex items-center justify-between flex-wrap gap-2">
                <span>🔠 تحليل ABC — تصنيف الأصناف بمساهمتها بالإيراد</span>
                <span className="flex items-center gap-2 text-[10.5px] font-bold">
                  <span className="text-emerald-600">A: {abcRows.filter((r) => r.class === 'A').length}</span>
                  <span className="text-amber-600">B: {abcRows.filter((r) => r.class === 'B').length}</span>
                  <span className="text-rose-500">C: {abcRows.filter((r) => r.class === 'C').length}</span>
                </span>
              </div>
              <div className="px-4 pb-2 text-[10.5px] text-slate-400">A = أول أصناف تشكّل 80٪ من الإيراد (تستحق أعلى عناية ومتابعة مخزون) · B = حتى 95٪ · C = الباقي (أثر محدود على الإيراد)</div>
              <div className="max-h-96 overflow-y-auto">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="text-slate-400 text-[11px] border-b border-slate-100 dark:border-slate-800">
                      <th className="px-4 py-2 text-right font-bold">الفئة</th>
                      <th className="px-4 py-2 text-right font-bold">الصنف</th>
                      <th className="px-4 py-2 text-right font-bold">الإيراد</th>
                      <th className="px-4 py-2 text-right font-bold">% من الإيراد</th>
                      <th className="px-4 py-2 text-right font-bold">% تراكمية</th>
                    </tr>
                  </thead>
                  <tbody>
                    {abcRows.map((r) => (
                      <tr key={r.itemId} className="border-b border-slate-50 dark:border-slate-800/50">
                        <td className="px-4 py-2">
                          <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-black text-white ${r.class === 'A' ? 'bg-emerald-500' : r.class === 'B' ? 'bg-amber-500' : 'bg-rose-400'}`}>{r.class}</span>
                        </td>
                        <td className="px-4 py-2 font-bold text-slate-700 dark:text-slate-200">{r.nameAr}</td>
                        <td className="px-4 py-2 font-bold">{fmt(r.revenueMinor)}</td>
                        <td className="px-4 py-2">{r.sharePercent}٪</td>
                        <td className="px-4 py-2 text-slate-400">{r.cumulativeSharePercent}٪</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {/* ربح حسب درجة القطعة (سد فجوة فورية #3 — النشاط #7: قطع غيار) */}
          {hasGradedItems && gradeProfit.length > 0 && (
            <div className="border-t border-slate-100 dark:border-slate-800">
              <div className="px-4 py-3 text-[12px] font-black text-slate-600 dark:text-slate-300">⚙️ الربح حسب درجة القطعة (أصلي/بديل تجاري/مستعمل)</div>
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-slate-400 text-[11px] border-b border-slate-100 dark:border-slate-800">
                    <th className="px-4 py-2 text-right font-bold">الدرجة</th>
                    <th className="px-4 py-2 text-right font-bold">الكمية</th>
                    <th className="px-4 py-2 text-right font-bold">الإيراد</th>
                    <th className="px-4 py-2 text-right font-bold">الربح</th>
                    <th className="px-4 py-2 text-right font-bold">هامش الربح</th>
                  </tr>
                </thead>
                <tbody>
                  {gradeProfit.map((r) => (
                    <tr key={r.grade} className="border-b border-slate-50 dark:border-slate-800/50">
                      <td className="px-4 py-2 font-bold text-slate-700 dark:text-slate-200">
                        {r.grade === 'unspecified' ? '— غير محددة' : `${GRADE_LABELS[r.grade].icon} ${GRADE_LABELS[r.grade].nameAr}`}
                      </td>
                      <td className="px-4 py-2">{r.qty}</td>
                      <td className="px-4 py-2 font-bold">{fmt(r.revenueMinor)}</td>
                      <td className={`px-4 py-2 font-black ${r.profitMinor >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmt(r.profitMinor)}</td>
                      <td className={`px-4 py-2 font-bold ${r.profitMinor >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{r.marginPercent}٪</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {/* توقع طلب إحصائي (سد فجوة مستقبلية: تنبؤ ذكاء اصطناعي — نسخة إحصائية محلية، ليست تعلّماً آلياً حقيقياً) */}
          {forecastRows.length > 0 && (
            <div className="border-t border-slate-100 dark:border-slate-800">
              <div className="px-4 py-3 text-[12px] font-black text-slate-600 dark:text-slate-300">📈 توقع الطلب الأسبوعي (إحصائي — متوسط متحرك باتجاه)</div>
              <div className="px-4 pb-2 text-[10.5px] text-slate-400">أداة استرشادية محلية بلا اتصال سحابي: تقارن متوسط آخر 8 أسابيع بنصفها الأحدث لتقدير اتجاه الطلب — ليست تنبؤاً بالذكاء الاصطناعي، والقرار النهائي للمالك.</div>
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="text-slate-400 text-[11px] border-b border-slate-100 dark:border-slate-800">
                      <th className="px-4 py-2 text-right font-bold">الصنف</th>
                      <th className="px-4 py-2 text-right font-bold">متوسط أسبوعي</th>
                      <th className="px-4 py-2 text-right font-bold">الاتجاه</th>
                      <th className="px-4 py-2 text-right font-bold">توقع الأسبوع القادم</th>
                    </tr>
                  </thead>
                  <tbody>
                    {forecastRows.slice(0, 15).map((r) => (
                      <tr key={r.itemId} className="border-b border-slate-50 dark:border-slate-800/50">
                        <td className="px-4 py-2 font-bold text-slate-700 dark:text-slate-200">{r.nameAr}</td>
                        <td className="px-4 py-2">{r.avgWeeklyQty}</td>
                        <td className={`px-4 py-2 font-bold ${r.trendPercent > 0 ? 'text-emerald-600' : r.trendPercent < 0 ? 'text-rose-500' : 'text-slate-400'}`}>
                          {r.trendPercent > 0 ? '▲' : r.trendPercent < 0 ? '▼' : '—'} {r.trendPercent}٪
                        </td>
                        <td className="px-4 py-2 font-black">{r.forecastNextWeekQty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {/* الراكد — نمط DEXEF «تقرير الراكد وحد الطلب»: رأس المال المحبوس أولاً */}
          <div className="border-t border-slate-100 dark:border-slate-800">
            <div className="px-4 py-3 text-[12px] font-black text-slate-600 dark:text-slate-300 flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                🐢 الأصناف الراكدة (لم تُبع منذ {stagnantThresholdDays}+ يوماً وعليها مخزون)
                <span className="flex items-center gap-1 font-normal">
                  <label className="text-[10px] text-slate-400">عتبة الركود (أيام):</label>
                  <input
                    type="number" min={1} value={stagnantThresholdDays}
                    onChange={(e) => setStagnantThresholdDays(Math.max(1, Number(e.target.value) || defaultStagnantDays))}
                    className="w-16 h-6 text-center text-[11px] rounded-md border border-slate-200 dark:border-slate-700 bg-transparent outline-none"
                    dir="ltr"
                  />
                </span>
              </span>
              {stagnant.length > 0 && <span className="text-rose-500">رأس مال محبوس: {fmt(stagnant.reduce((a, r) => a + r.stockValueMinor, 0))} {cur.symbol}</span>}
            </div>
            {stagnant.length === 0 ? (
              <div className="text-center text-emerald-500 text-[12px] pb-4 font-bold">لا أصناف راكدة — كل المخزون يتحرك ✓</div>
            ) : (
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-slate-400 text-[11px] border-b border-slate-100 dark:border-slate-800">
                    <th className="px-4 py-2 text-right font-bold">الصنف</th>
                    <th className="px-4 py-2 text-right font-bold">الرصيد</th>
                    <th className="px-4 py-2 text-right font-bold">قيمة المخزون</th>
                    <th className="px-4 py-2 text-right font-bold">آخر بيع</th>
                  </tr>
                </thead>
                <tbody>
                  {stagnant.slice(0, 15).map((r) => (
                    <tr key={r.itemId} className="border-b border-slate-50 dark:border-slate-800/50">
                      <td className="px-4 py-2 font-bold text-slate-700 dark:text-slate-200">{r.nameAr}</td>
                      <td className="px-4 py-2">{r.stockQty}</td>
                      <td className="px-4 py-2 font-bold text-rose-600">{fmt(r.stockValueMinor)}</td>
                      <td className="px-4 py-2 text-slate-500">{r.idleDays === -1 ? 'لم يُبع قط' : `${r.lastSoldDate} (${r.idleDays} يوماً)`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {/* تفصيل الركود على مستوى التركيبة لون×مقاس — نشاط الملابس: صنف "متحرك" ككل
                قد يُخفي لوناً/مقاساً راكداً تماماً لا يظهر في الجدول أعلاه */}
            {stagnantVariantRows.length > 0 && (
              <div className="border-t border-slate-100 dark:border-slate-800">
                <div className="px-4 py-2.5 text-[11.5px] font-black text-slate-500 dark:text-slate-400">🎨 تفصيل الركود حسب التركيبة (لون/مقاس) — قد تكون راكدة حتى لو الصنف ككل "متحرك"</div>
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-slate-400 text-[10.5px] border-b border-slate-100 dark:border-slate-800">
                      <th className="px-4 py-1.5 text-right font-bold">الصنف</th>
                      <th className="px-4 py-1.5 text-right font-bold">التركيبة</th>
                      <th className="px-4 py-1.5 text-right font-bold">الرصيد</th>
                      <th className="px-4 py-1.5 text-right font-bold">قيمة المخزون</th>
                      <th className="px-4 py-1.5 text-right font-bold">آخر بيع</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stagnantVariantRows.slice(0, 15).map((r) => (
                      <tr key={`${r.itemId}-${r.color}-${r.size}`} className="border-b border-slate-50 dark:border-slate-800/50">
                        <td className="px-4 py-1.5 font-bold text-slate-700 dark:text-slate-200">{r.nameAr}</td>
                        <td className="px-4 py-1.5 text-slate-500">{[r.color, r.size].filter(Boolean).join(' / ') || '—'}</td>
                        <td className="px-4 py-1.5">{r.qty}</td>
                        <td className="px-4 py-1.5 font-bold text-rose-600">{fmt(r.stockValueMinor)}</td>
                        <td className="px-4 py-1.5 text-slate-500">{r.idleDays === -1 ? 'لم يُبع قط' : `${r.lastSoldDate} (${r.idleDays} يوماً)`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          {/* أسباب الإرجاع — سد فجوة توثيق (الدليل الداخلي يوصي بمراقبته) */}
          <div className="border-t border-slate-100 dark:border-slate-800">
            <div className="px-4 py-3 text-[12px] font-black text-slate-600 dark:text-slate-300 flex items-center justify-between">
              <span>↩️ تحليل أسباب الإرجاع (الفترة المحددة)</span>
              {returnReasons.length > 0 && <span className="text-slate-400">{returnReasons.reduce((a, r) => a + r.count, 0)} مرتجعاً</span>}
            </div>
            {returnReasons.length === 0 ? (
              <div className="text-center text-emerald-500 text-[12px] pb-4 font-bold">لا مرتجعات في هذه الفترة ✓</div>
            ) : (
              <>
                {returnReasons[0].reasonCode === 'expired' && returnReasons[0].count >= 3 && (
                  <div className="mx-4 mb-2 rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-400 text-[11.5px] font-bold px-3 py-2">
                    ⚠️ «منتهي الصلاحية» هو السبب الأكثر تكراراً ({returnReasons[0].count} مرتجعاً) — يشير غالباً لخلل في تدوير الأرفف (الأقدم صلاحية يُباع أولاً).
                  </div>
                )}
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="text-slate-400 text-[11px] border-b border-slate-100 dark:border-slate-800">
                      <th className="px-4 py-2 text-right font-bold">السبب</th>
                      <th className="px-4 py-2 text-right font-bold">عدد المرتجعات</th>
                      <th className="px-4 py-2 text-right font-bold">القيمة الإجمالية</th>
                      <th className="px-4 py-2 text-right font-bold">تالف</th>
                      <th className="px-4 py-2 text-right font-bold">سليم (يعود للرف)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {returnReasons.map((r) => (
                      <tr key={r.reasonCode} className="border-b border-slate-50 dark:border-slate-800/50">
                        <td className="px-4 py-2 font-bold text-slate-700 dark:text-slate-200">{r.nameAr}</td>
                        <td className="px-4 py-2">{r.count}</td>
                        <td className="px-4 py-2 font-bold text-amber-600">{fmt(r.totalValueMinor)}</td>
                        <td className="px-4 py-2 text-rose-500">{r.damagedLines || '—'}</td>
                        <td className="px-4 py-2 text-emerald-600">{r.resellableLines || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                 </table>
               </>
             )}
           </div>
         </div>
         <MarketPriceReferenceCard card={card} />
        </div>
      )}

      {tab === 'parties' && (
        <div className="anim-up space-y-3">
        <div className="flex justify-end">
          <button
            onClick={() => {
              // مطبوعة رسمية موحّدة المصدر مع كشوف الحساب (طلب المالك: طباعة مفلترة احترافية)
              const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
              const table = (title: string, rows: { name: string; bal: number }[], meaning: [string, string]) =>
                `<h3 style="margin:14px 0 6px;font-size:1.05em">${title}</h3>
                 <table><thead><tr><th>الاسم</th><th>الحالة</th><th>الرصيد</th></tr></thead><tbody>
                 ${rows.length === 0 ? '<tr><td colspan="3">لا أرصدة</td></tr>' : rows.map((r) => `<tr><td>${esc(r.name)}</td><td>${r.bal > 0 ? meaning[0] : meaning[1]}</td><td class="num">${fmt(Math.abs(r.bal))}</td></tr>`).join('')}
                 <tr class="total"><td colspan="2">الصافي</td><td class="num">${fmt(rows.reduce((a2, r) => a2 + r.bal, 0))}</td></tr></tbody></table>`
              const { reportPrint, receipt } = useAppStore.getState()
              printHtml(renderReportShell({
                title: 'تقرير أرصدة العملاء والموردين',
                subtitle: `${setup.shopName || ''} — الأرصدة الحية الموحّدة مع كشوف الحساب · ${todayLocalIso()}`,
                companyName: setup.shopName || '',
                logoDataUrl: receipt.logoDataUrl,
                settings: reportPrint,
                bodyHtml:
                  table('أرصدة العملاء', custRows.map((r) => ({ name: custName(r.customerId), bal: r.balanceMinor })), ['مدين — عليه', 'دائن — له']) +
                  table('أرصدة الموردين', suppRows.map((r) => ({ name: suppName(r.supplierId), bal: r.balanceMinor })), ['له علينا', 'لنا عنده']),
              }))
            }}
            className="px-3 py-1.5 rounded-lg text-[12px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-sky-600 transition-all flex items-center gap-1.5"
          >
            <Printer size={13} /> طباعة تقرير الأرصدة
          </button>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className={`${card} overflow-hidden`}>
            <div className="px-4 py-3 text-[12px] font-extrabold text-slate-600 dark:text-slate-300 border-b border-slate-100 dark:border-slate-800 flex items-center gap-1.5">
              <Users size={14} className="text-violet-500" /> أرصدة العملاء (موحّدة مع كشوف الحساب)
            </div>
            {custRows.length === 0 ? (
              <div className="text-center text-slate-400 text-[12px] py-8">لا ذمم عملاء</div>
            ) : (
              <table className="w-full text-[12.5px]">
                <tbody>
                  {custRows.map((r) => (
                    <tr key={r.customerId} className="border-b border-slate-50 dark:border-slate-800/50">
                      <td className="px-4 py-2 font-bold text-slate-700 dark:text-slate-200">{custName(r.customerId)}</td>
                      <td className="px-4 py-2 text-[10px] text-slate-400">{r.balanceMinor > 0 ? 'مدين — عليه' : 'دائن — له'}</td>
                      <td className={`px-4 py-2 font-black text-left ${r.balanceMinor > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{fmt(r.balanceMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className={`${card} overflow-hidden`}>
            <div className="px-4 py-3 text-[12px] font-extrabold text-slate-600 dark:text-slate-300 border-b border-slate-100 dark:border-slate-800 flex items-center gap-1.5">
              <Truck size={14} className="text-cyan-500" /> أرصدة الموردين (موحّدة مع كشوف الحساب)
            </div>
            {suppRows.length === 0 ? (
              <div className="text-center text-slate-400 text-[12px] py-8">لا مستحقات موردين</div>
            ) : (
              <table className="w-full text-[12.5px]">
                <tbody>
                  {suppRows.map((r) => (
                    <tr key={r.supplierId} className="border-b border-slate-50 dark:border-slate-800/50">
                      <td className="px-4 py-2 font-bold text-slate-700 dark:text-slate-200">{suppName(r.supplierId)}</td>
                      <td className="px-4 py-2 text-[10px] text-slate-400">{r.balanceMinor > 0 ? 'له علينا' : 'لنا عنده'}</td>
                      <td className={`px-4 py-2 font-black text-left ${r.balanceMinor > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{fmt(r.balanceMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* أعمار الديون 30/60/90 — المقارنة العالمية (QuickBooks A/R Aging Summary) */}
        {(custAging.length > 0 || suppAging.length > 0) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {[
              { title: 'أعمار ديون العملاء (المتبقي غير المسدد)', rows: custAging.map((r) => ({ key: r.customerId, name: custName(r.customerId), a: r.aging })) },
              { title: 'أعمار مستحقات الموردين', rows: suppAging.map((r) => ({ key: r.supplierId, name: suppName(r.supplierId), a: r.aging })) },
            ].map((sec) => (
              <div key={sec.title} className={`${card} overflow-hidden`}>
                <div className="px-4 py-3 text-[12px] font-extrabold text-slate-600 dark:text-slate-300 border-b border-slate-100 dark:border-slate-800">
                  ⏳ {sec.title}
                </div>
                {sec.rows.length === 0 ? (
                  <div className="text-center text-slate-400 text-[12px] py-8">لا ديون قائمة ✅</div>
                ) : (
                  <table className="w-full text-[11.5px]">
                    <thead>
                      <tr className="text-right text-[10px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                        <th className="px-3 py-2 font-bold">الاسم</th>
                        <th className="px-2 py-2 font-bold">حتى 30ي</th>
                        <th className="px-2 py-2 font-bold">31–60</th>
                        <th className="px-2 py-2 font-bold">61–90</th>
                        <th className="px-2 py-2 font-bold text-rose-500">+90</th>
                        <th className="px-2 py-2 font-bold">الإجمالي</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sec.rows.map((r) => (
                        <tr key={r.key} className="border-b border-slate-50 dark:border-slate-800/50">
                          <td className="px-3 py-2 font-bold text-slate-700 dark:text-slate-200">{r.name}</td>
                          <td className="px-2 py-2">{r.a.currentMinor ? fmt(r.a.currentMinor) : '—'}</td>
                          <td className="px-2 py-2 text-amber-600">{r.a.d31_60Minor ? fmt(r.a.d31_60Minor) : '—'}</td>
                          <td className="px-2 py-2 text-orange-600">{r.a.d61_90Minor ? fmt(r.a.d61_90Minor) : '—'}</td>
                          <td className="px-2 py-2 font-black text-rose-600">{r.a.over90Minor ? fmt(r.a.over90Minor) : '—'}</td>
                          <td className="px-2 py-2 font-black">{fmt(r.a.totalMinor)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
          </div>
        )}
        </div>
      )}

      {tab === 'inventory' && (
        <div className="anim-up grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className={`${card} overflow-hidden`}>
            <div className="px-4 py-3 text-[12px] font-extrabold text-slate-600 dark:text-slate-300 border-b border-slate-100 dark:border-slate-800 flex items-center gap-1.5">
              <AlertTriangle size={14} className="text-amber-500" /> تنبيهات المخزون ({alerts.length})
            </div>
            {alerts.length === 0 ? (
              <div className="text-center text-slate-400 text-[12px] py-8">كل الأصناف فوق حد الطلب ✅</div>
            ) : (
              <table className="w-full text-[12.5px]">
                <tbody>
                  {alerts.map((r) => (
                    <tr key={r.itemId} className="border-b border-slate-50 dark:border-slate-800/50">
                      <td className="px-4 py-2 font-bold text-slate-700 dark:text-slate-200">{r.nameAr}</td>
                      <td className="px-4 py-2 text-slate-400 text-[11px]">المتاح {r.stockQty} — الحد {r.minQty}</td>
                      <td className="px-4 py-2 text-left">
                        {r.kind === 'out'
                          ? <span className="text-[10px] font-bold text-rose-600 bg-rose-500/10 px-2 py-0.5 rounded-full">نافد</span>
                          : <span className="text-[10px] font-bold text-amber-600 bg-amber-500/10 px-2 py-0.5 rounded-full">منخفض</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className={`${card} overflow-hidden`}>
            <div className="px-4 py-3 text-[12px] font-extrabold text-slate-600 dark:text-slate-300 border-b border-slate-100 dark:border-slate-800 flex items-center gap-1.5">
              <AlertTriangle size={14} className="text-rose-500" /> تنبيهات الصلاحية FEFO ({expAlerts.length})
            </div>
            {expAlerts.length === 0 ? (
              <div className="text-center text-slate-400 text-[12px] py-8">لا دفعات منتهية أو تنتهي خلال 30 يوماً ✅</div>
            ) : (
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-[12.5px]">
                  <tbody>
                    {expAlerts.map((r, i) => (
                      <tr key={i} className="border-b border-slate-50 dark:border-slate-800/50">
                        <td className="px-4 py-2 font-bold text-slate-700 dark:text-slate-200">{r.nameAr}{r.lotNumber && <span className="mr-1.5 font-mono font-normal text-[10px] text-slate-400" dir="ltr">(تشغيلة {r.lotNumber})</span>}</td>
                        <td className="px-4 py-2 text-slate-400 text-[11px]" dir="ltr">{r.expiryDate} — كمية {r.qty}</td>
                        <td className="px-4 py-2 text-left">
                          {r.status === 'expired'
                            ? <span className="text-[10px] font-bold text-rose-600 bg-rose-500/10 px-2 py-0.5 rounded-full">منتهٍ منذ {-r.daysLeft} يوم</span>
                            : <span className="text-[10px] font-bold text-amber-600 bg-amber-500/10 px-2 py-0.5 rounded-full">ينتهي خلال {r.daysLeft} يوم</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          {markdowns.length > 0 && (
            <div className={`${card} overflow-hidden`}>
              <div className="px-4 py-3 text-[12px] font-extrabold text-slate-600 dark:text-slate-300 border-b border-slate-100 dark:border-slate-800 flex items-center gap-1.5">
                🏷️ اقتراح تخفيض قرب الانتهاء ({markdowns.length}) <span className="text-[10px] font-normal text-slate-400">— استرشادي، لا يُغيّر السعر تلقائياً</span>
              </div>
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="text-slate-400 text-[11px] border-b border-slate-100 dark:border-slate-800">
                      <th className="px-4 py-2 text-right font-bold">الصنف</th>
                      <th className="px-4 py-2 text-right font-bold">ينتهي خلال</th>
                      <th className="px-4 py-2 text-right font-bold">السعر الحالي</th>
                      <th className="px-4 py-2 text-right font-bold">خصم مقترح</th>
                      <th className="px-4 py-2 text-right font-bold">السعر المقترح</th>
                    </tr>
                  </thead>
                  <tbody>
                    {markdowns.map((r, i) => (
                      <tr key={i} className="border-b border-slate-50 dark:border-slate-800/50">
                        <td className="px-4 py-2 font-bold text-slate-700 dark:text-slate-200">{r.nameAr}</td>
                        <td className="px-4 py-2 text-amber-600 text-[11px]">{r.daysLeft} يوم</td>
                        <td className="px-4 py-2 text-slate-400">{fmt(r.currentPriceMinor)}</td>
                        <td className="px-4 py-2 font-bold text-rose-500">{r.suggestedDiscountPercent}٪</td>
                        <td className="px-4 py-2 font-black text-emerald-600">{fmt(r.suggestedPriceMinor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {expiryValueRows.some((r) => r.qty > 0) && (
            <div className={`${card} overflow-hidden`}>
              <div className="px-4 py-3 text-[12px] font-extrabold text-slate-600 dark:text-slate-300 border-b border-slate-100 dark:border-slate-800 flex items-center gap-1.5">
                💰 قيمة المخزون المعرَّض لخطر الانتهاء <span className="text-[10px] font-normal text-slate-400">— سد فجوة فورية (صيدلية): تجميع مالي لتنبيهات الصلاحية حسب الأفق الزمني</span>
              </div>
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-slate-400 text-[11px] border-b border-slate-100 dark:border-slate-800">
                    <th className="px-4 py-2 text-right font-bold">الأفق</th>
                    <th className="px-4 py-2 text-right font-bold">عدد الدفعات</th>
                    <th className="px-4 py-2 text-right font-bold">الكمية</th>
                    <th className="px-4 py-2 text-right font-bold">القيمة المعرَّضة للخطر</th>
                  </tr>
                </thead>
                <tbody>
                  {expiryValueRows.map((r) => (
                    <tr key={r.horizonDays} className="border-b border-slate-50 dark:border-slate-800/50">
                      <td className="px-4 py-2 font-bold text-slate-700 dark:text-slate-200">خلال {r.horizonDays} يوم{r.horizonDays === 30 ? ' (شامل المنتهي فعلاً)' : ''}</td>
                      <td className="px-4 py-2 text-slate-400 text-[11px]">{r.batchCount}</td>
                      <td className="px-4 py-2 text-slate-400 text-[11px]">{r.qty}</td>
                      <td className="px-4 py-2 font-black text-rose-600">{fmt(r.valueMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {returnCandidatesBySupplier.length > 0 && (
            <div className={`${card} overflow-hidden`}>
              <div className="px-4 py-3 text-[12px] font-extrabold text-slate-600 dark:text-slate-300 border-b border-slate-100 dark:border-slate-800 flex items-center gap-1.5">
                ↩️ مرشحات إرجاع المورد ({returnCandidates.length}) <span className="text-[10px] font-normal text-slate-400">— دفعات لا تزال داخل نافذة إرجاع موردها المسجَّلة قبل الانتهاء</span>
              </div>
              <div className="max-h-96 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                {returnCandidatesBySupplier.map((group) => (
                  <div key={group.supplierId} className="px-4 py-2">
                    <div className="text-[11px] font-extrabold text-brand-600 mb-1 flex items-center justify-between">
                      <span>{group.supplierName} ({group.rows.length})</span>
                      <button type="button" onClick={() => printSupplierReturnClaim(group.supplierId, group.supplierName, group.rows)} className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-brand-500/10 text-brand-600 hover:bg-brand-500/20">🖨️ طباعة مطالبة الإرجاع</button>
                    </div>
                    <table className="w-full text-[12.5px]">
                      <tbody>
                        {group.rows.map((r, i) => (
                          <tr key={i} className="border-b border-slate-50 dark:border-slate-800/50">
                            <td className="px-2 py-1.5 font-bold text-slate-700 dark:text-slate-200">{r.nameAr}{r.lotNumber && <span className="mr-1.5 font-mono font-normal text-[10px] text-slate-400" dir="ltr">(تشغيلة {r.lotNumber})</span>}</td>
                            <td className="px-2 py-1.5 text-slate-400 text-[11px]" dir="ltr">{r.expiryDate} — كمية {r.qty}</td>
                            <td className="px-2 py-1.5 text-left"><span className="text-[10px] font-bold text-sky-600 bg-sky-500/10 px-2 py-0.5 rounded-full">متبقٍ {r.daysLeft} يوم — نافذة {r.returnWindowDays} يوم</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            </div>
          )}
          {variantLowStockRows.length > 0 && (
            <div className={`${card} overflow-hidden`}>
              <div className="px-4 py-3 text-[12px] font-extrabold text-slate-600 dark:text-slate-300 border-b border-slate-100 dark:border-slate-800 flex items-center gap-1.5">
                <AlertTriangle size={14} className="text-amber-500" /> نقص مخزون التركيبات لون/مقاس ({variantLowStockRows.length}) <span className="text-[10px] font-normal text-slate-400">— سد فجوة نشاط الملابس: نفاد تركيبة بعينها قد لا يظهر في تنبيه الصنف العام</span>
              </div>
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-[12.5px]">
                  <tbody>
                    {variantLowStockRows.map((r, i) => (
                      <tr key={i} className="border-b border-slate-50 dark:border-slate-800/50">
                        <td className="px-4 py-2 font-bold text-slate-700 dark:text-slate-200">{r.itemName}</td>
                        <td className="px-4 py-2 text-slate-400 text-[11px]">{[r.color, r.size].filter(Boolean).join(' / ') || '—'} — المتاح {r.qty}{r.impliedMinQty > 0 ? ` (حد تناسبي ${r.impliedMinQty})` : ''}</td>
                        <td className="px-4 py-2 text-left">
                          {r.kind === 'out'
                            ? <span className="text-[10px] font-bold text-rose-600 bg-rose-500/10 px-2 py-0.5 rounded-full">نافدة</span>
                            : <span className="text-[10px] font-bold text-amber-600 bg-amber-500/10 px-2 py-0.5 rounded-full">منخفضة</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {sizeCurveByItem.length > 0 && (
            <div className={`${card} overflow-hidden lg:col-span-2`}>
              <div className="px-4 py-3 text-[12px] font-extrabold text-slate-600 dark:text-slate-300 border-b border-slate-100 dark:border-slate-800 flex items-center gap-1.5">
                📐 منحنى المقاسات (Size Curve) <span className="text-[10px] font-normal text-slate-400">— نسبة مبيعات كل مقاس بالفترة المحددة؛ استرشد به لتوزيع كمية الشراء القادمة على المقاسات (نشاط الملابس)</span>
              </div>
              <div className="max-h-80 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-0 md:divide-x md:divide-x-reverse divide-slate-100 dark:divide-slate-800">
                {sizeCurveByItem.map((g) => (
                  <div key={g.nameAr + g.rows[0]?.itemId} className="p-3 border-b border-slate-50 dark:border-slate-800/50">
                    <div className="text-[11.5px] font-bold text-slate-600 dark:text-slate-300 mb-1.5">{g.nameAr}</div>
                    <div className="space-y-1">
                      {g.rows.map((r) => (
                        <div key={r.size} className="flex items-center gap-2">
                          <span className="w-14 text-[10.5px] text-slate-400 shrink-0">{r.size}</span>
                          <div className="flex-1 h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                            <div className="h-full bg-violet-500 rounded-full" style={{ width: `${Math.min(100, r.sharePercent)}%` }} />
                          </div>
                          <span className="w-16 text-left text-[10.5px] font-bold text-violet-600 dark:text-violet-300">{r.sharePercent}٪ ({r.soldQty})</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {(receivingVariance.length > 0 || productionVariance.length > 0) && (
            <div className={`${card} overflow-hidden lg:col-span-2`}>
              <div className="px-4 py-3 text-[12px] font-extrabold text-slate-600 dark:text-slate-300 border-b border-slate-100 dark:border-slate-800 flex items-center gap-1.5">
                ⚖️ تقرير فرق الوزن/الهالك <span className="text-[10px] font-normal text-slate-400">— استلام من الموردين + تصنيع داخلي (سد فجوة تجارة الأعلاف والحبوب)</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-0 md:divide-x md:divide-x-reverse divide-slate-100 dark:divide-slate-800">
                <div>
                  <div className="px-4 pt-3 pb-1 text-[11px] font-bold text-slate-500">فرق استلام المشتريات حسب المورد والشهر</div>
                  {receivingVariance.length === 0 ? (
                    <div className="text-center text-slate-400 text-[12px] py-6">لا بيانات وزن مرسَل مسجَّلة بعد</div>
                  ) : (
                    <div className="max-h-72 overflow-y-auto">
                      <table className="w-full text-[12px]">
                        <thead>
                          <tr className="text-slate-400 text-[10.5px] border-b border-slate-100 dark:border-slate-800">
                            <th className="px-4 py-2 text-right font-bold">المورد</th>
                            <th className="px-4 py-2 text-right font-bold">الشهر</th>
                            <th className="px-4 py-2 text-right font-bold">فواتير</th>
                            <th className="px-4 py-2 text-right font-bold">أسوأ فرق</th>
                          </tr>
                        </thead>
                        <tbody>
                          {receivingVariance.map((r, i) => (
                            <tr key={i} className="border-b border-slate-50 dark:border-slate-800/50">
                              <td className="px-4 py-2 font-bold text-slate-700 dark:text-slate-200">{r.supplierNameAr}</td>
                              <td className="px-4 py-2 text-slate-400 text-[11px]" dir="ltr">{r.period}</td>
                              <td className="px-4 py-2 text-slate-400 text-[11px]">{r.invoicesCount}</td>
                              <td className={`px-4 py-2 font-black ${r.exceedsThresholdCount > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{r.maxDiffPercent}٪{r.exceedsThresholdCount > 0 && <span className="text-[10px] font-normal text-rose-400"> ({r.exceedsThresholdCount} تجاوز العتبة)</span>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
                <div>
                  <div className="px-4 pt-3 pb-1 text-[11px] font-bold text-slate-500">فرق هالك التصنيع الداخلي حسب المنتج والشهر</div>
                  {productionVariance.length === 0 ? (
                    <div className="text-center text-slate-400 text-[12px] py-6">لا فروق تصنيع مسجَّلة بعد</div>
                  ) : (
                    <div className="max-h-72 overflow-y-auto">
                      <table className="w-full text-[12px]">
                        <thead>
                          <tr className="text-slate-400 text-[10.5px] border-b border-slate-100 dark:border-slate-800">
                            <th className="px-4 py-2 text-right font-bold">المنتج</th>
                            <th className="px-4 py-2 text-right font-bold">الشهر</th>
                            <th className="px-4 py-2 text-right font-bold">أوامر</th>
                            <th className="px-4 py-2 text-right font-bold">إجمالي الفرق</th>
                            <th className="px-4 py-2 text-right font-bold">أبرز سبب</th>
                          </tr>
                        </thead>
                        <tbody>
                          {productionVariance.map((r, i) => (
                            <tr key={i} className="border-b border-slate-50 dark:border-slate-800/50">
                              <td className="px-4 py-2 font-bold text-slate-700 dark:text-slate-200">{r.productNameAr}</td>
                              <td className="px-4 py-2 text-slate-400 text-[11px]" dir="ltr">{r.period}</td>
                              <td className="px-4 py-2 text-slate-400 text-[11px]">{r.ordersCount}</td>
                              <td className="px-4 py-2 font-black text-amber-600">{r.totalVarianceQty}</td>
                              <td className="px-4 py-2 text-slate-400 text-[11px]">{[...r.byReason].sort((a, b) => b.count - a.count)[0]?.labelAr ?? '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
          {(wastageRatio.length > 0 || wastageByItem.length > 0) && (
            <div className={`${card} overflow-hidden lg:col-span-2`}>
              <div className="px-4 py-3 text-[12px] font-extrabold text-slate-600 dark:text-slate-300 border-b border-slate-100 dark:border-slate-800 flex items-center gap-1.5">
                🥐 نسبة الهالك الأسبوعية <span className="text-[10px] font-normal text-slate-400">— سد فجوة مخبز وحلويات (نمط BakeSmart/Fournil: أقل من 5٪ ممتاز، 5-10٪ مقبول، أكثر من 10٪ إنتاج زائد)</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-0 md:divide-x md:divide-x-reverse divide-slate-100 dark:divide-slate-800">
                <div>
                  <div className="px-4 pt-3 pb-1 text-[11px] font-bold text-slate-500">الهالك مقابل تكلفة المبيعات حسب أسبوع ISO</div>
                  {wastageRatio.length === 0 ? (
                    <div className="text-center text-slate-400 text-[12px] py-6">لا هالك مسجَّل بعد</div>
                  ) : (
                    <div className="max-h-72 overflow-y-auto">
                      <table className="w-full text-[12px]">
                        <thead>
                          <tr className="text-slate-400 text-[10.5px] border-b border-slate-100 dark:border-slate-800">
                            <th className="px-4 py-2 text-right font-bold">الأسبوع</th>
                            <th className="px-4 py-2 text-right font-bold">هالك</th>
                            <th className="px-4 py-2 text-right font-bold">تكلفة مبيعات</th>
                            <th className="px-4 py-2 text-right font-bold">النسبة</th>
                          </tr>
                        </thead>
                        <tbody>
                          {wastageRatio.map((r) => (
                            <tr key={r.period} className="border-b border-slate-50 dark:border-slate-800/50">
                              <td className="px-4 py-2 text-slate-400 text-[11px]" dir="ltr">{r.period}</td>
                              <td className="px-4 py-2 text-rose-500">{fmt(r.wastageCostMinor)}</td>
                              <td className="px-4 py-2 text-slate-400 text-[11px]">{fmt(r.salesCogsMinor)}</td>
                              <td className={`px-4 py-2 font-black ${r.ratioPercent == null ? 'text-slate-300' : r.ratioPercent > 10 ? 'text-rose-600' : r.ratioPercent > 5 ? 'text-amber-600' : 'text-emerald-600'}`}>{r.ratioPercent == null ? '—' : `${r.ratioPercent}٪`}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
                <div>
                  <div className="px-4 pt-3 pb-1 text-[11px] font-bold text-slate-500">أكثر الأصناف هالكاً (الإجمالي الكلي)</div>
                  {wastageByItem.length === 0 ? (
                    <div className="text-center text-slate-400 text-[12px] py-6">لا هالك مسجَّل بعد</div>
                  ) : (
                    <div className="max-h-72 overflow-y-auto">
                      <table className="w-full text-[12px]">
                        <thead>
                          <tr className="text-slate-400 text-[10.5px] border-b border-slate-100 dark:border-slate-800">
                            <th className="px-4 py-2 text-right font-bold">الصنف</th>
                            <th className="px-4 py-2 text-right font-bold">مستندات</th>
                            <th className="px-4 py-2 text-right font-bold">الكمية</th>
                            <th className="px-4 py-2 text-right font-bold">القيمة</th>
                          </tr>
                        </thead>
                        <tbody>
                          {wastageByItem.map((r) => (
                            <tr key={r.itemId} className="border-b border-slate-50 dark:border-slate-800/50">
                              <td className="px-4 py-2 font-bold text-slate-700 dark:text-slate-200">{r.nameAr}</td>
                              <td className="px-4 py-2 text-slate-400 text-[11px]">{r.docsCount}</td>
                              <td className="px-4 py-2 text-slate-400 text-[11px]">{r.totalQty}</td>
                              <td className="px-4 py-2 font-black text-rose-600">{fmt(r.totalCostMinor)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
          <div className={`${card} overflow-hidden`}>
            <div className="px-4 py-3 text-[12px] font-extrabold text-slate-600 dark:text-slate-300 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <span className="flex items-center gap-1.5"><Boxes size={14} className="text-emerald-500" /> قيمة المخزون (بالتكلفة)</span>
              <b className="text-emerald-600">{fmt(invValue.totalMinor)} {cur.symbol}</b>
            </div>
            {invValue.rows.length === 0 ? (
              <div className="text-center text-slate-400 text-[12px] py-8">المخزون فارغ</div>
            ) : (
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-[12.5px]">
                  <tbody>
                    {invValue.rows.map((r) => (
                      <tr key={r.itemId} className="border-b border-slate-50 dark:border-slate-800/50">
                        <td className="px-4 py-2 font-bold text-slate-700 dark:text-slate-200">{r.nameAr}</td>
                        <td className="px-4 py-2 text-slate-400 text-[11px]">{r.stockQty} × {fmt(r.costMinor)}</td>
                        <td className="px-4 py-2 font-bold text-left">{fmt(r.valueMinor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
      {tab === 'expenses' && (
        <div className="anim-up space-y-3">
          {/* فلترة محترفة: بند + مصدر + الفترة أعلى الصفحة */}
          <div className={`${card} p-4 flex flex-wrap items-end gap-3`}>
            <div className="min-w-52">
              <div className="text-[10px] font-bold text-slate-400 mb-1">بند المصروف</div>
              <QuickSelect value={expAccount} onChange={(e) => setExpAccount(e.target.value)} className={inputCls}>
                <option value="">— كل البنود (تقرير مجمّع) —</option>
                {expSummary.rows.map((r) => <option key={r.accountCode} value={r.accountCode}>{r.accountCode} — {r.accountName}</option>)}
              </QuickSelect>
            </div>
            <div className="min-w-44">
              <div className="text-[10px] font-bold text-slate-400 mb-1">مصدر العملية</div>
              <QuickSelect value={expSource} onChange={(e) => setExpSource(e.target.value)} className={inputCls}>
                <option value="">الكل</option>
                {expSources.map((st) => <option key={st} value={st}>{EXP_SOURCE_LABELS[st] ?? st}</option>)}
              </QuickSelect>
            </div>
            <div className="ms-auto flex items-center gap-3">
              <div className="text-left">
                <div className="text-[10px] font-bold text-slate-400">إجمالي مصروفات الفترة</div>
                <div className="font-black text-lg text-rose-500">{fmt(expSummary.grandTotalMinor)} {cur.symbol}</div>
              </div>
              <button onClick={exportExpenses} className="px-3 py-2 rounded-xl text-[12px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-emerald-600 transition-all">Excel/CSV</button>
              <button onClick={printExpenses} className="px-3 py-2 rounded-xl text-[12px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-sky-600 transition-all flex items-center gap-1.5">
                <Printer size={13} /> طباعة التقرير
              </button>
            </div>
          </div>

          {!expAccount ? (
            /* المجمّع: بند بند بنسبته وشريطه */
            <div className={`${card} overflow-hidden`}>
              {expSummary.rows.length === 0 ? (
                <div className="text-center text-slate-400 text-[12px] py-10">لا مصروفات في هذه الفترة</div>
              ) : (
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-right text-[11px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                      <th className="px-4 py-3 font-bold">البند</th>
                      <th className="px-4 py-3 font-bold">الحركات</th>
                      <th className="px-4 py-3 font-bold w-1/3">النسبة</th>
                      <th className="px-4 py-3 font-bold">الإجمالي</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expSummary.rows.map((r) => (
                      <tr key={r.accountCode} onClick={() => setExpAccount(r.accountCode)} className="border-b border-slate-50 dark:border-slate-800/50 hover:bg-rose-500/[0.03] transition-colors cursor-pointer">
                        <td className="px-4 py-3">
                          <span className="font-bold text-slate-700 dark:text-slate-200">{r.accountName}</span>
                          <span className="text-[10px] text-slate-400 font-mono ms-2" dir="ltr">{r.accountCode}</span>
                        </td>
                        <td className="px-4 py-3 text-slate-500">{r.txCount}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                              <div className="h-full rounded-full bg-rose-400" style={{ width: `${Math.min(100, r.sharePercent)}%` }} />
                            </div>
                            <span className="text-[11px] font-bold text-slate-400 w-12" dir="ltr">{r.sharePercent}%</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 font-black text-rose-500">{fmt(r.totalMinor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ) : (
            /* التفصيلي: حركة حركة للبند المختار */
            <div className={`${card} overflow-hidden`}>
              <div className="px-4 py-3 flex items-center justify-between border-b border-slate-100 dark:border-slate-800">
                <div className="text-[12px] font-extrabold text-slate-600 dark:text-slate-300">تفصيلي «{accountName(expAccount)}» — {expDetail.rows.length} حركة</div>
                <button onClick={() => setExpAccount('')} className="text-[11px] font-bold text-sky-600 hover:underline">→ عودة للمجمّع</button>
              </div>
              {expDetail.rows.length === 0 ? (
                <div className="text-center text-slate-400 text-[12px] py-10">لا حركات على هذا البند في الفترة</div>
              ) : (
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="text-right text-[11px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                      <th className="px-4 py-2.5 font-bold">القيد</th>
                      <th className="px-4 py-2.5 font-bold">التاريخ</th>
                      <th className="px-4 py-2.5 font-bold">البيان</th>
                      <th className="px-4 py-2.5 font-bold">المصدر</th>
                      <th className="px-4 py-2.5 font-bold">المبلغ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expDetail.rows.map((r, i) => (
                      <tr key={`${r.entryId}-${i}`} className="border-b border-slate-50 dark:border-slate-800/50">
                        <td className="px-4 py-2.5 text-slate-400 font-mono text-[11px]" dir="ltr">#{r.entryNumber}</td>
                        <td className="px-4 py-2.5 text-slate-500" dir="ltr">{r.date}</td>
                        <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">{r.description}</td>
                        <td className="px-4 py-2.5"><span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 font-bold">{EXP_SOURCE_LABELS[r.sourceType] ?? r.sourceType}</span></td>
                        <td className={`px-4 py-2.5 font-black ${r.amountMinor >= 0 ? 'text-rose-500' : 'text-emerald-600'}`}>{fmt(r.amountMinor)}</td>
                      </tr>
                    ))}
                    <tr className="bg-slate-50 dark:bg-slate-900/40">
                      <td colSpan={4} className="px-4 py-2.5 font-black">إجمالي البند في الفترة</td>
                      <td className="px-4 py-2.5 font-black text-rose-500">{fmt(expDetail.totalMinor)}</td>
                    </tr>
                  </tbody>
                </table>
              )}
            </div>
          )}
          <div className={`${card} overflow-hidden`}>
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex justify-between">
              <div><b>تحليل مصروفات الفواتير حسب مركز التكلفة</b><div className="text-[10px] text-slate-400">المدفوع والمستحق المرتبطان بالفاتورة والربحية</div></div>
              <div className="flex gap-2 items-center"><QuickSelect className={inputCls} value={costCenter} onChange={(e) => setCostCenter(e.target.value)}><option value="all">كل المراكز العامة</option><option value="none">بدون مركز عام</option>{costCenters.map((center) => <option key={center.id} value={center.id}>{center.code} — {center.nameAr}</option>)}</QuickSelect><QuickSelect className={inputCls} value={costProject} onChange={(e) => setCostProject(e.target.value)}><option value="all">كل المشاريع</option><option value="none">بدون مشروع</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.nameAr}</option>)}</QuickSelect><QuickSelect className={inputCls} value={costSettlement} onChange={(e) => setCostSettlement(e.target.value as typeof costSettlement)}><option value="all">كل الحالات</option><option value="paid_now">مدفوع</option><option value="payable_later">مستحق</option></QuickSelect><button className="px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-bold" onClick={printCostCenterExpenses}><Printer size={13} className="inline me-1"/>طباعة</button><button className="px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-bold" onClick={() => { const csv = costCenterExpensesCsv(costCenterExpenses.rows, (id) => id == null ? 'بدون مشروع' : projects.find((project) => project.id === id)?.nameAr ?? `مشروع #${id}`, (id) => id == null ? 'بدون مركز عام' : costCenters.find((center) => center.id === id)?.nameAr ?? `مركز #${id}`); const url = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = 'cost-center-expenses.csv'; link.click(); URL.revokeObjectURL(url) }}>Excel/CSV</button><b className="text-rose-500">{fmt(costCenterExpenses.totalMinor)}</b></div>
            </div>
            {costCenterExpenses.rows.length ? <table className="w-full text-[12.5px]"><thead><tr className="text-right text-slate-400 border-b"><th className="px-4 py-2">المركز العام</th><th>المشروع</th><th>الحركات</th><th>مدفوع</th><th>مستحق</th><th>الإجمالي</th></tr></thead><tbody>{costCenterExpenses.rows.map((row) => <tr key={`${row.costCenterId ?? 'none'}:${row.projectId ?? 'none'}`} className="border-b border-slate-50 dark:border-slate-800/50"><td className="px-4 py-2 font-bold">{(row.costCenterId ?? null) == null ? 'بدون مركز عام' : costCenters.find((center) => center.id === row.costCenterId)?.nameAr ?? `مركز #${row.costCenterId}`}</td><td>{row.projectId == null ? '—' : projects.find((project) => project.id === row.projectId)?.nameAr ?? `مشروع #${row.projectId}`}</td><td>{row.txCount}</td><td className="text-emerald-600">{fmt(row.paidMinor)}</td><td className="text-amber-600">{fmt(row.accruedMinor)}</td><td className="font-black text-rose-500">{fmt(row.totalMinor)}</td></tr>)}</tbody></table> : <div className="text-center text-slate-400 text-xs py-6">لا توجد مصروفات فواتير مرتبطة بالفترة</div>}
          </div>
          <div className={`${card} overflow-hidden`}>
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center"><div><b>قيود المصروفات الموسومة بالمراكز العامة</b><div className="text-[10px] text-slate-400">يشمل القيود المرحّلة من المصروفات والأنشطة خارج الفواتير</div></div><b className="text-rose-500">{fmt(journalCostCenterExpenses.totalMinor)}</b></div>
            {journalCostCenterExpenses.rows.length ? <table className="w-full text-[12px]"><thead><tr className="text-right text-slate-400 border-b"><th className="px-4 py-2">المركز العام</th><th>الحساب</th><th>الحركات</th><th>الإجمالي</th></tr></thead><tbody>{journalCostCenterExpenses.rows.map((row) => <tr key={`${row.costCenterId}:${row.accountCode}`} className="border-b border-slate-50 dark:border-slate-800/50"><td className="px-4 py-2 font-bold">{costCenters.find((center) => center.id === row.costCenterId)?.nameAr ?? `مركز #${row.costCenterId}`}</td><td className="font-mono">{row.accountCode}</td><td>{row.txCount}</td><td className="font-black text-rose-500">{fmt(row.totalMinor)}</td></tr>)}</tbody></table> : <div className="text-center text-slate-400 text-xs py-6">لا توجد قيود موسومة بمركز عام في الفترة</div>}
          </div>
          <div className={`${card} overflow-hidden`}>
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800"><b>موازنة المركز مقابل الفعلي</b><div className="text-[10px] text-slate-400">المصروف الفعلي مأخوذ من سطور القيود الموسومة بالمركز ضمن الفترة المحددة</div></div>
            {costCenterBudgetsReport.length ? <table className="w-full text-[12px]"><thead><tr className="text-right text-slate-400 border-b"><th className="px-4 py-2">المركز</th><th>الفترة</th><th>الموازنة</th><th>الفعلي</th><th>الانحراف</th><th>الاستخدام</th></tr></thead><tbody>{costCenterBudgetsReport.map((row) => <tr key={row.id} className="border-b border-slate-50 dark:border-slate-800/50"><td className="px-4 py-2 font-bold">{costCenters.find(center => center.id === row.costCenterId)?.nameAr ?? `مركز #${row.costCenterId}`}</td><td>{row.from} → {row.to}</td><td>{fmt(row.amountMinor)}</td><td className="text-rose-500">{fmt(row.actualMinor)}</td><td className={row.varianceMinor < 0 ? 'text-rose-500 font-black' : 'text-emerald-600 font-black'}>{fmt(row.varianceMinor)}</td><td>{row.utilizationPercent}%</td></tr>)}</tbody></table> : <div className="text-center text-slate-400 text-xs py-6">لا توجد موازنات للمراكز في الفترة</div>}
          </div>
          <div className={`${card} overflow-hidden`}>
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800"><b>المرتجعات المرتبطة بالمراكز العامة</b><div className="text-[10px] text-slate-400">ارتباط المستند المرتجع بالمراكز الموروثة من الفاتورة، منفصل عن إجمالي المصروفات</div></div>
            {costCenterReturns.length ? <table className="w-full text-[12px]"><thead><tr className="text-right text-slate-400 border-b"><th className="px-4 py-2">المركز</th><th>النوع</th><th>الحركات</th><th>قيمة المرتجع</th></tr></thead><tbody>{costCenterReturns.map((row) => <tr key={`${row.costCenterId}:${row.kind}`} className="border-b border-slate-50 dark:border-slate-800/50"><td className="px-4 py-2 font-bold">{costCenters.find(center => center.id === row.costCenterId)?.nameAr ?? `مركز #${row.costCenterId}`}</td><td>{row.kind === 'sale_return' ? 'مرتجع بيع' : 'مرتجع شراء'}</td><td>{row.txCount}</td><td className="font-black text-amber-600">{fmt(row.totalMinor)}</td></tr>)}</tbody></table> : <div className="text-center text-slate-400 text-xs py-6">لا توجد مرتجعات مرتبطة بمراكز في الفترة</div>}
          </div>
          <div className={`${card} overflow-hidden`}>
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center"><div><b>تحليل أنواع مصروفات الفواتير</b><div className="text-[10px] text-slate-400">يشمل العمولات والضريبة وحالة السداد وعدد مراكز التكلفة</div></div><div className="flex gap-2 items-center"><span className="text-xs text-slate-500">ضريبة {fmt(expenseCategories.taxMinor)}</span><button className="px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-bold" onClick={printExpenseCategories}><Printer size={13} className="inline me-1"/>طباعة</button><button className="px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-bold" onClick={() => { const csv = invoiceExpenseCategoriesCsv(expenseCategories.rows); const url = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = 'invoice-expense-categories.csv'; link.click(); URL.revokeObjectURL(url) }}>Excel/CSV</button><b className="text-rose-500">{fmt(expenseCategories.totalMinor)}</b></div></div>
            {expenseCategories.rows.length ? <table className="w-full text-[12px]"><thead><tr className="text-right text-slate-400 border-b"><th className="px-4 py-2">النوع</th><th>الحساب</th><th>الحركات</th><th>المراكز</th><th>مدفوع</th><th>مستحق</th><th>الضريبة</th><th>الإجمالي</th></tr></thead><tbody>{expenseCategories.rows.map((row) => <tr key={`${row.accountCode}:${row.label}`} className="border-b border-slate-50 dark:border-slate-800/50"><td className="px-4 py-2 font-bold">{row.label}</td><td className="font-mono">{row.accountCode}</td><td>{row.txCount}</td><td>{row.costCenterCount}</td><td className="text-emerald-600">{fmt(row.paidMinor)}</td><td className="text-amber-600">{fmt(row.accruedMinor)}</td><td>{fmt(row.taxMinor)}</td><td className="font-black text-rose-500">{fmt(row.totalMinor)}</td></tr>)}</tbody></table> : <div className="text-center text-slate-400 text-xs py-6">لا توجد أنواع مصروفات في الفترة</div>}
          </div>
        </div>
      )}

      {tab === 'financial' && (
        <FinancialReportsTab period={period} cur={cur} companyName={setup.shopName || 'المنشأة'} />
      )}
      {tab === 'currencies' && (
        <FxTreasuryTab cur={cur} companyName={setup.shopName || 'المنشأة'} />
      )}

    </div>
  )
}

/**
 * مرجع سعر السوق اليومي (سد فجوة مستقبلية — تقرير النشاط #2: تجارة الأعلاف
 * والحبوب): إدخال يدوي سريع لسعر سلعة (ذرة/صويا/دريس...) من نشرة السوق
 * اليومية، لمساعدة المالك على ضبط سعر اليوم أول الصباح — استرشادي بحت،
 * لا يُغيّر سعر أي صنف تلقائياً. بديل خفيف عن تكامل بورصة حبوب كامل.
 */
function MarketPriceReferenceCard({ card }: { card: string }) {
  const { marketPrices, addMarketPrice, deleteMarketPrice } = useDataStore()
  const { setup } = useAppStore()
  const cur = useMemo(() => (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }, [setup.countryCode])
  const [commodityName, setCommodityName] = useState('')
  const [unit, setUnit] = useState('طن')
  const [price, setPrice] = useState('')
  const [date, setDate] = useState(() => todayLocalIso())
  const [error, setError] = useState('')
  const sorted = useMemo(() => [...marketPrices].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id)), [marketPrices])
  const submit = () => {
    try {
      addMarketPrice({ date, commodityName, unit, pricePerUnitMinor: Math.round((Number(price) || 0) * 10 ** cur.decimals) })
      setCommodityName(''); setPrice(''); setError('')
    } catch (e) { setError((e as Error).message) }
  }
  return (
    <div className={`${card} overflow-hidden`}>
      <div className="px-4 py-3 text-[12px] font-extrabold text-slate-600 dark:text-slate-300 border-b border-slate-100 dark:border-slate-800 flex items-center gap-1.5">
        📈 مرجع سعر السوق اليومي <span className="text-[10px] font-normal text-slate-400">— إدخال يدوي استرشادي، لا يُغيّر أسعار الأصناف تلقائياً</span>
      </div>
      <div className="p-3 flex flex-wrap gap-2 items-end border-b border-slate-100 dark:border-slate-800">
        <input value={commodityName} onChange={(e) => setCommodityName(e.target.value)} placeholder="اسم السلعة (مثال: ذرة صفراء)" className={inputCls} />
        <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="الوحدة" className={`${inputCls} !w-20`} />
        <input value={price} onChange={(e) => setPrice(e.target.value)} type="number" inputMode="decimal" step="any" min={0} placeholder={`السعر (${cur.symbol})`} className={`${inputCls} !w-32`} dir="ltr" />
        <input value={date} onChange={(e) => setDate(e.target.value)} type="date" className={`${inputCls} !w-40`} dir="ltr" />
        <button onClick={submit} disabled={!commodityName.trim() || !(Number(price) > 0)} className="px-3 py-2 rounded-xl bg-emerald-500/10 text-emerald-600 text-[12px] font-bold disabled:opacity-40">+ تسجيل</button>
        {error && <span className="text-[11px] text-rose-500 font-bold">{error}</span>}
      </div>
      {sorted.length === 0 ? (
        <div className="text-center text-slate-400 text-[12px] py-6">لا أسعار سوق مسجَّلة بعد</div>
      ) : (
        <div className="max-h-56 overflow-y-auto">
          <table className="w-full text-[12.5px]">
            <tbody>
              {sorted.slice(0, 30).map((entry) => (
                <tr key={entry.id} className="border-b border-slate-50 dark:border-slate-800/50">
                  <td className="px-4 py-2 text-slate-400 text-[11px]" dir="ltr">{entry.date}</td>
                  <td className="px-4 py-2 font-bold text-slate-700 dark:text-slate-200">{entry.commodityName}</td>
                  <td className="px-4 py-2 font-black text-emerald-600">{formatMinor(entry.pricePerUnitMinor, cur, false)} {cur.symbol} / {entry.unit}</td>
                  <td className="px-4 py-2 text-left"><button onClick={() => deleteMarketPrice(entry.id)} className="text-[10px] text-rose-400 hover:text-rose-600">حذف</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
