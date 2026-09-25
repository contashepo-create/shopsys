import { PartyQuickPicker, QuickSelect } from '../components/KeyboardPickers.tsx'
/**
 * مرتجعات الشراء (المرحلة 3) — عن فاتورة شراء أصلية:
 * تُقيَّم بالتكلفة النهائية للوحدة (بضاعة + نصيب مصاريف)، ولا تتجاوز
 * المتبقي القابل للإرجاع ولا المخزون الحالي (لا إرجاع لبضاعة بيعت).
 * الاسترداد: نقدي من المورد أو تخفيض دينه.
 */
import { useEffect, useMemo, useState } from 'react'
import { RotateCcw, Search, BookOpenText, Eye, Printer } from 'lucide-react'
import { useDataStore, type PurchaseInvoice, type PurchaseReturn } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor } from '../../core/money.ts'
import { remainingPurchaseByLine } from '../../core/purchases.ts'
import { partyCode } from '../../core/partyCodes.ts'
import { Btn, Field, Modal, inputCls, useToast, EmptyState, useUnsavedChangesGuard } from '../components/ui.tsx'
import { PartyQuickEditModal } from '../components/PartyQuickEditModal.tsx'
import { useSupervisorApproval } from '../components/SupervisorPinDialog.tsx'
import { TreasuryPicker } from '../components/TreasuryPicker.tsx'
import { ACCOUNT_NAMES } from './accountNames.ts'
import { buildSimpleDocModel } from '../../core/receipt.ts'
import { printModelWithTemplate } from '../print/printDoc.ts'
import { PrintTemplateModal } from '../components/PrintTemplateModal.tsx'

export function PurchaseReturnsPage() {
  const { purchases, purchaseReturns, suppliers, items, warehouses, journal, postPurchaseReturn, getSupplierBalance } = useDataStore()
  const { setup, receipt } = useAppStore()
  const toast = useToast()
  const cur = (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
  const fmt = (m: number) => formatMinor(m, cur, false)

  const [pickOpen, setPickOpen] = useState(false)
  const [pickQuery, setPickQuery] = useState('')
  const [pickIndex, setPickIndex] = useState(0)
  const [supplierFilterId, setSupplierFilterId] = useState(-2)
  const [purchase, setPurchase] = useState<PurchaseInvoice | null>(null)
  const [qtys, setQtys] = useState<Record<number, string>>({})
  const [returnWarehouses, setReturnWarehouses] = useState<Record<number, number>>({})
  const [refund, setRefund] = useState<'cash' | 'debt'>('cash')
  const [treasury, setTreasury] = useState('1101')
  const [reason, setReason] = useState('')
  const [viewing, setViewing] = useState<PurchaseReturn | null>(null)
  // طباعة إشعار مرتجع الشراء بقوالب الكاشير الثلاثة (طلب المالك)
  const [printTarget, setPrintTarget] = useState<PurchaseReturn | null>(null)
  const [partyEditorOpen, setPartyEditorOpen] = useState(false)
  const returnSignature = JSON.stringify({ qtys, returnWarehouses, refund, treasury, reason })
  const unsaved = useUnsavedChangesGuard(returnSignature)
  useEffect(() => { unsaved.markClean() }, [purchase?.id])
  const closePurchase = () => unsaved.requestClose(() => setPurchase(null))

  /** إشعار مدين للمورد: سطور بتكلفة الوحدة النهائية + المسترد نقداً/ديناً */
  const printPurchaseReturn = (r: PurchaseReturn, template: Parameters<typeof printModelWithTemplate>[3]) => {
    const orig = purchases.find((pv) => pv.id === r.purchaseId)
    const model = buildSimpleDocModel({
      docTitle: 'مرتجع مشتريات (إشعار مدين)',
      invoiceNumber: r.returnNumber,
      refCode: r.refCode ?? '',
      dateIso: r.date,
      partyLabel: orig ? supplierName(orig.supplierId) : 'مورد؟',
      paymentLabel: r.refund === 'cash' ? 'استرداد نقدي' : 'تخفيض من دين المورد',
      rows: r.lines.map((l) => ({
        nameAr: l.nameAr,
        qty: l.qty,
        unitPriceMinor: l.unitPriceMinor ?? l.landedUnitCostMinor,
        totalMinor: Math.round((l.unitPriceMinor ?? l.landedUnitCostMinor) * l.qty),
      })),
      totalMinor: r.supplierValueMinor ?? r.totalMinor,
      paidMinor: r.refund === 'cash' ? (r.supplierValueMinor ?? r.totalMinor) : 0,
      settings: receipt,
      extraFooter: r.reason ? `السبب: ${r.reason}` : undefined,
    })
    printModelWithTemplate(model, cur, receipt, template)
    toast.show(`أُرسل إشعار المرتجع ${r.returnNumber} للطباعة 🖨️`)
  }

  const entry = viewing ? journal.find((e) => e.id === viewing.journalEntryId) : null
  const supplierName = (id: number) => id === 0 ? 'مورد نقدي' : suppliers.find((s) => s.id === id)?.nameAr ?? `مورد #${id}`

  const remaining = useMemo(() => {
    if (!purchase) return [] as number[]
    const prior = purchaseReturns.filter((r) => r.purchaseId === purchase.id).flatMap((r) => r.lines)
    return remainingPurchaseByLine(purchase.lines, prior)
  }, [purchase, purchaseReturns])

  const supplierPickerInfo = (party: { id: number; active?: boolean }) => {
    const balance = getSupplierBalance(party.id)
    return { code: partyCode('SUP', party.id), balance: `الرصيد ${fmt(Math.abs(balance))} ${cur.symbol}` }
  }

  const pickable = useMemo(() => {
    const q = pickQuery.trim()
    return [...purchases].reverse().filter((p) => (supplierFilterId === -2 || p.supplierId === supplierFilterId) && (!q || p.invoiceNumber.includes(q) || (p.refCode ?? '').includes(q.toUpperCase()))).slice(0, 20)
  }, [purchases, pickQuery, supplierFilterId])

  /** الدين المتبقي غير المدفوع على الفاتورة المختارة (بعد مرتجعات الدين السابقة) */
  const unpaidDebt = useMemo(() => {
    if (!purchase) return 0
    // G4+N2: ما خُفض من الدين سابقاً = مستحق المورد عن البضاعة + حصة الضريبة المعكوسة (تطابق قيد 2101)
    const priorDebt = purchaseReturns
      .filter((r) => r.purchaseId === purchase.id && r.refund === 'debt')
      .reduce((a, r) => a + (r.supplierValueMinor ?? r.totalMinor) + (r.inputVatShareMinor ?? 0), 0)
    return Math.max(0, (purchase.supplierDueMinor ?? purchase.grandTotalMinor) - purchase.paidMinor - priorDebt)
  }, [purchase, purchaseReturns])

  const startReturn = (p: PurchaseInvoice) => {
    setPurchase(p)
    setQtys({})
    setReturnWarehouses({})
    setRefund((p.supplierDueMinor ?? p.grandTotalMinor) - p.paidMinor > 0 ? 'debt' : 'cash')
    setReason('')
    setPickOpen(false)
  }

  // قاعدة المالك المعممة: كل المرتجعات باعتماد مشرف — مرتجع الشراء يخرج بضاعة ويرد مالاً
  const approval = useSupervisorApproval()
  const submit = () => {
    if (!purchase) return
    approval.request((approvedBy) => {
    try {
      const lineSpecs = Object.entries(qtys).flatMap(([indexText, value]) => {
        const lineIndex = Number(indexText)
        const qty = Number(value)
        if (!(qty > 0)) return []
        const source = purchase.lines[lineIndex]
        const warehouseId = returnWarehouses[lineIndex] ?? source?.warehouseId ?? purchase.warehouseId ?? warehouses.find((warehouse) => warehouse.isMain)?.id ?? null
        return [{ lineIndex, qty, warehouseId }]
      })
      const ret = postPurchaseReturn({ purchaseId: purchase.id, lineSpecs, refund, reason: reason.trim(), treasury, approvedBy })
      toast.show(`تم مرتجع الشراء ${ret.returnNumber} — خرجت البضاعة وتولد القيد ✓`)
      setPurchase(null)
    } catch (e) {
      toast.show((e as Error).message, 'error')
    }
    })
  }

  const anyQty = Object.values(qtys).some((v) => Number(v) > 0)
  const itemName = (id: number) => { const item = items.find((it) => it.id === id); return `${item?.sku || item?.barcodes?.[0] || id} — ${item?.nameAr ?? `#${id}`}` }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between anim-up">
        <div className="text-sm text-slate-500">يُرجَع للمورد بتكلفة الوحدة النهائية من فاتورته — ولا يُرجَع ما بيع بالفعل</div>
        <Btn onClick={() => { setPickQuery(''); setSupplierFilterId(-2); setPickOpen(true) }} disabled={purchases.length === 0}>
          <RotateCcw size={15} /> مرتجع شراء جديد
        </Btn>
      </div>

      {purchaseReturns.length === 0 ? (
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800">
          <EmptyState icon="📤" title="لا مرتجعات شراء بعد" sub={purchases.length ? 'اضغط «مرتجع شراء جديد» واختر الفاتورة الأصلية' : 'لا فواتير شراء أصلاً'} />
        </div>
      ) : (
        <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-right text-[11px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                <th className="px-4 py-3 font-bold">المرتجع</th>
                <th className="px-4 py-3 font-bold">عن الفاتورة</th>
                <th className="px-4 py-3 font-bold">المورد</th>
                <th className="px-4 py-3 font-bold">الاسترداد</th>
                <th className="px-4 py-3 font-bold">القيمة</th>
                <th className="px-4 py-3 font-bold">القيد</th>
                <th className="px-4 py-3 font-bold"></th>
              </tr>
            </thead>
            <tbody>
              {[...purchaseReturns].reverse().map((r, i) => {
                const orig = purchases.find((p) => p.id === r.purchaseId)
                return (
                  <tr key={r.id} style={{ animationDelay: `${i * 30}ms` }} className="anim-in border-b border-slate-50 dark:border-slate-800/50 hover:bg-cyan-500/[0.03] transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-800 dark:text-white">{r.returnNumber}</div>
                      <div className="text-[11px] text-slate-400">{r.date.slice(0, 16).replace('T', ' ')}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{orig?.invoiceNumber ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{orig ? supplierName(orig.supplierId) : '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${r.refund === 'cash' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-cyan-500/10 text-cyan-600'}`}>
                        {r.refund === 'cash' ? '💵 استرداد نقدي' : '📉 تخفيض دين المورد'}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-black text-cyan-600">{fmt(r.totalMinor)}</td>
                    <td className="px-4 py-3">
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-600 font-bold flex items-center gap-1 w-fit">
                        <BookOpenText size={11} /> قيد #{r.journalEntryId}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-left">
                      <button onClick={() => setViewing(r)} className="p-2 rounded-lg text-slate-400 hover:text-cyan-600 hover:bg-cyan-500/10 transition-all duration-200 hover:scale-110">
                        <Eye size={15} />
                      </button>
                      <button onClick={() => setPrintTarget(r)} title="طباعة إشعار المرتجع — حراري/A4/A5" className="p-2 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-500/10 transition-all duration-200 hover:scale-110">
                        <Printer size={15} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* اختيار فاتورة الشراء */}
      <Modal open={pickOpen} onClose={() => setPickOpen(false)} title="اختر فاتورة الشراء الأصلية">
        <div className="space-y-3">
          <Field label="تصفية حسب المورد (اختياري)">
            <PartyQuickPicker
              parties={suppliers}
              value={supplierFilterId}
              onChange={(id) => { setSupplierFilterId(id); setPickIndex(0) }}
              cashValue={-2}
              cashLabel="كل الموردين"
              label="بحث المورد للمرتجع"
              partyInfo={supplierPickerInfo}
              onConfirm={() => requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[data-return-purchase-search]')?.focus())}
            />
          </Field>
          <div className="relative">
            <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input data-return-purchase-search value={pickQuery} onChange={(e) => { setPickQuery(e.target.value); setPickIndex(0) }} onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setPickIndex((i) => Math.min(pickable.length - 1, i + 1)) } else if (e.key === 'ArrowUp') { e.preventDefault(); setPickIndex((i) => Math.max(0, i - 1)) } else if (e.key === 'Enter') { e.preventDefault(); const selected = pickable[pickIndex] ?? pickable[0]; if (selected) startReturn(selected) } else if (e.key === 'Escape') setPickOpen(false) }} placeholder="رقم الفاتورة… P-0001" className={`${inputCls} pr-9`} autoFocus data-enter-native="true" />
          </div>
          <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
            {pickable.map((p, rowIndex) => (
              <button key={p.id} onClick={() => startReturn(p)} className={`w-full text-right px-3 py-2.5 transition-colors flex items-center justify-between gap-2 ${rowIndex === pickIndex ? 'bg-cyan-500/10 ring-1 ring-inset ring-cyan-500/30' : 'hover:bg-cyan-500/5'}`}>
                <span>
                  <b className="text-slate-800 dark:text-white">{p.invoiceNumber}</b>
                  {p.refCode && <span className="text-[10px] font-mono text-sky-600 dark:text-sky-400 mr-2" dir="ltr">{p.refCode}</span>}
                  <span className="text-[11px] text-slate-400 mr-2">{p.date.slice(0, 10)} · {supplierName(p.supplierId)}</span>
                </span>
                <b className="text-cyan-600">{fmt(p.grandTotalMinor)}</b>
              </button>
            ))}
            {pickable.length === 0 && <div className="text-center text-sm text-slate-400 py-6">لا نتائج</div>}
          </div>
        </div>
      </Modal>

      {/* نموذج المرتجع */}
      <Modal open={!!purchase} onClose={closePurchase} title={purchase ? `مرتجع عن فاتورة الشراء ${purchase.invoiceNumber}` : ''} wide>
        {purchase && (
          <div className="space-y-4">
            {purchase.supplierId > 0 && suppliers.find((row) => row.id === purchase.supplierId) && (() => { const supplier = suppliers.find((row) => row.id === purchase.supplierId)!; return <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-200 bg-sky-50/60 px-3 py-2 text-xs dark:border-sky-900/60 dark:bg-sky-950/20"><div className="flex flex-wrap items-center gap-2"><b>{supplier.nameAr}</b><span className="font-mono text-slate-500" dir="ltr">{partyCode('SUP', supplier.id)}</span><span>الرصيد: {fmt(Math.abs(getSupplierBalance(supplier.id)))} {cur.symbol}</span>{supplier.address && <span className="text-slate-500">{supplier.address}</span>}</div><button type="button" title="تعديل بيانات المورد" onClick={() => setPartyEditorOpen(true)} className="rounded-lg border border-sky-300 p-1.5 text-sky-700 hover:bg-sky-50 dark:border-sky-800 dark:text-sky-300">تعديل المورد</button></div> })()}
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-right text-[10px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                  <th className="px-3 py-2">الصنف</th>
                  <th className="px-3 py-2">المشترى</th>
                  <th className="px-3 py-2">التكلفة النهائية/وحدة</th>
                  <th className="px-3 py-2">المتبقي القابل للإرجاع</th>
                  <th className="px-3 py-2 w-28">كمية الإرجاع</th>
                </tr>
              </thead>
              <tbody>
                {purchase.lines.map((l, lineIndex) => {
                  const rem = remaining[lineIndex] ?? 0
                  const selectedWarehouseId = returnWarehouses[lineIndex] ?? l.warehouseId ?? purchase.warehouseId ?? warehouses.find((warehouse) => warehouse.isMain)?.id ?? null
                  return (
                    <tr key={lineIndex} data-entry-row className="border-b border-slate-50 dark:border-slate-800/50">
                      <td tabIndex={0} className="px-3 py-2 font-bold outline-none focus:ring-2 focus:ring-brand-500/40">{itemName(l.itemId)}</td>
                      <td className="px-3 py-2">{l.qty}</td>
                      <td className="px-3 py-2">{fmt(l.landedUnitCostMinor)}</td>
                      <td className={`px-3 py-2 font-bold ${rem > 0 ? 'text-cyan-600' : 'text-slate-300'}`}>{rem}</td>
                      <td className="px-3 py-2 space-y-1">
                        <input
                          value={qtys[lineIndex] ?? ''}
                          onChange={(e) => setQtys((q) => ({ ...q, [lineIndex]: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.currentTarget.closest('tr')?.nextElementSibling?.querySelector<HTMLElement>('td[tabindex="0"]'))?.focus() } }}
                          placeholder="0"
                          disabled={rem <= 0}
                          className={`${inputCls} text-center py-1.5 disabled:opacity-40`}
                        />
                        {warehouses.length > 0 && (l.warehouseId ?? purchase.warehouseId) == null && (
                          <QuickSelect
                            value={selectedWarehouseId ?? ''}
                            onChange={(e) => setReturnWarehouses((current) => ({ ...current, [lineIndex]: Number(e.target.value) }))}
                            disabled={rem <= 0}
                            title="المخزن الذي ستخرج منه البضاعة المرتجعة للمورد"
                            className="w-full rounded-lg border border-amber-200 dark:border-amber-800 bg-transparent px-1 py-1 text-[10px] font-bold text-amber-700 dark:text-amber-300"
                          >
                            {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.nameAr}{warehouse.id === (l.warehouseId ?? purchase.warehouseId) ? ' (مخزن الاستلام)' : ''}</option>)}
                          </QuickSelect>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setRefund('cash')}
                className={`p-3 rounded-2xl border-2 font-bold text-sm transition-all ${refund === 'cash' ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}
              >💵 استرداد نقدي من المورد</button>
              <button
                onClick={() => setRefund('debt')}
                disabled={unpaidDebt <= 0}
                className={`p-3 rounded-2xl border-2 font-bold text-sm transition-all disabled:opacity-40 ${refund === 'debt' ? 'border-cyan-500/60 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}
              >📉 تخفيض دين المورد {unpaidDebt > 0 ? `(المتبقي ${fmt(unpaidDebt)})` : '(مسددة بالكامل)'}</button>
            </div>
            {refund === 'cash' && <TreasuryPicker value={treasury} onChange={setTreasury} operation="receipt" compact />}

            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="سبب الإرجاع (اختياري): تالف، غير مطابق للمواصفات…" className={inputCls} />

            <div className="flex justify-end gap-2">
              <Btn variant="ghost" onClick={closePurchase}>تراجع عن المرتجع</Btn>
              <Btn onClick={submit} shortcut="F9" disabled={!anyQty}>📤 تنفيذ المرتجع</Btn>
            </div>
          </div>
        )}
      </Modal>
      {unsaved.prompt}
      <PartyQuickEditModal
        open={partyEditorOpen}
        target={purchase && purchase.supplierId > 0 ? (() => { const supplier = suppliers.find((row) => row.id === purchase.supplierId); return supplier ? { kind: 'supplier' as const, party: supplier } : null })() : null}
        currencyDecimals={cur.decimals}
        currencySymbol={cur.symbol}
        onClose={() => setPartyEditorOpen(false)}
      />

      {/* عرض مرتجع */}
      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing ? `المرتجع ${viewing.returnNumber}` : ''} wide>
        {viewing && (
          <div className="space-y-4">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-right text-[10px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                  <th className="px-3 py-2">الصنف</th><th className="px-3 py-2">كمية</th><th className="px-3 py-2">تكلفة/وحدة</th><th className="px-3 py-2">الإجمالي</th>
                </tr>
              </thead>
              <tbody>
                {viewing.lines.map((l, i) => (
                  <tr key={i} className="border-b border-slate-50 dark:border-slate-800/50">
                    <td className="px-3 py-2 font-bold">{l.nameAr}</td>
                    <td className="px-3 py-2">{l.qty}</td>
                    <td className="px-3 py-2">{fmt(l.landedUnitCostMinor)}</td>
                    <td className="px-3 py-2 font-bold">{fmt(Math.round(l.qty * l.landedUnitCostMinor))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {viewing.reason && <div className="text-[12px] text-slate-500">السبب: {viewing.reason}</div>}
            {entry && (
              <div className="rounded-2xl border border-rose-500/20 bg-rose-500/[0.03] overflow-hidden">
                <div className="px-4 py-2.5 text-[12px] font-bold text-rose-600 dark:text-rose-400 border-b border-rose-500/10 flex items-center gap-1.5">
                  <BookOpenText size={13} /> القيد المتولد #{entry.entryNumber}
                </div>
                <table className="w-full text-[12px]">
                  <tbody>
                    {entry.lines.map((l, i) => (
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
      {approval.dialog}

      {/* اختيار قالب طباعة إشعار مرتجع الشراء (حراري/A4/A5) */}
      <PrintTemplateModal
        open={printTarget != null}
        onClose={() => setPrintTarget(null)}
        defaultTemplate={receipt.defaultTemplate}
        title="🖨️ طباعة إشعار مرتجع الشراء"
        onPrint={(t) => { if (printTarget) printPurchaseReturn(printTarget, t) }}
      />
    </div>
  )
}
