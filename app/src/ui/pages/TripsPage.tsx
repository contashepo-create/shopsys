import { PartyQuickPicker, QuickSelect } from '../components/KeyboardPickers.tsx'
/**
 * النقلات ومصاريف النقلات (المرحلة 6 — القرار 13):
 * - فاتورة النقلة مبنية على أصناف خدمية من المخزن (بنود مثل فاتورة البيع: الصنف الخدمي × عدد النقلات × سعر النقلة = الإجمالي)
 * - مربعات أرقام الحاويات تحت كل سطر نقلة بحد أقصى عدد النقلات بالسطر
 * - خيار الضريبة (Checkbox) مفعّل تلقائياً إذا كانت الضريبة مفعّلة في إعدادات الشركة
 * - مرفقات الفاتورة + تعديل النقلة بعد تسجيلها + طباعة فاتورة بيع احترافية للعميل (بلا مصاريف داخلية ولا ربح/خسارة)
 * - قسم منفصل «مصاريف النقلات» لتسجيل المصاريف الداخلية (على الشركة 5106) والمصاريف المحمّلة على العميل (1104)
 */
import { useMemo, useState } from 'react'
import { Plus, Route, Eye, BookOpenText, Trash2, TrendingUp, Container, Printer, Pencil, FileText, Coins, RotateCcw } from 'lucide-react'
import { useDataStore, EMPTY_EXTENDED, type Trip } from '../../data/repo.ts'
import { ServiceRefundBox } from '../components/ServiceRefundBox.tsx'
import { DocumentAttachmentsBox, type PendingAttachment } from '../components/DocumentAttachments.tsx'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import {
  computeTripTotals, tripProfitReport, EXPENSE_SOURCE_LABELS,
  TRIP_EXPENSE_BEARER_LABELS, TRIP_EXPENSE_PAYMENT_LABELS,
  type TripServiceLine, type TripExpenseBearer, type TripExpensePaymentSource, type TripExpenseRecord,
} from '../../core/logistics.ts'
import { isDriverEmployee } from '../../core/jobTitles.ts'
import { summarizeCustody } from '../../core/custody.ts'
import { periodPresets, type Period } from '../../core/reports.ts'
import { buildReceiptModel } from '../../core/receipt.ts'
import { printModelWithTemplate, buildModelHtml } from '../print/printDoc.ts'
import { openPrintPreview } from '../components/printPreviewStore.ts'
import { useTaxBarcodeStamp } from '../hooks/useTaxBarcodeStamp.ts'
import { Btn, Field, inputCls, Modal, useToast, EmptyState } from '../components/ui.tsx'
import { usePersistedSectionView } from '../components/SectionViewPreference.ts'
import { useSupervisorApproval } from '../components/SupervisorPinDialog.tsx'
import { CreditLimitError } from '../../core/pos.ts'
import { TreasuryPicker } from '../components/TreasuryPicker.tsx'
import { ACCOUNT_NAMES } from './accountNames.ts'
import { renderWaybillHtml } from '../print/printWaybill.ts'
import { printHtml } from '../print/printReceipt.ts'
import { eligiblePaymentTerminals } from '../../core/paymentTerminalEligibility.ts'
import { DocSectionHead, DocOutcome } from '../components/DocSection.tsx'
import { todayLocalIso } from '../../core/time.ts'

interface DraftTripLine {
  key: string
  itemId: number | null
  serviceNameAr: string
  fromLoc: string
  toLoc: string
  qty: string
  unitPrice: string
  containers: string[]
}

const makeEmptyLine = (): DraftTripLine => ({
  key: crypto.randomUUID(),
  itemId: null,
  serviceNameAr: '',
  fromLoc: '',
  toLoc: '',
  qty: '1',
  unitPrice: '',
  containers: [],
})

export function TripsPage() {
  const {
    trips, tripExpenses, vehicles, employees, customers, items, journal,
    paymentTerminals, appUsers, currentUserId,
    postTrip, updateTrip, refundTrip, driverDues, getDriverDueBalance, settleDriverDues,
    ensureServiceItemForFreeLine, addEmployee, addDocumentFile,
  } = useDataStore()
  const { setup, receipt } = useAppStore()
  const toast = useToast()
  /* فاتورة النقل للعميل مستند بيع ضريبي — رمز زاتكا عند تفعيله */
  const stampTax = useTaxBarcodeStamp()
  const cur = useMemo(
    () => (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' },
    [setup.countryCode],
  )
  const fmt = (m: number) => formatMinor(m, cur, false)
  const custName = (id: number | null) => (id == null ? 'عميل نقدي' : customers.find((c) => c.id === id)?.nameAr ?? '—')
  const vehName = (id: number | null) => (id == null ? '—' : vehicles.find((v) => v.id === id)?.plateNumber ?? '—')
  const drvName = (id: number | null) => (id == null ? '—' : employees.find((e) => e.id === id)?.nameAr ?? '—')

  // الأصناف الخدمية في المخزن (أو كل الأصناف النشطة مع تقديم الخدمية أولاً)
  const serviceItems = useMemo(
    () => [...items.filter((it) => it.isActive !== false)].sort((a, b) => Number(Boolean(b.isService)) - Number(Boolean(a.isService))),
    [items],
  )
  const activeDrivers = useMemo(
    () => [...employees.filter((e) => e.active)].sort((a, b) => Number(isDriverEmployee(b)) - Number(isDriverEmployee(a))),
    [employees],
  )

  /** طباعة بوليصة النقل (تسافر مع السائق — بلا تكلفة ولا ربح) */
  const printWaybill = (t: Trip) => {
    const veh = vehicles.find((v) => v.id === t.vehicleId)
    const drv = employees.find((e) => e.id === t.driverId)
    printHtml(renderWaybillHtml({
      shopName: setup.shopName || 'نقل ولوجستيات',
      tripNumber: t.tripNumber,
      dateIso: t.date,
      customerName: custName(t.customerId),
      fromLoc: t.fromLoc,
      toLoc: t.toLoc,
      vehiclePlate: veh?.plateNumber ?? '',
      vehicleType: veh?.vehicleType ?? '',
      driverName: drv?.nameAr ?? '',
      containerNumbers: t.containerNumbers,
      qty: t.qty,
      unitPrice: `${fmt(t.unitPriceMinor)} ${cur.symbol}`,
      freightTotal: `${fmt(t.totals.baseMinor)} ${cur.symbol}`,
      customerExpenses: t.expenses.filter((e) => e.source === 'customer').map((e) => ({ nameAr: e.nameAr, amount: `${fmt(e.amountMinor)} ${cur.symbol}` })),
      grandTotal: `${fmt(t.totals.grandMinor)} ${cur.symbol}`,
      payment: t.payment,
      notes: t.notes,
    }))
  }

  /**
   * طباعة فاتورة بيع احترافية للعميل من النقلة:
   * تتبع قالب الفواتير المعتمد في الإعدادات (A4 / A5 / حراري) وتحتوي على كل تفاصيل النقلة
   * وبنود الخدمة وأرقام الحاويات والمصاريف المحمّلة على العميل فقط،
   * وتخلو تماماً من المصاريف الداخلية المحمّلة على الشركة ومن الأرباح والخسائر.
   */
  const printCustomerInvoice = (t: Trip) => {
    const veh = vehicles.find((v) => v.id === t.vehicleId)
    const drv = employees.find((e) => e.id === t.driverId)
    const cust = t.customerId ? customers.find((c) => c.id === t.customerId) : undefined
    const tripLines = t.lines && t.lines.length > 0
      ? t.lines
      : [{
          itemId: null,
          serviceNameAr: `خدمة نقل: ${t.fromLoc} ← ${t.toLoc}`,
          fromLoc: t.fromLoc,
          toLoc: t.toLoc,
          qty: t.qty,
          unitPriceMinor: t.unitPriceMinor,
          containerNumbers: t.containerNumbers,
        }]
    const customerBorneExpenses = t.expenses.filter((e) => e.source === 'customer')
    /* مصاريف عُوملت على العميل بقيد مستقل (TRE-XXXX): تدخل إجمالي الفاتورة
       لأنها دين على العميل في 1104 — فتُعرض سطوراً بنسبة ضريبة صفر حتى لا
       يخرج الإجمالي أكبر من مجموع السطور + الضريبة. */
    const standaloneExpenseRecords = tripExpenses
      .filter((x) => x.tripId === t.id && !x.reversedByEntryId && x.bearer === 'customer')
    const customerStandaloneMinor = standaloneExpenseRecords.reduce((s, x) => s + x.amountMinor, 0)
    const invoiceLines = [
      ...tripLines.map((line, idx) => {
        const routeNote = line.fromLoc && line.toLoc ? `المسار: ${line.fromLoc} ← ${line.toLoc}` : ''
        const containersNote = line.containerNumbers?.length ? `الحاويات: ${line.containerNumbers.join(' ، ')}` : ''
        const metaNote = [routeNote, containersNote].filter(Boolean).join(' | ')
        return {
          itemId: line.itemId ?? -(idx + 1),
          nameAr: line.serviceNameAr || `نقل ${line.fromLoc} ← ${line.toLoc}`,
          qty: line.qty,
          unitPriceMinor: line.unitPriceMinor,
          unitCostMinor: 0, // لا تكلفة داخلية في فاتورة العميل
          discountPercent: 0,
          soldByWeight: false,
          notes: metaNote || undefined,
        }
      }),
      ...customerBorneExpenses.map((exp, idx) => ({
        itemId: -(1000 + idx),
        nameAr: `${exp.nameAr} (مصروف على حساب العميل)`,
        qty: exp.qty,
        unitPriceMinor: exp.unitAmountMinor,
        unitCostMinor: 0,
        discountPercent: 0,
        soldByWeight: false,
      })),
      ...standaloneExpenseRecords.map((exp, idx) => ({
        itemId: -(2000 + idx),
        nameAr: `${exp.nameAr} (على حساب العميل — ${exp.expenseNumber})`,
        qty: 1,
        unitPriceMinor: exp.amountMinor,
        unitCostMinor: 0,
        discountPercent: 0,
        soldByWeight: false,
        vatPercentOverride: 0,
      })),
    ]
    const subtotalMinor = t.totals.baseMinor + customerBorneExpenses.reduce((s, e) => s + e.amountMinor, 0)
    const taxMinor = t.totals.vatMinor
    const totalMinor = t.totals.grandMinor + customerStandaloneMinor
    const paidMinor = t.paidMinor ?? (t.payment === 'cash' ? t.totals.grandMinor : 0)
    const extraContext = [
      veh ? `المركبة: ${veh.plateNumber} (${veh.vehicleType})` : '',
      drv ? `السائق: ${drv.nameAr}` : '',
      t.notes ? `ملاحظات: ${t.notes}` : '',
    ].filter(Boolean).join(' — ')

    const buildNow = () => {
      const st = useAppStore.getState()
      const model = buildReceiptModel({
        invoiceNumber: t.tripNumber,
        refCode: t.tripNumber,
        dateIso: t.date,
        lines: invoiceLines,
        totals: {
          grossMinor: subtotalMinor,
          discountMinor: 0,
          netMinor: subtotalMinor,
          taxBaseMinor: subtotalMinor,
          taxMinor,
          totalMinor,
          cogsMinor: 0,
        },
        payment: t.payment,
        paidMinor,
        operatorName: st.setup.ownerName || 'المالك',
        customerName: cust ? `${cust.nameAr}${extraContext ? ` (${extraContext})` : ''}` : `عميل نقدي${extraContext ? ` (${extraContext})` : ''}`,
        taxPercent: t.vatPercent,
        taxInclusive: false,
        settings: st.receipt,
      })
      stampTax(model, { dateIso: t.date, invoiceNumber: t.tripNumber, totalMinor, taxMinor })
      return model
    }
    const tpl = receipt.defaultTemplate || 'a4'
    const model = buildNow()
    openPrintPreview({
      title: `فاتورة نقل للعميل ${t.tripNumber}`,
      html: buildModelHtml(model, cur, receipt, tpl),
      wide: tpl !== 'thermal',
      rebuild: () => {
        const st = useAppStore.getState()
        const curTpl = st.receipt.defaultTemplate || tpl
        return buildModelHtml(buildNow(), cur, st.receipt, curTpl)
      },
    })
    printModelWithTemplate(model, cur, receipt, tpl)
  }

  const [tab, setTab] = usePersistedSectionView('trips', 'list', ['list', 'profit'] as const)

  /* ─── تسجيل أو تعديل فاتورة نقلة ─── */
  const [open, setOpen] = useState(false)
  const [editingTrip, setEditingTrip] = useState<Trip | null>(null)
  const [customerId, setCustomerId] = useState('')
  const [vehicleId, setVehicleId] = useState('')
  const [driverId, setDriverId] = useState('')
  const [driverCommission, setDriverCommission] = useState('')
  const [lines, setLines] = useState<DraftTripLine[]>(() => [makeEmptyLine()])
  const [payment, setPayment] = useState<'cash' | 'credit'>('credit')
  const [paidNow, setPaidNow] = useState('')
  const [treasury, setTreasury] = useState('1101')
  const [terminalId, setTerminalId] = useState('')
  const [terminalReference, setTerminalReference] = useState('')
  const [cardLast4, setCardLast4] = useState('')
  const availableTerminals = eligiblePaymentTerminals(paymentTerminals, appUsers.find((user) => user.id === currentUserId), 'charge')
  // تفعيل الضريبة تلقائياً إذا كانت الشركة مفعّلة الضريبة في الإعدادات العامة
  const defaultTaxOn = Boolean(setup.vatPercent > 0)
  const [withVat, setWithVat] = useState(defaultTaxOn)
  const [notes, setNotes] = useState('')
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])

  // إضافة خدمة نقل سريعة في المخزن أو سائق سريع في الموظفين
  const [quickSvcOpen, setQuickSvcOpen] = useState(false)
  const [quickSvcName, setQuickSvcName] = useState('')
  const [quickSvcPrice, setQuickSvcPrice] = useState('')
  const [quickDrvOpen, setQuickDrvOpen] = useState(false)
  const [quickDrvName, setQuickDrvName] = useState('')
  const [quickDrvPhone, setQuickDrvPhone] = useState('')

  const toM = (s: string) => (s.trim() ? toMinor(s, cur.decimals) : 0)

  const openNew = () => {
    setEditingTrip(null)
    setCustomerId('')
    setVehicleId('')
    setDriverId('')
    setDriverCommission('')
    setLines([makeEmptyLine()])
    setPayment('cash')
    setPaidNow('')
    setWithVat(Boolean(setup.vatPercent > 0))
    setNotes('')
    setAttachments([])
    setTerminalId('')
    setTerminalReference('')
    setCardLast4('')
    setOpen(true)
  }

  const openEdit = (t: Trip) => {
    setEditingTrip(t)
    setCustomerId(t.customerId ? String(t.customerId) : '')
    setVehicleId(t.vehicleId ? String(t.vehicleId) : '')
    setDriverId(t.driverId ? String(t.driverId) : '')
    const existingDue = driverDues.find((d) => d.tripId === t.id && !d.settled)
    setDriverCommission(existingDue ? String(existingDue.amountMinor / 10 ** cur.decimals) : '')
    if (t.lines && t.lines.length > 0) {
      setLines(t.lines.map((l) => ({
        key: crypto.randomUUID(),
        itemId: l.itemId ?? null,
        serviceNameAr: l.serviceNameAr,
        fromLoc: l.fromLoc ?? '',
        toLoc: l.toLoc ?? '',
        qty: String(l.qty),
        unitPrice: String(l.unitPriceMinor / 10 ** cur.decimals),
        containers: [...(l.containerNumbers ?? [])],
      })))
    } else {
      setLines([{
        key: crypto.randomUUID(),
        itemId: null,
        serviceNameAr: `${t.fromLoc} ← ${t.toLoc}`,
        fromLoc: t.fromLoc,
        toLoc: t.toLoc,
        qty: String(t.qty),
        unitPrice: String(t.unitPriceMinor / 10 ** cur.decimals),
        containers: [...t.containerNumbers],
      }])
    }
    setPayment(t.payment)
    setPaidNow(t.paidMinor != null ? String(t.paidMinor / 10 ** cur.decimals) : '')
    setWithVat(t.vatPercent > 0)
    setNotes(t.notes)
    setAttachments([])
    setOpen(true)
  }

  const pickVehicle = (v: string) => {
    setVehicleId(v)
    const veh = vehicles.find((x) => x.id === Number(v))
    if (veh?.defaultDriverId) setDriverId(String(veh.defaultDriverId))
  }

  const patchLine = (key: string, patch: Partial<DraftTripLine>) => {
    setLines((prev) => prev.map((l) => {
      if (l.key !== key) return l
      const next = { ...l, ...patch }
      const maxC = Math.max(1, Math.floor(Number(next.qty) || 1))
      if (next.containers.length > maxC) {
        next.containers = next.containers.slice(0, maxC)
      }
      return next
    }))
  }

  const selectServiceItemForLine = (key: string, itemIdStr: string) => {
    const id = Number(itemIdStr) || null
    const found = id ? items.find((it) => it.id === id) : undefined
    if (!found) {
      patchLine(key, { itemId: null })
      return
    }
    patchLine(key, {
      itemId: found.id,
      serviceNameAr: found.nameAr,
      unitPrice: found.priceMinor > 0 ? String(found.priceMinor / 10 ** cur.decimals) : '',
    })
  }

  const addContainerBox = (key: string) => {
    setLines((prev) => prev.map((l) => {
      if (l.key !== key) return l
      const maxC = Math.max(1, Math.floor(Number(l.qty) || 1))
      if (l.containers.length >= maxC) return l
      return { ...l, containers: [...l.containers, ''] }
    }))
  }

  const updateContainerBox = (key: string, idx: number, val: string) => {
    setLines((prev) => prev.map((l) => {
      if (l.key !== key) return l
      return { ...l, containers: l.containers.map((c, i) => (i === idx ? val : c)) }
    }))
  }

  const removeContainerBox = (key: string, idx: number) => {
    setLines((prev) => prev.map((l) => {
      if (l.key !== key) return l
      return { ...l, containers: l.containers.filter((_, i) => i !== idx) }
    }))
  }

  const createQuickServiceItem = () => {
    if (!quickSvcName.trim()) return
    const priceMinor = toM(quickSvcPrice)
    const id = ensureServiceItemForFreeLine({ nameAr: quickSvcName.trim(), unitAr: 'نقلة', priceMinor })
    // ربط أول سطر فارغ بالخدمة الجديدة
    const targetKey = lines.find((l) => !l.serviceNameAr.trim())?.key ?? lines[0]?.key
    if (targetKey) {
      patchLine(targetKey, {
        itemId: id,
        serviceNameAr: quickSvcName.trim(),
        unitPrice: priceMinor > 0 ? String(priceMinor / 10 ** cur.decimals) : '',
      })
    }
    setQuickSvcName(''); setQuickSvcPrice(''); setQuickSvcOpen(false)
    toast.show(`سُجلت خدمة النقل «${quickSvcName.trim()}» كصنف خدمي في المخزن ✅`)
  }

  const createQuickDriver = () => {
    if (!quickDrvName.trim()) return
    addEmployee({
      ...EMPTY_EXTENDED,
      nameAr: quickDrvName.trim(),
      phone: quickDrvPhone.trim(),
      jobTitle: 'سائق نقل ثقيل',
      hireDate: todayLocalIso(),
      baseSalaryMinor: 0,
      allowancesMinor: 0,
      active: true,
      notes: 'سُجّل كسائق من فاتورة النقلة',
    })
    const newest = useDataStore.getState().employees.at(-1)
    if (newest) setDriverId(String(newest.id))
    setQuickDrvName(''); setQuickDrvPhone(''); setQuickDrvOpen(false)
    toast.show(`سُجّل السائق «${newest?.nameAr ?? ''}» في الموظفين واختير للنقلة ✅`)
  }

  const computedLines: TripServiceLine[] = useMemo(() => lines.map((l) => ({
    itemId: l.itemId,
    serviceNameAr: l.serviceNameAr.trim() || (l.fromLoc.trim() && l.toLoc.trim() ? `نقل من ${l.fromLoc.trim()} إلى ${l.toLoc.trim()}` : ''),
    fromLoc: l.fromLoc.trim(),
    toLoc: l.toLoc.trim(),
    qty: Math.max(1, Math.floor(Number(l.qty) || 0)),
    unitPriceMinor: toM(l.unitPrice),
    containerNumbers: l.containers.map((c) => c.trim()).filter(Boolean),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  })), [lines, cur.decimals])

  const draftInput = useMemo(() => {
    const first = computedLines[0]
    const totalQty = computedLines.reduce((s, l) => s + l.qty, 0)
    const totalBase = computedLines.reduce((s, l) => s + l.qty * l.unitPriceMinor, 0)
    return {
      fromLoc: first?.fromLoc || first?.serviceNameAr || '',
      toLoc: first?.toLoc || (computedLines.length > 1 ? `${computedLines.length} بنود نقل` : 'مقر العميل'),
      qty: totalQty || 1,
      unitPriceMinor: computedLines.length === 1 ? (first?.unitPriceMinor ?? 0) : Math.round(totalBase / Math.max(1, totalQty)),
      // لا يُسمح بتسجيل مصاريف من داخل فاتورة النقل — تُسجل من قسم «مصاريف النقلات» المستقل
      expenses: [],
      payment,
      vatPercent: withVat ? setup.vatPercent : 0,
      containerNumbers: computedLines.flatMap((l) => l.containerNumbers),
      lines: computedLines,
    }
  }, [computedLines, payment, withVat, setup.vatPercent])

  const draftTotals = useMemo(() => {
    try { return computeTripTotals(draftInput) } catch { return null }
  }, [draftInput])

  // نقلة آجلة فوق حد ائتمان العميل — تجاوز باعتماد مدير
  const creditApproval = useSupervisorApproval('sales.credit.override')
  const save = (creditLimitOverrideBy?: string) => {
    try {
      // ضمان تسجيل كل بند خدمة كصنف خدمي في المخزن تلقائياً
      const finalizedLines: TripServiceLine[] = computedLines.map((l) => {
        const nameAr = l.serviceNameAr || (l.fromLoc && l.toLoc ? `خدمة نقل: ${l.fromLoc} ← ${l.toLoc}` : '')
        const ensuredItemId = l.itemId ?? (nameAr ? ensureServiceItemForFreeLine({ nameAr, unitAr: 'نقلة', priceMinor: l.unitPriceMinor }) : null)
        return { ...l, itemId: ensuredItemId, serviceNameAr: nameAr }
      })
      const finalInput = { ...draftInput, lines: finalizedLines }
      const addedByName = appUsers.find((u) => u.id === currentUserId)?.nameAr ?? setup.ownerName ?? 'المالك'

      if (editingTrip) {
        const updated = updateTrip({
          tripId: editingTrip.id,
          customerId: customerId ? Number(customerId) : null,
          vehicleId: vehicleId ? Number(vehicleId) : null,
          driverId: driverId ? Number(driverId) : null,
          input: finalInput,
          notes: notes.trim(),
          treasury,
          paidMinor: paidNow.trim() ? toMinor(paidNow, cur.decimals) : undefined,
          driverCommissionMinor: driverCommission.trim() && driverId ? toMinor(driverCommission, cur.decimals) : 0,
          creditLimitOverrideBy: creditLimitOverrideBy ?? null,
        })
        for (const att of attachments) {
          addDocumentFile({ documentKind: 'trip', documentId: updated.id, name: att.name, mime: att.mime, dataUrl: att.dataUrl, addedBy: addedByName })
        }
        toast.show(`تم تعديل فاتورة النقلة ${updated.tripNumber} وتحديث قيدها المحاسبي ✅`)
        setOpen(false)
        return
      }

      const terminal = availableTerminals.find((row) => row.id === terminalId)
      const trip = postTrip({
        customerId: customerId ? Number(customerId) : null,
        vehicleId: vehicleId ? Number(vehicleId) : null,
        driverId: driverId ? Number(driverId) : null,
        input: finalInput,
        notes: notes.trim(),
        treasury: terminal?.settlementAccountCode ?? treasury,
        terminalPayment: terminal ? { terminalId: terminal.id, providerReference: terminalReference.trim(), cardLast4: cardLast4 || undefined } : undefined,
        paidMinor: paidNow.trim() ? toMinor(paidNow, cur.decimals) : undefined,
        driverCommissionMinor: driverCommission && driverId ? toMinor(driverCommission, cur.decimals) : 0,
        creditLimitOverrideBy: creditLimitOverrideBy ?? null,
      })
      for (const att of attachments) {
        addDocumentFile({ documentKind: 'trip', documentId: trip.id, name: att.name, mime: att.mime, dataUrl: att.dataUrl, addedBy: addedByName })
      }
      const due = trip.totals.grandMinor - (trip.paidMinor ?? (trip.payment === 'cash' ? trip.totals.grandMinor : 0))
      toast.show(`رُحّلت فاتورة النقلة ${trip.tripNumber}${due > 0 ? ` — متبقٍ على العميل ${fmt(due)}` : ''} ${cur.symbol} ✅`)
      setOpen(false)
    } catch (err) {
      if (err instanceof CreditLimitError) { creditApproval.request((by) => save(by ?? 'المشرف')); return }
      toast.show((err as Error).message, 'error')
    }
  }

  /* ─── عرض نقلة ─── */
  const [viewing, setViewing] = useState<Trip | null>(null)
  const viewEntry = viewing ? journal.find((e) => e.id === viewing.journalEntryId) : null

  /* ─── مستحقات السائقين ─── */
  const [settleTreasury, setSettleTreasury] = useState('1101')
  const driversWithDues = useMemo(() => {
    const ids = [...new Set(driverDues.filter((d) => !d.settled).map((d) => d.driverId))]
    return ids.map((id) => ({
      id,
      name: employees.find((e) => e.id === id)?.nameAr ?? 'سائق',
      balance: getDriverDueBalance(id),
      trips: driverDues.filter((d) => d.driverId === id && !d.settled).length,
    })).filter((d) => d.balance > 0)
  }, [driverDues, employees, getDriverDueBalance])
  const doSettleDriver = (id: number, name: string) => {
    try {
      const r = settleDriverDues(id, settleTreasury)
      toast.show(`سُويت مستحقات ${name}: ${fmt(r.total)} عن ${r.count} رحلة ✅`)
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  /* ─── تقرير الربحية ─── */
  const presets = useMemo(() => periodPresets(new Date().toISOString()), [])
  const [presetId, setPresetId] = useState('month')
  const period: Period = presets.find((p) => p.id === presetId)?.period ?? presets[2].period
  const profit = useMemo(() => tripProfitReport(trips, period), [trips, period])

  const listed = useMemo(() => [...trips].reverse(), [trips])
  const tabCls = (t: 'list' | 'profit') =>
    `px-4 py-2 rounded-xl text-[13px] font-bold transition-all ${tab === t ? 'bg-fuchsia-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'}`

  const canSave = computedLines.length > 0 && computedLines.every((l) => (l.serviceNameAr || (l.fromLoc && l.toLoc)) && l.qty >= 1 && l.unitPriceMinor > 0)

  return (
    <div className="space-y-4">
      <div className="anim-up flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <button onClick={() => setTab('list')} className={tabCls('list')}><Route size={14} className="inline -mt-0.5 me-1" /> فواتير النقلات ({trips.length})</button>
          <button onClick={() => setTab('profit')} className={tabCls('profit')}><TrendingUp size={14} className="inline -mt-0.5 me-1" /> ربحية النقلات</button>
          <a href="#/logistics/expenses" className="px-3.5 py-2 rounded-xl text-[12.5px] font-bold bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 transition-all">
            <Coins size={14} className="inline -mt-0.5 me-1" /> مصاريف النقلات ({tripExpenses.length})
          </a>
        </div>
        <Btn onClick={openNew}><span className="flex items-center gap-1.5"><Plus size={15} /> فاتورة نقلة جديدة</span></Btn>
      </div>

      {tab === 'list' && (
        listed.length === 0 ? (
          <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800">
            <EmptyState icon="🛣️" title="لا نقلات بعد" sub="سجّل فاتورة النقلة بأصناف خدمية من المخزن وأرقام الحاويات، وسجّل مصاريفها من قسم «مصاريف النقلات»" />
          </div>
        ) : (
          <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden" style={{ animationDelay: '60ms' }}>
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-slate-400 text-[11px] border-b border-slate-100 dark:border-slate-800">
                  <th className="px-4 py-3 text-right font-bold">النقلة / الفاتورة</th>
                  <th className="px-4 py-3 text-right font-bold">خدمة النقل / المسار</th>
                  <th className="px-4 py-3 text-right font-bold">العميل</th>
                  <th className="px-4 py-3 text-right font-bold">المركبة والسائق</th>
                  <th className="px-4 py-3 text-right font-bold">الإجمالي للعميل</th>
                  <th className="px-4 py-3 text-right font-bold">الربح الصافي</th>
                  <th className="px-4 py-3 text-left font-bold">إجراءات الفاتورة</th>
                </tr>
              </thead>
              <tbody>
                {listed.map((t) => (
                  <tr key={t.id} className="border-b border-slate-50 dark:border-slate-800/50 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-bold text-fuchsia-600">{t.tripNumber}</div>
                      <div className="text-[10px] text-slate-400" dir="ltr">{t.date.slice(0, 10)}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-700 dark:text-slate-200">
                        {t.lines && t.lines.length > 0
                          ? t.lines.map((l) => `${l.serviceNameAr}${l.qty > 1 ? ` (×${l.qty})` : ''}`).join(' + ')
                          : `${t.fromLoc} ← ${t.toLoc}${t.qty > 1 ? ` (×${t.qty})` : ''}`}
                      </div>
                      {t.containerNumbers.length > 0 && (
                        <div className="text-[10.5px] text-slate-400 font-mono mt-0.5" dir="ltr">
                          📦 {t.containerNumbers.join(' , ')}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{custName(t.customerId)}</td>
                    <td className="px-4 py-3 text-slate-500">
                      <div dir="ltr" className="font-bold text-[12px]">{vehName(t.vehicleId)}</div>
                      <div className="text-[10.5px] text-slate-400">{drvName(t.driverId)}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-bold">{fmt(t.totals.grandMinor)}</div>
                      <div className="text-[10px] text-slate-400">{t.vatPercent > 0 ? `شامل ضريبة ${t.vatPercent}٪` : 'بدون ضريبة'}</div>
                    </td>
                    <td className={`px-4 py-3 font-black ${t.totals.profitMinor >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmt(t.totals.profitMinor)}</td>
                    <td className="px-4 py-3 text-left">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => printCustomerInvoice(t)}
                          data-trip-print-invoice
                          title="طباعة فاتورة بيع احترافية للعميل (بلا مصاريف داخلية ولا أرباح/خسائر)"
                          className="px-2.5 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20 text-[11px] font-black flex items-center gap-1 transition-all"
                        >
                          <FileText size={13} /> فاتورة للعميل
                        </button>
                        <button
                          onClick={() => openEdit(t)}
                          data-trip-edit-btn
                          title="تعديل بيانات فاتورة النقلة"
                          className="p-2 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-500/10 transition-all"
                        >
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => setViewing(t)} title="عرض التفاصيل والقيد والمرفقات" className="p-2 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-500/10 transition-all"><Eye size={15} /></button>
                        <button onClick={() => printWaybill(t)} title="طباعة بوليصة النقل للسائق" className="p-2 rounded-lg text-slate-400 hover:text-fuchsia-600 hover:bg-fuchsia-500/10 transition-all"><Printer size={15} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {tab === 'profit' && (
        <div className="anim-up space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {presets.map((p) => (
              <button key={p.id} onClick={() => setPresetId(p.id)} className={`px-3 py-1.5 rounded-lg text-[12px] font-bold transition-all ${presetId === p.id ? 'bg-fuchsia-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>{p.label}</button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-4 text-center">
              <div className="text-[10px] text-slate-400 font-bold">إيراد النقلات</div>
              <div className="font-black text-lg">{fmt(profit.totalRevenueMinor)}</div>
            </div>
            <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-4 text-center">
              <div className="text-[10px] text-slate-400 font-bold">مصاريف النقلات الداخلية (الشركة)</div>
              <div className="font-black text-lg text-rose-500">{fmt(profit.totalCostMinor)}</div>
            </div>
            <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-4 text-center">
              <div className="text-[10px] text-slate-400 font-bold">صافي الربح</div>
              <div className={`font-black text-lg ${profit.totalProfitMinor >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmt(profit.totalProfitMinor)}</div>
            </div>
          </div>
          <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden">
            {profit.rows.length === 0 ? (
              <div className="text-center text-slate-400 text-[13px] py-10">لا نقلات في هذه الفترة</div>
            ) : (
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-slate-400 text-[11px] border-b border-slate-100 dark:border-slate-800">
                    <th className="px-4 py-3 text-right font-bold">النقلة</th>
                    <th className="px-4 py-3 text-right font-bold">المسار / الخدمة</th>
                    <th className="px-4 py-3 text-right font-bold">العميل</th>
                    <th className="px-4 py-3 text-right font-bold">الإيراد</th>
                    <th className="px-4 py-3 text-right font-bold">التكلفة الداخلية</th>
                    <th className="px-4 py-3 text-right font-bold">الربح</th>
                    <th className="px-4 py-3 text-right font-bold">الهامش</th>
                  </tr>
                </thead>
                <tbody>
                  {profit.rows.map((r) => (
                    <tr key={r.tripId} className="border-b border-slate-50 dark:border-slate-800/50">
                      <td className="px-4 py-2 font-bold text-fuchsia-600">{r.tripNumber}</td>
                      <td className="px-4 py-2">{r.route}{r.qty > 1 ? ` (×${r.qty})` : ''}</td>
                      <td className="px-4 py-2 text-slate-500">{custName(r.customerId)}</td>
                      <td className="px-4 py-2 font-bold">{fmt(r.revenueMinor)}</td>
                      <td className="px-4 py-2 text-rose-500">{fmt(r.costMinor)}</td>
                      <td className={`px-4 py-2 font-black ${r.profitMinor >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmt(r.profitMinor)}</td>
                      <td className="px-4 py-2 text-slate-500">{r.marginPercent}٪</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* نافذة إنشاء / تعديل فاتورة نقلة */}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editingTrip ? `تعديل فاتورة النقلة ${editingTrip.tripNumber}` : 'فاتورة نقلة جديدة'}
        extraWide
        subtitle="فاتورة بيع خدمات نقل: اختر خدمة النقل من المخزن والعدد والسعر وأرقام الحاويات تحت كل سطر"
      >
        <div className="space-y-4">
          <DocSectionHead step="١" title="أطراف فاتورة النقلة (العميل · المركبة · السائق)" hint="عند اختيار المركبة يُقترح سائقها الافتراضي تلقائياً من الموظفين" />
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <Field label="العميل">
              <PartyQuickPicker
                parties={customers}
                value={customerId ? Number(customerId) : 0}
                onChange={(id) => {
                  setCustomerId(id ? String(id) : '')
                  if (id && !editingTrip) setPayment('credit')
                }}
                cashLabel="عميل نقدي"
                label="بحث العميل"
                cashValue={0}
              />
            </Field>
            <Field label="المركبة / السيارة">
              <QuickSelect value={vehicleId} onChange={(e) => pickVehicle(e.target.value)} className={inputCls}>
                <option value="">بلا مركبة</option>
                {vehicles.map((v) => <option key={v.id} value={v.id}>{v.plateNumber} — {v.vehicleType}</option>)}
              </QuickSelect>
            </Field>
            <Field label="السائق (من الموظفين)">
              <div className="space-y-1">
                <PartyQuickPicker
                  parties={activeDrivers.map((emp) => ({
                    ...emp,
                    nameAr: `${isDriverEmployee(emp) ? '👨‍✈️ ' : ''}${emp.nameAr}${emp.jobTitle ? ` — ${emp.jobTitle}` : ''}`,
                  }))}
                  value={driverId ? Number(driverId) : 0}
                  onChange={(id) => setDriverId(id ? String(id) : '')}
                  cashLabel="بلا سائق"
                  label="بحث السائق"
                  cashValue={0}
                />
                <button type="button" onClick={() => setQuickDrvOpen((v) => !v)} className="text-[10.5px] font-bold text-fuchsia-600 hover:underline">
                  {quickDrvOpen ? 'إغلاق نموذج السائق' : '+ تسجيل سائق جديد في الموظفين'}
                </button>
              </div>
            </Field>
            <Field label={`عمولة السائق (${cur.symbol})`} hint="تُستحق على 2111 ولا تُدفع الآن">
              <input value={driverCommission} onChange={(e) => setDriverCommission(e.target.value)} inputMode="decimal" className={inputCls} placeholder="0" disabled={!driverId} />
            </Field>
          </div>

          {quickDrvOpen && (
            <div className="rounded-xl border border-fuchsia-500/30 bg-fuchsia-500/5 p-3 flex flex-wrap items-end gap-2">
              <div className="flex-1 min-w-[180px]">
                <label className="text-[11px] font-bold text-fuchsia-700 dark:text-fuchsia-300 block mb-1">اسم السائق الجديد *</label>
                <input value={quickDrvName} onChange={(e) => setQuickDrvName(e.target.value)} className={inputCls} placeholder="مثال: كابتن محمود علي" />
              </div>
              <div className="w-44">
                <label className="text-[11px] font-bold text-fuchsia-700 dark:text-fuchsia-300 block mb-1">رقم الهاتف</label>
                <input value={quickDrvPhone} onChange={(e) => setQuickDrvPhone(e.target.value)} className={inputCls} dir="ltr" placeholder="05xxxxxxxx" />
              </div>
              <Btn onClick={createQuickDriver} disabled={!quickDrvName.trim()}>حفظ في الموظفين وربطه</Btn>
            </div>
          )}

          {/* بنود خدمات النقل (مثل فاتورة البيع) */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-3.5 space-y-3" data-trip-service-lines>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-[13px] font-black text-slate-800 dark:text-white">٢) بنود خدمات النقل (من أصناف المخزن الخدمية)</div>
                <div className="text-[11px] text-slate-400">اختر خدمة النقل من المخزن وحدد عدد النقلات وسعر النقلة، وأضف أرقام الحاويات تحت كل سطر بحد أقصى عدد النقلات</div>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setQuickSvcOpen((v) => !v)} className="px-2.5 py-1.5 rounded-lg bg-sky-500/10 text-sky-700 dark:text-sky-300 text-[11px] font-bold hover:bg-sky-500/20">
                  + تسجيل خدمة نقل جديدة في المخزن
                </button>
                <button type="button" onClick={() => setLines((prev) => [...prev, makeEmptyLine()])} className="px-2.5 py-1.5 rounded-lg bg-fuchsia-600 text-white text-[11px] font-bold hover:bg-fuchsia-700">
                  + إضافة سطر نقلة
                </button>
              </div>
            </div>

            {quickSvcOpen && (
              <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-3 flex flex-wrap items-end gap-2">
                <div className="flex-1 min-w-[220px]">
                  <label className="text-[11px] font-bold text-sky-700 dark:text-sky-300 block mb-1">اسم خدمة النقل في المخزن *</label>
                  <input value={quickSvcName} onChange={(e) => setQuickSvcName(e.target.value)} className={inputCls} placeholder="مثال: خدمة نقل داخلي من الميناء إلى التخزين" />
                </div>
                <div className="w-40">
                  <label className="text-[11px] font-bold text-sky-700 dark:text-sky-300 block mb-1">سعر النقلة الافتراضي ({cur.symbol})</label>
                  <input value={quickSvcPrice} onChange={(e) => setQuickSvcPrice(e.target.value)} className={inputCls} dir="ltr" inputMode="decimal" placeholder="0" />
                </div>
                <Btn onClick={createQuickServiceItem} disabled={!quickSvcName.trim()}>حفظ الصنف الخدمي واختياره</Btn>
              </div>
            )}

            <div className="space-y-3">
              {lines.map((line, lineIdx) => {
                const lineQty = Math.max(1, Math.floor(Number(line.qty) || 1))
                const lineUnitMinor = toM(line.unitPrice)
                const lineTotalMinor = lineQty * lineUnitMinor
                const canAddContainer = line.containers.length < lineQty
                return (
                  <div key={line.key} className="rounded-xl border border-slate-200 dark:border-slate-700/80 bg-slate-50/60 dark:bg-slate-800/30 p-3 space-y-2.5">
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
                      <div className="sm:col-span-4">
                        <label className="text-[11px] font-bold text-slate-500 block mb-1">الصنف / خدمة النقل (من المخزن) *</label>
                        <QuickSelect
                          value={line.itemId ?? ''}
                          onChange={(e) => selectServiceItemForLine(line.key, e.target.value)}
                          className={`${inputCls} !py-1.5 !text-[12px]`}
                        >
                          <option value="">— اختر خدمة نقل من المخزن أو اكتبها —</option>
                          {serviceItems.map((it) => (
                            <option key={it.id} value={it.id}>
                              {it.isService ? '🛠️ ' : ''}{it.nameAr}{it.priceMinor > 0 ? ` (${fmt(it.priceMinor)} ${cur.symbol})` : ''}
                            </option>
                          ))}
                        </QuickSelect>
                        <input
                          value={line.serviceNameAr}
                          onChange={(e) => patchLine(line.key, { serviceNameAr: e.target.value })}
                          className={`${inputCls} !py-1.5 !text-[12px] mt-1`}
                          placeholder="بيان خدمة النقل (مثال: نقل داخلي من الميناء إلى التخزين)"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="text-[11px] font-bold text-slate-500 block mb-1">من (الانطلاق)</label>
                        <input value={line.fromLoc} onChange={(e) => patchLine(line.key, { fromLoc: e.target.value })} className={`${inputCls} !py-1.5 !text-[12px]`} placeholder="الرياض / الميناء" />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="text-[11px] font-bold text-slate-500 block mb-1">إلى (الوصول)</label>
                        <input value={line.toLoc} onChange={(e) => patchLine(line.key, { toLoc: e.target.value })} className={`${inputCls} !py-1.5 !text-[12px]`} placeholder="الدمام / التخزين" />
                      </div>
                      <div className="sm:col-span-1">
                        <label className="text-[11px] font-bold text-slate-500 block mb-1">العدد *</label>
                        <input
                          value={line.qty}
                          onChange={(e) => patchLine(line.key, { qty: e.target.value })}
                          className={`${inputCls} !py-1.5 !text-[12px] text-center font-bold`}
                          dir="ltr"
                          inputMode="numeric"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="text-[11px] font-bold text-slate-500 block mb-1">سعر النقلة ({cur.symbol}) *</label>
                        <input
                          value={line.unitPrice}
                          onChange={(e) => patchLine(line.key, { unitPrice: e.target.value })}
                          className={`${inputCls} !py-1.5 !text-[12px] text-center font-mono font-bold`}
                          dir="ltr"
                          inputMode="decimal"
                          placeholder="0.00"
                        />
                      </div>
                      <div className="sm:col-span-1 flex items-center justify-between sm:justify-end gap-1">
                        <div className="text-left">
                          <div className="text-[10px] text-slate-400">الإجمالي</div>
                          <b className="font-mono text-[12.5px] text-emerald-600">{fmt(lineTotalMinor)}</b>
                        </div>
                        {lines.length > 1 && (
                          <button type="button" onClick={() => setLines((prev) => prev.filter((x) => x.key !== line.key))} className="p-1.5 rounded text-slate-400 hover:text-rose-600">
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* مربعات أرقام الحاويات تحت السطر بحد أقصى عدد النقلات بالسطر */}
                    <div className="pt-2 border-t border-slate-200/70 dark:border-slate-700/60 space-y-2" data-line-containers={lineIdx}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[11px] font-bold text-slate-500 flex items-center gap-1">
                          <Container size={13} className="text-fuchsia-600" />
                          أرقام الحاويات لهذا السطر ({line.containers.length} من أصل {lineQty} نقلات مسموحة)
                        </span>
                        <button
                          type="button"
                          data-add-container-btn
                          disabled={!canAddContainer}
                          onClick={() => addContainerBox(line.key)}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all ${canAddContainer ? 'bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300 hover:bg-fuchsia-500/25' : 'bg-slate-200/60 dark:bg-slate-800 text-slate-400 cursor-not-allowed'}`}
                        >
                          {canAddContainer ? `+ إضافة رقم حاوية (${line.containers.length}/${lineQty})` : `الحد الأقصى ${lineQty} حاويات حسب عدد النقلات`}
                        </button>
                      </div>
                      {line.containers.length > 0 && (
                        <div className="grid grid-cols-1 sm:grid-cols-3 md:grid-cols-4 gap-2">
                          {line.containers.map((cVal, cIdx) => (
                            <div key={cIdx} className="flex items-center gap-1 rounded-lg border border-fuchsia-500/30 bg-white dark:bg-slate-900 px-2 py-1">
                              <span className="text-[10px] font-bold text-fuchsia-600 shrink-0">حاوية #{cIdx + 1}:</span>
                              <input
                                value={cVal}
                                onChange={(e) => updateContainerBox(line.key, cIdx, e.target.value)}
                                className="w-full bg-transparent text-[12px] font-mono font-bold outline-none"
                                dir="ltr"
                                placeholder="MSKU1234567"
                              />
                              <button type="button" onClick={() => removeContainerBox(line.key, cIdx)} className="text-slate-400 hover:text-rose-500 text-xs font-bold px-1">×</button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* تنبيه فصل مصاريف النقلات في قسمها المستقل */}
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-[11.5px]">
            <span className="text-amber-800 dark:text-amber-200 font-bold">
              💡 مصاريف النقلة (سواء الداخلية على الشركة أو المحمّلة على العميل) تُسجَّل من قسم <b>«مصاريف النقلات»</b> المستقل داخل اللوجستيات ولا تُسجَّل داخل فاتورة النقل.
            </span>
            <a href="#/logistics/expenses" onClick={() => setOpen(false)} className="font-black text-amber-700 dark:text-amber-300 underline">
              فتح قسم مصاريف النقلات ←
            </a>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="طريقة تحصيل الفاتورة">
              <div className="grid grid-cols-2 gap-1.5">
                <button type="button" onClick={() => setPayment('cash')} className={`p-2 rounded-lg border-2 text-[12px] font-bold transition-all ${payment === 'cash' ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-600' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}>نقدي</button>
                <button type="button" onClick={() => setPayment('credit')} className={`p-2 rounded-lg border-2 text-[12px] font-bold transition-all ${payment === 'credit' ? 'border-amber-500/60 bg-amber-500/10 text-amber-600' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}>آجل (على حساب العميل)</button>
              </div>
            </Field>
            {payment === 'cash' && !editingTrip && (
              <>
                <Field label="طريقة التحصيل"><QuickSelect value={terminalId} onChange={(e) => setTerminalId(e.target.value)} className={inputCls}><option value="">نقدي/بنك</option>{availableTerminals.map((terminal) => <option key={terminal.id} value={terminal.id}>💳 {terminal.nameAr}</option>)}</QuickSelect></Field>
                {!terminalId && <Field label="إلى أي خزينة/بنك؟"><TreasuryPicker value={treasury} onChange={setTreasury} compact /></Field>}
                {terminalId && <><Field label="مرجع إيصال الماكينة (اختياري)"><input value={terminalReference} onChange={(e) => setTerminalReference(e.target.value)} className={inputCls} /></Field><Field label="آخر 4 أرقام (اختياري)"><input value={cardLast4} onChange={(e) => setCardLast4(e.target.value.replace(/\D/g, '').slice(0, 4))} className={inputCls} /></Field></>}
              </>
            )}
            <Field label={`المحصَّل الآن (${cur.symbol}) — اختياري`} hint="اتركه فارغاً = حسب طريقة التحصيل. مبلغ جزئي = الباقي ديناً على العميل">
              <input value={paidNow} onChange={(e) => setPaidNow(e.target.value)} inputMode="decimal" className={inputCls} dir="ltr" placeholder={payment === 'cash' ? 'الكل' : '0'} />
            </Field>

            {/* خيار تفعيل الضريبة أو بدون ضريبة (مفعّل تلقائياً حسب إعدادات الشركة) */}
            <label className="flex items-center justify-between p-3 rounded-xl border border-slate-200 dark:border-slate-700 cursor-pointer self-end bg-slate-50/50 dark:bg-slate-800/40" data-trip-tax-checkbox>
              <div>
                <span className="text-[12.5px] font-black text-slate-700 dark:text-slate-200 block">
                  تفعيل ضريبة القيمة المضافة ({setup.vatPercent}٪)
                </span>
                <span className="text-[10.5px] text-slate-400">
                  {withVat ? `مفعّلة — تُضاف ضريبة ${setup.vatPercent}٪ على الفاتورة` : 'بدون ضريبة (٠٪ على هذه الفاتورة)'}
                </span>
              </div>
              <input
                type="checkbox"
                checked={withVat}
                onChange={(e) => setWithVat(e.target.checked)}
                className="w-4 h-4 accent-fuchsia-600"
              />
            </label>
          </div>

          {draftTotals && (
            <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/50 p-4 grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-[12px]">
              <div><div className="text-slate-400">إجمالي النقل (قبل الضريبة)</div><b>{fmt(draftTotals.baseMinor)}</b></div>
              <div><div className="text-slate-400">ضريبة القيمة المضافة ({withVat ? `${setup.vatPercent}٪` : 'بدون'})</div><b>{fmt(draftTotals.vatMinor)}</b></div>
              <div><div className="text-slate-400">إجمالي الفاتورة على العميل</div><b className="text-emerald-600 text-[14px]">{fmt(draftTotals.grandMinor)}</b></div>
              <div><div className="text-slate-400">عدد النقلات / الحاويات</div><b>{draftInput.qty} نقلة ({draftInput.containerNumbers.length} حاوية)</b></div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
            <Field label="ملاحظات الفاتورة">
              <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} placeholder="رقم بوليصة، شروط تسليم، بيان إضافي…" />
            </Field>
            <div className="flex items-center justify-end">
              <DocumentAttachmentsBox
                documentKind="trip"
                documentId={editingTrip?.id ?? null}
                pending={attachments}
                onPendingChange={setAttachments}
                addedBy={appUsers.find((u) => u.id === currentUserId)?.nameAr ?? setup.ownerName ?? 'المالك'}
              />
            </div>
          </div>

          <DocOutcome>الأثر: <b>4105 إيراد النقل</b> دائناً بالأجرة{withVat && setup.vatPercent > 0 ? <> · و<b>2102 ض.ق.م</b> دائناً بالضريبة</> : ''} · والمتبقي مديناً على <b>1104 العملاء</b> (ومصاريف الرحلة تُسجَّل من قسم مصاريف النقلات على <b>5106</b> أو <b>1104</b>).</DocOutcome>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setOpen(false)}>إلغاء</Btn>
            <Btn onClick={() => save()} shortcut="F9" disabled={!canSave}>
              💾 {editingTrip ? 'حفظ تعديلات النقلة وتحديث القيد' : 'ترحيل فاتورة النقلة وتوليد القيد'}
            </Btn>
          </div>
        </div>
      </Modal>

      {/* عرض نقلة */}
      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing ? `فاتورة النقلة ${viewing.tripNumber}` : ''} wide>
        {viewing && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Btn onClick={() => printCustomerInvoice(viewing)}>
                  <span className="flex items-center gap-1.5"><FileText size={14} /> طباعة فاتورة للعميل</span>
                </Btn>
                <Btn variant="ghost" onClick={() => printWaybill(viewing)}>
                  <span className="flex items-center gap-1.5"><Printer size={14} /> بوليصة السائق</span>
                </Btn>
                <Btn variant="ghost" onClick={() => { const t = viewing; setViewing(null); openEdit(t) }}>
                  <span className="flex items-center gap-1.5"><Pencil size={14} /> تعديل النقلة</span>
                </Btn>
                <a href={`#/logistics/expenses`} onClick={() => setViewing(null)} className="px-3 py-1.5 rounded-xl bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[12px] font-bold hover:bg-amber-500/20 flex items-center gap-1.5">
                  <Coins size={13} /> تسجيل مصروف على النقلة
                </a>
              </div>
              <DocumentAttachmentsBox
                documentKind="trip"
                documentId={viewing.id}
                pending={[]}
                onPendingChange={() => {}}
                addedBy={appUsers.find((u) => u.id === currentUserId)?.nameAr ?? setup.ownerName ?? 'المالك'}
              />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-[12px]">
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3"><div className="text-slate-400">المسار / الخدمة</div><b>{viewing.fromLoc} ← {viewing.toLoc}</b></div>
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3"><div className="text-slate-400">العميل</div><b>{custName(viewing.customerId)}</b></div>
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3"><div className="text-slate-400">المركبة / السائق</div><b dir="ltr">{vehName(viewing.vehicleId)}</b><div className="text-[10px] text-slate-400">{drvName(viewing.driverId)}</div></div>
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3"><div className="text-slate-400">ربح النقلة (داخلي)</div><b className={viewing.totals.profitMinor >= 0 ? 'text-emerald-600' : 'text-rose-600'}>{fmt(viewing.totals.profitMinor)}</b></div>
            </div>

            {viewing.lines && viewing.lines.length > 0 && (
              <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="px-4 py-2 text-[11px] font-bold text-slate-400 border-b border-slate-100 dark:border-slate-800">بنود خدمات النقل والحاويات</div>
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-slate-400 text-[10.5px] border-b border-slate-100 dark:border-slate-800">
                      <th className="px-3 py-1.5 text-right">الخدمة</th>
                      <th className="px-3 py-1.5 text-right">المسار</th>
                      <th className="px-3 py-1.5 text-right">العدد × السعر</th>
                      <th className="px-3 py-1.5 text-right">الحاويات</th>
                      <th className="px-3 py-1.5 text-left">الإجمالي</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viewing.lines.map((l, idx) => (
                      <tr key={idx} className="border-b border-slate-50 dark:border-slate-800/50">
                        <td className="px-3 py-2 font-bold">{l.serviceNameAr}</td>
                        <td className="px-3 py-2 text-slate-500">{l.fromLoc && l.toLoc ? `${l.fromLoc} ← ${l.toLoc}` : '—'}</td>
                        <td className="px-3 py-2 font-mono">{l.qty} × {fmt(l.unitPriceMinor)}</td>
                        <td className="px-3 py-2 font-mono text-[11px]" dir="ltr">{l.containerNumbers?.length ? l.containerNumbers.join(', ') : '—'}</td>
                        <td className="px-3 py-2 font-bold text-left font-mono">{fmt(l.qty * l.unitPriceMinor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {viewing.containerNumbers.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <Container size={13} className="text-slate-400" />
                {viewing.containerNumbers.map((c, i) => (
                  <span key={i} className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 font-mono font-bold text-slate-600 dark:text-slate-300" dir="ltr">{c}</span>
                ))}
              </div>
            )}

            {viewing.expenses.length > 0 && (
              <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="px-4 py-2 text-[11px] font-bold text-slate-400 border-b border-slate-100 dark:border-slate-800">مصاريف النقلة المسجلة (من قسم مصاريف النقلات)</div>
                <table className="w-full text-[12px]">
                  <tbody>
                    {viewing.expenses.map((e, i) => (
                      <tr key={i} className="border-b border-slate-50 dark:border-slate-800/50">
                        <td className="px-4 py-1.5 font-bold">{e.nameAr}</td>
                        <td className="px-4 py-1.5 text-slate-400">{e.qty} × {fmt(e.unitAmountMinor)}</td>
                        <td className="px-4 py-1.5 text-slate-500 text-[11px]">{EXPENSE_SOURCE_LABELS[e.source]}</td>
                        <td className="px-4 py-1.5 font-bold text-left">{fmt(e.amountMinor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <ServiceRefundBox
              grandMinor={viewing.totals.grandMinor}
              refundedMinor={viewing.refundedMinor ?? 0}
              currencySymbol={cur.symbol}
              fmt={fmt}
              allowCredit={viewing.customerId != null}
              refundableItems={[
                { key: 'base', label: `نولون النقلة (${viewing.qty} × ${fmt(viewing.unitPriceMinor)})`, valueMinor: viewing.totals.baseMinor, qty: viewing.qty },
                ...viewing.expenses
                  .map((ex, i) => ({ ex, i }))
                  .filter(({ ex }) => ex.source === 'customer')
                  .map(({ ex, i }) => ({ key: `exp:${i}`, label: `${ex.nameAr} (على العميل)`, valueMinor: ex.amountMinor, qty: ex.qty })),
              ]}
              hint="خصم/تعويض للعميل عن النقلة (تأخير/تلفيات): يعكس الإيراد وحصة الضريبة — مصاريف النقلة تبقى لأنها تُكبدت فعلاً."
              onSubmit={(a) => {
                try {
                  const u = refundTrip({ tripId: viewing.id, ...a })
                  setViewing(u)
                  toast.show(`سُجل مرتجع النقلة ${u.tripNumber} وتولد القيد العاكس ✅`)
                } catch (err) { toast.show((err as Error).message, 'error') }
              }}
            />

            {viewEntry && (
              <div className="rounded-2xl border border-rose-500/20 bg-rose-500/[0.03] overflow-hidden">
                <div className="px-4 py-2.5 text-[12px] font-bold text-rose-600 dark:text-rose-400 border-b border-rose-500/10 flex items-center gap-1.5">
                  <BookOpenText size={13} /> القيد المتولد #{viewEntry.entryNumber}
                </div>
                <table className="w-full text-[12px]">
                  <tbody>
                    {viewEntry.lines.map((l, i) => (
                      <tr key={i} className="border-t border-rose-500/5">
                        <td className="px-4 py-1.5 text-slate-600 dark:text-slate-300">
                          {l.debit > 0 ? '' : '\u00A0\u00A0\u00A0\u00A0إلى '} {ACCOUNT_NAMES[l.accountCode] ?? l.accountCode}
                        </td>
                        <td className="px-4 py-1.5 w-28 font-bold">{l.debit > 0 ? fmt(l.debit) : ''}</td>
                        <td className="px-4 py-1.5 w-28 font-bold text-slate-400">{l.credit > 0 ? fmt(l.credit) : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* مستحقات السائقين غير المسواة */}
      {driversWithDues.length > 0 && (
        <div className="rounded-2xl border border-amber-200 dark:border-amber-900/50 overflow-hidden">
          <div className="px-4 py-2.5 bg-amber-500/10 text-amber-700 dark:text-amber-300 font-black text-sm flex items-center justify-between">
            <span>💰 مستحقات سائقين غير مسواة</span>
            <span className="flex items-center gap-2 text-[11px] font-bold">
              التسوية من: <TreasuryPicker value={settleTreasury} onChange={setSettleTreasury} compact />
            </span>
          </div>
          <div data-driver-dues-hint className="border-t border-amber-200/60 px-4 py-1.5 text-[11px] font-bold text-slate-500 dark:border-amber-900/40">
            أو تُصرف مع الراتب: تظهر في «مسير الرواتب» بعمود العمولات ويصفّيها قيد المسير (2111) فلا تُصرف مرتين.
          </div>
          <table className="w-full text-sm">
            <tbody>
              {driversWithDues.map((d) => (
                <tr key={d.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-4 py-2.5 font-bold">{d.name}</td>
                  <td className="px-4 py-2.5 text-[12px] text-slate-500">{d.trips} رحلة</td>
                  <td className="px-4 py-2.5 font-black text-amber-600 tabular-nums">{fmt(d.balance)}</td>
                  <td className="px-4 py-2.5 text-left">
                    <Btn variant="soft" onClick={() => doSettleDriver(d.id, d.name)}>تسوية الكل</Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creditApproval.dialog}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   قسم مستقل: مصاريف النقلات (/logistics/expenses)
   يسجل المصاريف على فواتير النقلات مع الفصل الصارم بين:
   - مصاريف داخلية تُحمّل على الشركة (5106 مصروفات نقلات — لا تظهر للعميل)
   - مصاريف تُحمّل على العميل (1104 العملاء — تظهر في حسابه وفاتورته)
   ═══════════════════════════════════════════════════════════════════════════ */

const QUICK_TRIP_EXPENSE_NAMES = [
  'سولار / وقود',
  'كارتة طريق وموازين',
  'مبيت وإعاشة سائق',
  'رسوم موانئ وأرضيات',
  'تفويج وتخليص',
  'تحميل وتعتيق',
  'صيانة طارئة بالطريق',
]

export function TripExpensesPage() {
  const { trips, tripExpenses, vehicles, employees, customers, custodyFiles, custodyTxs, journal, addTripExpense, reverseTripExpense } = useDataStore()
  const { setup } = useAppStore()
  const toast = useToast()
  const cur = useMemo(
    () => (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' },
    [setup.countryCode],
  )
  const fmt = (m: number) => formatMinor(m, cur, false)
  const custName = (id: number | null) => (id == null ? 'عميل نقدي' : customers.find((c) => c.id === id)?.nameAr ?? '—')
  const vehName = (id: number | null) => (id == null ? '—' : vehicles.find((v) => v.id === id)?.plateNumber ?? '—')
  const drvName = (id: number | null) => (id == null ? '—' : employees.find((e) => e.id === id)?.nameAr ?? '—')

  const [filterTripId, setFilterTripId] = useState('')
  const [filterBearer, setFilterBearer] = useState<'all' | TripExpenseBearer>('all')
  const [viewingExp, setViewingExp] = useState<TripExpenseRecord | null>(null)
  const [open, setOpen] = useState(false)
  const [tripId, setTripId] = useState('')
  const [bearer, setBearer] = useState<TripExpenseBearer>('company')
  const [nameAr, setNameAr] = useState('')
  const [qty, setQty] = useState('1')
  const [unitAmount, setUnitAmount] = useState('')
  const [paymentSource, setPaymentSource] = useState<TripExpensePaymentSource>('cash')
  const [treasury, setTreasury] = useState('1101')
  const [custodyFileId, setCustodyFileId] = useState('')
  const [notes, setNotes] = useState('')

  const selectedTrip = useMemo(() => trips.find((t) => t.id === Number(tripId)) ?? null, [trips, tripId])

  const filtered = useMemo(() => {
    return [...tripExpenses]
      .filter((e) => (!filterTripId || e.tripId === Number(filterTripId)) && (filterBearer === 'all' || e.bearer === filterBearer))
      .reverse()
  }, [tripExpenses, filterTripId, filterBearer])

  const totals = useMemo(() => {
    const active = filtered.filter((e) => !e.reversedByEntryId)
    const companyMinor = active.filter((e) => e.bearer === 'company').reduce((s, e) => s + e.amountMinor, 0)
    const customerMinor = active.filter((e) => e.bearer === 'customer').reduce((s, e) => s + e.amountMinor, 0)
    return { companyMinor, customerMinor, totalMinor: companyMinor + customerMinor }
  }, [filtered])

  const openNew = () => {
    setTripId(trips.at(-1)?.id ? String(trips.at(-1)!.id) : '')
    setBearer('company')
    setNameAr('')
    setQty('1')
    setUnitAmount('')
    setPaymentSource('cash')
    setTreasury('1101')
    setCustodyFileId('')
    setNotes('')
    setOpen(true)
  }

  const save = () => {
    try {
      const rec = addTripExpense({
        tripId: Number(tripId),
        nameAr,
        qty: Number(qty) || 1,
        unitAmountMinor: unitAmount.trim() ? toMinor(unitAmount, cur.decimals) : 0,
        bearer,
        paymentSource,
        treasury,
        custodyFileId: custodyFileId ? Number(custodyFileId) : null,
        notes,
      })
      toast.show(
        bearer === 'customer'
          ? `سُجّل مصروف النقلة ${rec.expenseNumber} وحُمّل على حساب العميل (1104) بقيمة ${fmt(rec.amountMinor)} ${cur.symbol} ✅`
          : `سُجّل مصروف النقلة الداخلي ${rec.expenseNumber} على الشركة (5106) بقيمة ${fmt(rec.amountMinor)} ${cur.symbol} ✅`,
      )
      setOpen(false)
    } catch (err) {
      toast.show((err as Error).message, 'error')
    }
  }

  return (
    <div className="space-y-4" data-trip-expenses-page>
      <div className="anim-up flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-black text-slate-800 dark:text-white flex items-center gap-2">
            <Coins size={20} className="text-amber-500" /> مصاريف النقلات
          </h1>
          <p className="text-[12px] text-slate-400 mt-0.5">
            قسم مستقل لتسجيل مصاريف فواتير النقلات: مصاريف داخلية تُحمّل على الشركة (5106) ومصاريف تُحمّل على العميل وتظهر في حسابه (1104)
          </p>
        </div>
        <Btn onClick={openNew} disabled={trips.length === 0}>
          <span className="flex items-center gap-1.5"><Plus size={15} /> تسجيل مصروف على نقلة</span>
        </Btn>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center">
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-4">
          <div className="text-[11px] text-slate-400 font-bold">مصاريف داخلية محمّلة على الشركة (5106)</div>
          <div className="font-black text-lg text-rose-600 mt-1">{fmt(totals.companyMinor)} {cur.symbol}</div>
          <div className="text-[10px] text-slate-400">تُخصم من ربح النقلة ولا تظهر في فاتورة العميل</div>
        </div>
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-4">
          <div className="text-[11px] text-slate-400 font-bold">مصاريف محمّلة على العملاء (1104)</div>
          <div className="font-black text-lg text-amber-600 mt-1">{fmt(totals.customerMinor)} {cur.symbol}</div>
          <div className="text-[10px] text-slate-400">تُقيّد في ذمة العميل وتظهر في كشف حسابه وفاتورته</div>
        </div>
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-4">
          <div className="text-[11px] text-slate-400 font-bold">إجمالي المصاريف المسجلة</div>
          <div className="font-black text-lg text-slate-800 dark:text-white mt-1">{fmt(totals.totalMinor)} {cur.symbol}</div>
          <div className="text-[10px] text-slate-400">{filtered.length} حركة مصروف</div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-3">
        <Field label="فلترة حسب النقلة / الفاتورة">
          <QuickSelect value={filterTripId} onChange={(e) => setFilterTripId(e.target.value)} className={inputCls}>
            <option value="">كل النقلات</option>
            {[...trips].reverse().map((t) => (
              <option key={t.id} value={t.id}>{t.tripNumber} — {t.fromLoc} ← {t.toLoc} ({custName(t.customerId)})</option>
            ))}
          </QuickSelect>
        </Field>
        <Field label="فلترة حسب جهة التحمّل">
          <QuickSelect value={filterBearer} onChange={(e) => setFilterBearer(e.target.value as 'all' | TripExpenseBearer)} className={inputCls}>
            <option value="all">الكل (داخلي على الشركة + محمّل على العميل)</option>
            <option value="company">مصاريف داخلية على الشركة فقط (5106)</option>
            <option value="customer">مصاريف محمّلة على العميل فقط (1104)</option>
          </QuickSelect>
        </Field>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800">
          <EmptyState icon="⛽" title="لا مصاريف نقلات مسجلة بعد" sub="سجّل مصاريف السولار والكارتة والأرضيات واربطها بفاتورة النقلة مع تحديد هل تتحملها الشركة أم العميل" />
        </div>
      ) : (
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-slate-400 text-[11px] border-b border-slate-100 dark:border-slate-800">
                <th className="px-4 py-3 text-right font-bold">رقم المصروف</th>
                <th className="px-4 py-3 text-right font-bold">النقلة</th>
                <th className="px-4 py-3 text-right font-bold">البيان</th>
                <th className="px-4 py-3 text-right font-bold">جهة التحمّل</th>
                <th className="px-4 py-3 text-right font-bold">طريقة الصرف</th>
                <th className="px-4 py-3 text-right font-bold">المركبة / السائق</th>
                <th className="px-4 py-3 text-left font-bold">المبلغ</th>
                <th className="px-4 py-3 text-left font-bold">القيد</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((exp) => (
                <tr key={exp.id} className="border-b border-slate-50 dark:border-slate-800/50">
                  <td className="px-4 py-2.5 font-mono font-bold text-amber-600">{exp.expenseNumber}<div className="text-[10px] text-slate-400">{exp.date}</div></td>
                  <td className="px-4 py-2.5 font-bold text-fuchsia-600">{exp.tripNumber}<div className="text-[10.5px] text-slate-400">{custName(exp.customerId)}</div></td>
                  <td className="px-4 py-2.5 font-bold">{exp.nameAr}{exp.qty > 1 ? ` (×${exp.qty})` : ''}{exp.notes ? <div className="text-[10.5px] text-slate-400">{exp.notes}</div> : null}</td>
                  <td className="px-4 py-2.5">
                    <span className={`px-2 py-0.5 rounded-full text-[10.5px] font-bold ${exp.bearer === 'customer' ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300' : 'bg-rose-500/10 text-rose-600'}`}>
                      {exp.bearer === 'customer' ? '👤 محمّل على العميل (1104)' : '🏢 داخلي على الشركة (5106)'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-500 text-[11.5px]">{TRIP_EXPENSE_PAYMENT_LABELS[exp.paymentSource]}</td>
                  <td className="px-4 py-2.5 text-slate-500 text-[11.5px]"><div dir="ltr">{vehName(exp.vehicleId)}</div><div className="text-[10px] text-slate-400">{drvName(exp.driverId)}</div></td>
                  <td className="px-4 py-2.5 text-left font-mono font-black">{fmt(exp.amountMinor)}</td>
                  <td className="px-4 py-2.5 text-left">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => setViewingExp(exp)} title="عرض القيد المحاسبي" className="p-1.5 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-500/10"><Eye size={14} /></button>
                      {exp.reversedByEntryId ? (
                        <span className="px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-[10px] font-bold text-slate-500">معكوس #{exp.reversedByEntryId}</span>
                      ) : (
                        <button
                          onClick={() => {
                            try {
                              const rev = reverseTripExpense(exp.id)
                              toast.show(`تم عكس مصروف النقلة ${rev.expenseNumber} وتوليد القيد العاكس ✅`)
                            } catch (err) {
                              toast.show((err as Error).message, 'error')
                            }
                          }}
                          data-reverse-trip-expense
                          title="عكس وإلغاء مصروف النقلة بقيد عاكس"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-500/10"
                        >
                          <RotateCcw size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!viewingExp} onClose={() => setViewingExp(null)} title={viewingExp ? `قيد مصروف النقلة ${viewingExp.expenseNumber}` : ''}>
        {viewingExp && (() => {
          const expEntry = journal.find((e) => e.id === viewingExp.journalEntryId)
          return (
            <div className="space-y-3 text-[12.5px]">
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3 space-y-1">
                <div><span className="text-slate-400">النقلة: </span><b>{viewingExp.tripNumber}</b> ({custName(viewingExp.customerId)})</div>
                <div><span className="text-slate-400">البيان: </span><b>{viewingExp.nameAr}</b> ({viewingExp.qty} × {fmt(viewingExp.unitAmountMinor)} = {fmt(viewingExp.amountMinor)} {cur.symbol})</div>
                <div><span className="text-slate-400">جهة التحمّل: </span><b>{TRIP_EXPENSE_BEARER_LABELS[viewingExp.bearer]}</b></div>
              </div>
              {expEntry && (
                <div className="rounded-2xl border border-rose-500/20 bg-rose-500/[0.03] overflow-hidden">
                  <div className="px-4 py-2 text-[12px] font-bold text-rose-600 dark:text-rose-400 border-b border-rose-500/10 flex items-center gap-1.5">
                    <BookOpenText size={13} /> القيد المتولد #{expEntry.entryNumber}
                  </div>
                  <table className="w-full text-[12px]">
                    <tbody>
                      {expEntry.lines.map((l, i) => (
                        <tr key={i} className="border-t border-rose-500/5">
                          <td className="px-4 py-1.5 text-slate-600 dark:text-slate-300">
                            {l.debit > 0 ? '' : '\u00A0\u00A0\u00A0\u00A0إلى '} {ACCOUNT_NAMES[l.accountCode] ?? l.accountCode}
                          </td>
                          <td className="px-4 py-1.5 w-28 font-bold">{l.debit > 0 ? fmt(l.debit) : ''}</td>
                          <td className="px-4 py-1.5 w-28 font-bold text-slate-400">{l.credit > 0 ? fmt(l.credit) : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })()}
      </Modal>

      <Modal open={open} onClose={() => setOpen(false)} title="تسجيل مصروف على فاتورة نقلة" wide subtitle="حدد النقلة وبيان المصروف وهل يُحمّل داخلياً على الشركة أم على حساب العميل">
        <div className="space-y-4">
          <DocSectionHead step="١" title="ربط المصروف بالنقلة وتحديد جهة التحمّل" hint="المصروف الداخلي يخصم من ربح النقلة ولا يظهر للعميل، والمحمّل على العميل ينزل في ذمته وكشف حسابه وفاتورته" />
          <Field label="فاتورة النقلة *">
            <QuickSelect value={tripId} onChange={(e) => setTripId(e.target.value)} className={inputCls}>
              <option value="">— اختر النقلة —</option>
              {[...trips].reverse().map((t) => (
                <option key={t.id} value={t.id}>
                  {t.tripNumber} — {t.fromLoc} ← {t.toLoc} ({custName(t.customerId)})
                </option>
              ))}
            </QuickSelect>
          </Field>

          {selectedTrip && (
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3 grid grid-cols-3 gap-2 text-[11.5px]">
              <div><span className="text-slate-400 block">العميل</span><b>{custName(selectedTrip.customerId)}</b></div>
              <div><span className="text-slate-400 block">المركبة</span><b dir="ltr">{vehName(selectedTrip.vehicleId)}</b></div>
              <div><span className="text-slate-400 block">السائق</span><b>{drvName(selectedTrip.driverId)}</b></div>
            </div>
          )}

          <Field label="من يتحمّل هذا المصروف؟ *" data-trip-expense-bearer>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {(['company', 'customer'] as TripExpenseBearer[]).map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => setBearer(b)}
                  className={`p-3 rounded-xl border-2 text-right transition-all ${bearer === b ? (b === 'customer' ? 'border-amber-500 bg-amber-500/10 text-amber-800 dark:text-amber-200' : 'border-rose-500 bg-rose-500/10 text-rose-700 dark:text-rose-200') : 'border-slate-200 dark:border-slate-700 text-slate-500'}`}
                >
                  <div className="font-black text-[12.5px]">{b === 'company' ? '🏢 مصروف داخلي على الشركة' : '👤 مصروف محمّل على العميل'}</div>
                  <div className="text-[10.5px] opacity-80 mt-0.5">{TRIP_EXPENSE_BEARER_LABELS[b]}</div>
                </button>
              ))}
            </div>
          </Field>

          <div className="space-y-2">
            <Field label="بيان المصروف *">
              <input value={nameAr} onChange={(e) => setNameAr(e.target.value)} className={inputCls} placeholder="مثال: سولار، كارتة، أرضيات ميناء…" />
            </Field>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_TRIP_EXPENSE_NAMES.map((qName) => (
                <button
                  key={qName}
                  type="button"
                  onClick={() => setNameAr(qName)}
                  className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-[11px] font-bold text-slate-600 dark:text-slate-300 hover:bg-fuchsia-500/15 hover:text-fuchsia-600"
                >
                  {qName}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Field label="العدد">
              <input value={qty} onChange={(e) => setQty(e.target.value)} className={inputCls} dir="ltr" inputMode="numeric" />
            </Field>
            <Field label={`قيمة الوحدة (${cur.symbol}) *`}>
              <input value={unitAmount} onChange={(e) => setUnitAmount(e.target.value)} className={inputCls} dir="ltr" inputMode="decimal" placeholder="0.00" />
            </Field>
            <Field label="طريقة سداد المصروف">
              <QuickSelect value={paymentSource} onChange={(e) => setPaymentSource(e.target.value as TripExpensePaymentSource)} className={inputCls}>
                {(Object.keys(TRIP_EXPENSE_PAYMENT_LABELS) as TripExpensePaymentSource[]).map((s) => (
                  <option key={s} value={s}>{TRIP_EXPENSE_PAYMENT_LABELS[s]}</option>
                ))}
              </QuickSelect>
            </Field>
          </div>

          {paymentSource === 'cash' && (
            <Field label="يُصرف من أي خزينة / بنك؟">
              <TreasuryPicker value={treasury} onChange={setTreasury} compact operation="payment" />
            </Field>
          )}
          {paymentSource === 'custody' && (
            <Field label="ملف العهدة المفتوح *">
              <QuickSelect value={custodyFileId} onChange={(e) => setCustodyFileId(e.target.value)} className={inputCls}>
                <option value="">— اختر ملف العهدة —</option>
                {custodyFiles.filter((f) => f.status === 'open').map((f) => {
                  const emp = employees.find((x) => x.id === f.employeeId)?.nameAr ?? '—'
                  const remaining = summarizeCustody(custodyTxs.filter((t) => t.fileId === f.id)).remainingMinor
                  return <option key={f.id} value={f.id}>{f.fileNumber} — {emp} (متبقٍ {fmt(remaining)})</option>
                })}
              </QuickSelect>
            </Field>
          )}

          <Field label="ملاحظات إضافية">
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
          </Field>

          <DocOutcome>
            الأثر: {bearer === 'customer'
              ? <>مديناً على <b>1104 العملاء</b> (يظهر في كشف حساب العميل وفاتورته)</>
              : <>مديناً على <b>5106 مصروفات نقلات</b> (تكلفة داخلية على الشركة لا تظهر للعميل)</>}
            {' '}ودائناً على <b>{paymentSource === 'cash' ? treasury : paymentSource === 'credit' ? '2113 مصروفات نقلات مستحقة' : '1108 عهد الموظفين'}</b>.
          </DocOutcome>

          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setOpen(false)}>إلغاء</Btn>
            <Btn onClick={save} shortcut="F9" disabled={!tripId || !nameAr.trim() || !unitAmount.trim()}>
              💾 حفظ المصروف وترحيل القيد
            </Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
