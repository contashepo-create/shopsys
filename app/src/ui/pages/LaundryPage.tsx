/**
 * المغسلة (وحدة مستقلة — طلب المالك): أوامر غسيل بقطع مفصلة وخدمة لكل قطعة،
 * عربون عند الاستلام (2109 التزام)، وتحقق الإيراد عند التسليم (4103 + 2102).
 * حالات: مستلَم ← جاري التجهيز ← جاهز ← مُسلَّم / ملغي (يرد العربون).
 */
import { useMemo, useState } from 'react'
import { Plus, Shirt, TrendingUp, Trash2, Printer, BookOpenText } from 'lucide-react'
import { useDataStore, type LaundryOrder } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry, phonePlaceholder } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import {
  LAUNDRY_SERVICE_LABELS, LAUNDRY_STATUS_LABELS, LAUNDRY_TRANSITIONS, laundryTotal, laundryReport,
  type LaundryService, type LaundryStatus,
} from '../../core/laundry.ts'
import { Btn, Field, inputCls, Modal, useToast, EmptyState } from '../components/ui.tsx'
import { TreasuryPicker } from '../components/TreasuryPicker.tsx'
import { TerminalPaymentPicker, type TerminalPaymentDraft } from '../components/TerminalPaymentPicker.tsx'
import { ServiceRefundBox } from '../components/ServiceRefundBox.tsx'
import { printHtml } from '../print/printReceipt.ts'
import { renderReportShell } from '../../core/reportPrint.ts'

const STATUS_STYLE: Record<LaundryStatus, string> = {
  received: 'bg-sky-500/10 text-sky-600',
  processing: 'bg-amber-500/10 text-amber-600',
  ready: 'bg-violet-500/10 text-violet-600',
  delivered: 'bg-emerald-500/10 text-emerald-600',
  cancelled: 'bg-slate-500/10 text-slate-500',
}

interface DraftLine { desc: string; service: LaundryService; qty: string; price: string }

export function LaundryPage() {
  const { laundryOrders, customers, journal, paymentTerminals, paymentTerminalTransactions, openLaundryOrder, setLaundryStatus, deliverLaundryOrder, cancelLaundryOrder, refundLaundryOrder, setLaundryRack } = useDataStore()
  const { setup, reportPrint, receipt } = useAppStore()
  const toast = useToast()
  const cur = useMemo(
    () => (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' },
    [setup.countryCode],
  )
  const fmt = (m: number) => formatMinor(m, cur, false)
  const toM = (v: string) => (v.trim() ? toMinor(v, cur.decimals) : 0)

  const [tab, setTab] = useState<'list' | 'report'>('list')
  const report = useMemo(() => laundryReport(laundryOrders), [laundryOrders])

  /* ─── أمر جديد ─── */
  const [open, setOpen] = useState(false)
  const [customerId, setCustomerId] = useState('')
  const [custName, setCustName] = useState('')
  const [phone, setPhone] = useState('')
  const [promisedAt, setPromisedAt] = useState('')
  const [prepaid, setPrepaid] = useState('')
  const [rack, setRack] = useState('') // رقم الرف/الشماعة (نمط CleanCloud rack number)
  const [treasury, setTreasury] = useState('1101')
  const [notes, setNotes] = useState('')
  const [dLines, setDLines] = useState<DraftLine[]>([{ desc: '', service: 'wash_iron', qty: '1', price: '' }])

  const openNew = () => {
    setCustomerId(''); setCustName(''); setPhone(''); setPrepaid(''); setRack(''); setNotes('')
    setPromisedAt(new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10))
    setDLines([{ desc: '', service: 'wash_iron', qty: '1', price: '' }])
    setOpen(true)
  }

  const parsedLines = useMemo(
    () => dLines
      .filter((l) => l.desc.trim())
      .map((l) => ({ desc: l.desc.trim(), service: l.service, qty: Math.max(1, Math.round(Number(l.qty) || 1)), unitPriceMinor: toM(l.price) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dLines, cur.decimals],
  )
  const draftTotal = useMemo(() => laundryTotal(parsedLines), [parsedLines])

  const save = () => {
    try {
      const o = openLaundryOrder({
        customerId: customerId ? Number(customerId) : null,
        customerName: customerId ? (customers.find((c) => c.id === Number(customerId))?.nameAr ?? '') : custName,
        phone, promisedAt, rackNumber: rack, lines: parsedLines,
        prepaidMinor: toM(prepaid), treasury: treasury as '1101', notes,
      })
      toast.show(`فُتح أمر الغسيل ${o.orderNumber} ✅${o.prepaidMinor > 0 ? ' وتولد قيد العربون' : ''}`)
      setOpen(false)
    } catch (err) { toast.show((err as Error).message, 'error') }
  }

  /* ─── عرض/تسليم/إلغاء ─── */
  const [viewingId, setViewingId] = useState<number | null>(null)
  const viewing = viewingId != null ? laundryOrders.find((o) => o.id === viewingId) : null
  const viewingTerminalCharge = viewing ? paymentTerminalTransactions.find((row) => row.kind === 'charge' && row.documentType === 'laundry' && row.documentId === String(viewing.id)) : undefined
  const [deliverTreasury, setDeliverTreasury] = useState('1101')
  const [deliverTerminal, setDeliverTerminal] = useState<TerminalPaymentDraft>({ terminalId: '', providerReference: '', cardLast4: '' })
  const viewingEntries = viewing
    ? journal.filter((e) => [viewing.prepaidEntryId, viewing.deliverEntryId, viewing.cancelEntryId, ...(viewing.refunds ?? []).map((r) => r.journalEntryId)].includes(e.id))
    : []


  const move = (o: LaundryOrder, to: LaundryStatus) => {
    try {
      if (to === 'delivered') {
        const terminal = paymentTerminals.find((row) => row.id === deliverTerminal.terminalId)
        if (terminal && !deliverTerminal.providerReference.trim()) throw new Error('مرجع إيصال ماكينة الدفع مطلوب')
        const u = deliverLaundryOrder({ orderId: o.id, treasury: (terminal?.settlementAccountCode ?? deliverTreasury) as '1101', terminalPayment: terminal ? { terminalId: terminal.id, providerReference: deliverTerminal.providerReference.trim(), cardLast4: deliverTerminal.cardLast4 || undefined } : undefined })
        toast.show(`سُلِّم ${u.orderNumber} وتولد قيد الإيراد — المحصَّل ${fmt(u.grandMinor - u.prepaidMinor)} ${cur.symbol} ✅`)
        setViewingId(u.id)
      } else if (to === 'cancelled') {
        const u = cancelLaundryOrder(o.id)
        toast.show(`أُلغي ${u.orderNumber}${o.prepaidMinor > 0 ? ' ورُد العربون بقيد' : ''} ✓`)
        setViewingId(u.id)
      } else {
        const u = setLaundryStatus(o.id, to)
        toast.show(`${u.orderNumber} الآن «${LAUNDRY_STATUS_LABELS[to]}»`)
        setViewingId(u.id)
      }
    } catch (err) { toast.show((err as Error).message, 'error') }
  }

  /** إيصال استلام للعميل — يطبع القطع والعربون وموعد التسليم */
  const printTicket = (o: LaundryOrder) => {
    const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    printHtml(renderReportShell({
      title: `إيصال استلام غسيل ${o.orderNumber}`,
      subtitle: `${o.customerName}${o.phone ? ` — ${o.phone}` : ''} · استُلم ${o.receivedAt.slice(0, 10)}${o.promisedAt ? ` · التسليم ${o.promisedAt}` : ''}${o.rackNumber ? ` · 📍 رف ${o.rackNumber}` : ''}`,
      companyName: setup.shopName || 'المغسلة',
      logoDataUrl: receipt.logoDataUrl,
      settings: reportPrint,
      bodyHtml: `<table><thead><tr><th>القطعة</th><th>الخدمة</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead><tbody>
        ${o.lines.map((l) => `<tr><td>${esc(l.desc)}</td><td>${LAUNDRY_SERVICE_LABELS[l.service].icon} ${LAUNDRY_SERVICE_LABELS[l.service].nameAr}</td><td class="num">${l.qty}</td><td class="num">${fmt(l.unitPriceMinor)}</td><td class="num">${fmt(l.unitPriceMinor * l.qty)}</td></tr>`).join('')}
        <tr class="total"><td colspan="4">الإجمالي</td><td class="num">${fmt(o.totalMinor)}</td></tr>
        ${o.prepaidMinor > 0 ? `<tr><td colspan="4">العربون المدفوع</td><td class="num">${fmt(o.prepaidMinor)}</td></tr><tr class="total"><td colspan="4">المتبقي عند الاستلام</td><td class="num">${fmt(o.totalMinor - o.prepaidMinor)}</td></tr>` : ''}
      </tbody></table>`,
    }))
  }

  const card = 'rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800'
  const tabCls = (t: 'list' | 'report') =>
    `px-4 py-2 rounded-xl text-[13px] font-bold transition-all ${tab === t ? 'bg-sky-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'}`
  const setLine = (i: number, patch: Partial<DraftLine>) => setDLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))

  return (
    <div className="space-y-4">
      <div className="anim-up flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-1">
          <button onClick={() => setTab('list')} className={tabCls('list')}><Shirt size={14} className="inline -mt-0.5 me-1" /> الأوامر ({laundryOrders.length})</button>
          <button onClick={() => setTab('report')} className={tabCls('report')}><TrendingUp size={14} className="inline -mt-0.5 me-1" /> تقرير المغسلة</button>
        </div>
        <Btn onClick={openNew}><Plus size={15} /> أمر غسيل جديد</Btn>
      </div>

      {tab === 'list' && (
        laundryOrders.length === 0 ? (
          <div className={card}>
            <EmptyState icon="🧺" title="لا أوامر غسيل بعد" sub="افتح أمراً لكل عميل: قطع مفصلة وخدمة لكل قطعة وعربون اختياري — والإيراد يتحقق محاسبياً عند التسليم" />
          </div>
        ) : (
          <div className={`anim-up ${card} overflow-hidden`}>
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-right text-[11px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                  <th className="px-4 py-3 font-bold">الأمر</th>
                  <th className="px-4 py-3 font-bold">العميل</th>
                  <th className="px-4 py-3 font-bold">القطع</th>
                  <th className="px-4 py-3 font-bold">الإجمالي</th>
                  <th className="px-4 py-3 font-bold">العربون</th>
                  <th className="px-4 py-3 font-bold">التسليم الموعود</th>
                  <th className="px-4 py-3 font-bold">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {[...laundryOrders].reverse().map((o) => {
                  const overdue = o.promisedAt && o.status !== 'delivered' && o.status !== 'cancelled' && o.promisedAt < new Date().toISOString().slice(0, 10)
                  return (
                    <tr key={o.id} onClick={() => { setViewingId(o.id); setDeliverTreasury('1101') }} className="border-b border-slate-50 dark:border-slate-800/50 hover:bg-sky-500/[0.03] transition-colors cursor-pointer">
                      <td className="px-4 py-3 font-bold text-slate-700 dark:text-slate-200">{o.orderNumber}</td>
                      <td className="px-4 py-3">
                        <div className="text-slate-600 dark:text-slate-300">{o.customerName}</div>
                        {o.phone && <div className="text-[10px] text-slate-400" dir="ltr">{o.phone}</div>}
                      </td>
                      <td className="px-4 py-3 text-slate-500">{o.lines.reduce((a, l) => a + l.qty, 0)} قطعة{o.rackNumber ? <span className="mr-1 text-[10px] font-bold text-violet-500">📍 {o.rackNumber}</span> : null}</td>
                      <td className="px-4 py-3 font-black">{fmt(o.totalMinor)}</td>
                      <td className="px-4 py-3 text-emerald-600">{o.prepaidMinor > 0 ? fmt(o.prepaidMinor) : '—'}</td>
                      <td className={`px-4 py-3 text-[12px] ${overdue ? 'text-rose-500 font-bold' : 'text-slate-500'}`} dir="ltr">{o.promisedAt || '—'}{overdue ? ' ⚠' : ''}</td>
                      <td className="px-4 py-3"><span className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${STATUS_STYLE[o.status]}`}>{LAUNDRY_STATUS_LABELS[o.status]}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      {tab === 'report' && (
        <div className={`anim-up ${card} overflow-hidden`}>
          <div className="px-4 py-3 flex items-center justify-between border-b border-slate-100 dark:border-slate-800">
            <div className="text-[12px] font-extrabold text-slate-600 dark:text-slate-300">إيراد الأوامر المُسلَّمة حسب الخدمة — {report.openOrders} أمر مفتوح</div>
            <div className="text-[12px] font-black text-emerald-600">{fmt(report.totalRevenueMinor)} {cur.symbol} · {report.totalPieces} قطعة</div>
          </div>
          {report.rows.length === 0 ? (
            <div className="text-center text-slate-400 text-[12px] py-8">لا أوامر مُسلَّمة بعد</div>
          ) : (
            <table className="w-full text-[12.5px]">
              <tbody>
                {report.rows.map((r) => (
                  <tr key={r.service} className="border-b border-slate-50 dark:border-slate-800/50">
                    <td className="px-4 py-2.5 font-bold text-slate-700 dark:text-slate-200">{LAUNDRY_SERVICE_LABELS[r.service].icon} {LAUNDRY_SERVICE_LABELS[r.service].nameAr}</td>
                    <td className="px-4 py-2.5 text-slate-500">{r.pieces} قطعة</td>
                    <td className="px-4 py-2.5 font-black text-emerald-600 text-left">{fmt(r.revenueMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* أمر جديد */}
      <Modal open={open} onClose={() => setOpen(false)} title="🧺 أمر غسيل جديد" wide>
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="عميل مسجل (اختياري)">
              <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={inputCls}>
                <option value="">عميل نقدي عابر</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.nameAr}</option>)}
              </select>
            </Field>
            {!customerId && (
              <Field label="اسم العميل">
                <input value={custName} onChange={(e) => setCustName(e.target.value)} className={inputCls} placeholder="اختياري" />
              </Field>
            )}
            <Field label="الهاتف">
              <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} dir="ltr" placeholder={phonePlaceholder(useAppStore.getState().setup.countryCode)} />
            </Field>
            <Field label="موعد التسليم الموعود">
              <input type="date" value={promisedAt} onChange={(e) => setPromisedAt(e.target.value)} className={inputCls} dir="ltr" />
            </Field>
            <Field label="رقم الرف / الشماعة" hint="أين تُعلَّق القطع بعد التجهيز — يظهر على الإيصال">
              <input value={rack} onChange={(e) => setRack(e.target.value)} className={inputCls} placeholder="A-12" />
            </Field>
          </div>

          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="grid grid-cols-[1fr_9rem_4.5rem_6rem_2rem] gap-2 px-3 py-2 text-[10px] font-bold text-slate-400 bg-slate-50 dark:bg-slate-900/40">
              <span>القطعة</span><span>الخدمة</span><span className="text-center">كمية</span><span className="text-center">سعر القطعة</span><span></span>
            </div>
            {dLines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_9rem_4.5rem_6rem_2rem] gap-2 items-center px-3 py-2 border-t border-slate-100 dark:border-slate-800">
                <input value={l.desc} onChange={(e) => setLine(i, { desc: e.target.value })} className={`${inputCls} py-1.5`} placeholder="قميص، بدلة، سجادة 2×3…" />
                <select value={l.service} onChange={(e) => setLine(i, { service: e.target.value as LaundryService })} className={`${inputCls} py-1.5 text-[12px]`}>
                  {(Object.keys(LAUNDRY_SERVICE_LABELS) as LaundryService[]).map((sv) => (
                    <option key={sv} value={sv}>{LAUNDRY_SERVICE_LABELS[sv].icon} {LAUNDRY_SERVICE_LABELS[sv].nameAr}</option>
                  ))}
                </select>
                <input value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} className={`${inputCls} py-1.5 text-center`} dir="ltr" />
                <input value={l.price} onChange={(e) => setLine(i, { price: e.target.value })} className={`${inputCls} py-1.5 text-center`} dir="ltr" placeholder="0" />
                <button onClick={() => setDLines((ls) => ls.filter((_, j) => j !== i))} disabled={dLines.length <= 1} className="text-slate-300 hover:text-rose-500 disabled:opacity-30 transition-colors justify-self-center">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <button onClick={() => setDLines((ls) => [...ls, { desc: '', service: 'wash_iron', qty: '1', price: '' }])} className="w-full py-2 text-[12px] font-bold text-sky-600 hover:bg-sky-500/5 transition-colors border-t border-slate-100 dark:border-slate-800 flex items-center justify-center gap-1">
              <Plus size={13} /> قطعة أخرى
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr] gap-3 items-end">
            <Field label={`العربون المقبوض الآن (${cur.symbol})`} hint="يقيَّد كدفعة مقدمة (2109) — الإيراد يتحقق عند التسليم">
              <input value={prepaid} onChange={(e) => setPrepaid(e.target.value)} className={inputCls} dir="ltr" placeholder="0" />
            </Field>
            {toM(prepaid) > 0 && (
              <Field label="قبض العربون في">
                <TreasuryPicker value={treasury} onChange={setTreasury} compact />
              </Field>
            )}
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3 text-[12px] flex items-center justify-between">
              <span className="text-slate-500">إجمالي الأمر</span>
              <b className="text-emerald-600 text-base">{fmt(draftTotal)} {cur.symbol}</b>
            </div>
          </div>
          <Field label="ملاحظات">
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} placeholder="بقعة على الكم، زر مفقود…" />
          </Field>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setOpen(false)}>إلغاء</Btn>
            <Btn onClick={save} disabled={parsedLines.length === 0}>💾 فتح الأمر{toM(prepaid) > 0 ? ' وقيد العربون' : ''}</Btn>
          </div>
        </div>
      </Modal>

      {/* عرض أمر */}
      <Modal open={!!viewing} onClose={() => setViewingId(null)} title={viewing ? `${viewing.orderNumber} — ${viewing.customerName}` : ''} wide>
        {viewing && (
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className={`text-[12px] px-3 py-1 rounded-full font-bold ${STATUS_STYLE[viewing.status]}`}>{LAUNDRY_STATUS_LABELS[viewing.status]}</span>
              <button onClick={() => printTicket(viewing)} className="px-3 py-1.5 rounded-lg text-[12px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-sky-600 transition-all flex items-center gap-1.5">
                <Printer size={13} /> طباعة إيصال الاستلام
              </button>
            </div>

            {viewing.status !== 'delivered' && viewing.status !== 'cancelled' && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold text-slate-400 shrink-0">📍 رقم الرف</span>
                <input
                  defaultValue={viewing.rackNumber ?? ''}
                  key={viewing.id}
                  onBlur={(e) => {
                    const v = e.target.value.trim()
                    if (v === (viewing.rackNumber ?? '')) return
                    try { setLaundryRack(viewing.id, v); toast.show(v ? `الرف الآن ${v} ✓` : 'أُزيل رقم الرف ✓') }
                    catch (err) { toast.show((err as Error).message, 'error') }
                  }}
                  className={`${inputCls} max-w-[10rem]`} placeholder="A-12"
                />
              </div>
            )}

            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              <table className="w-full text-[12.5px]">
                <tbody>
                  {viewing.lines.map((l, i) => (
                    <tr key={i} className="border-b border-slate-50 dark:border-slate-800/50">
                      <td className="px-3 py-2 font-bold text-slate-700 dark:text-slate-200">{l.desc}</td>
                      <td className="px-3 py-2 text-slate-500">{LAUNDRY_SERVICE_LABELS[l.service].icon} {LAUNDRY_SERVICE_LABELS[l.service].nameAr}</td>
                      <td className="px-3 py-2 text-slate-500">× {l.qty}</td>
                      <td className="px-3 py-2 font-bold text-left">{fmt(l.unitPriceMinor * l.qty)}</td>
                    </tr>
                  ))}
                  <tr className="bg-slate-50 dark:bg-slate-900/40">
                    <td colSpan={3} className="px-3 py-2 font-black">الإجمالي{viewing.prepaidMinor > 0 ? ` (عربون ${fmt(viewing.prepaidMinor)})` : ''}</td>
                    <td className="px-3 py-2 font-black text-left text-emerald-600">{fmt(viewing.totalMinor)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {LAUNDRY_TRANSITIONS[viewing.status].length > 0 && (
              <div className="space-y-2">
                {LAUNDRY_TRANSITIONS[viewing.status].includes('delivered') && (
                  <Field label="التحصيل في" hint={`المتبقي المتوقع ${fmt(Math.max(0, viewing.totalMinor - viewing.prepaidMinor))} ${cur.symbol} + الضريبة إن كانت مضافة`}>
                    <div className="space-y-2"><TerminalPaymentPicker value={deliverTerminal} onChange={setDeliverTerminal}/>{!deliverTerminal.terminalId && <TreasuryPicker value={deliverTreasury} onChange={setDeliverTreasury} compact />}</div>
                  </Field>
                )}
                <div className="flex flex-wrap gap-2">
                  {LAUNDRY_TRANSITIONS[viewing.status].map((to) => (
                    <button
                      key={to}
                      onClick={() => move(viewing, to)}
                      className={`px-4 py-2.5 rounded-xl border-2 font-bold text-[13px] transition-all ${
                        to === 'delivered' ? 'border-emerald-500/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/5'
                        : to === 'cancelled' ? 'border-rose-500/30 text-rose-600 hover:bg-rose-500/5'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      {to === 'delivered' ? '💰 تسليم وتحصيل (يولد قيد الإيراد)' : to === 'cancelled' ? `🚫 إلغاء${viewing.prepaidMinor > 0 ? ' ورد العربون' : ''}` : `${LAUNDRY_STATUS_LABELS[to]} ←`}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {viewing.status === 'delivered' && (
              <ServiceRefundBox
                grandMinor={viewing.grandMinor}
                refundedMinor={viewing.refundedMinor ?? 0}
                currencySymbol={cur.symbol}
                fmt={fmt}
                allowCredit={viewing.customerId != null}
                creditLabel="حساب العميل"
                hint="عميل غير راضٍ؟ اختر القطع المتضررة (بقع لم تُزل/قطعة تالفة) — يعكس الإيراد وحصة الضريبة بقيد تلقائي، لا مخزون يتحرك."
                terminalOriginal={viewingTerminalCharge ? { transactionId: viewingTerminalCharge.id, terminalName: paymentTerminals.find((row) => row.id === viewingTerminalCharge.terminalId)?.nameAr ?? viewingTerminalCharge.terminalId } : undefined}
                refundableItems={viewing.lines.map((l, li) => ({ key: `line:${li}`, label: `${l.desc} — ${LAUNDRY_SERVICE_LABELS[l.service]?.nameAr ?? l.service}`, valueMinor: Math.round(l.qty * l.unitPriceMinor), qty: l.qty }))}
                onSubmit={(a) => {
                  try {
                    const u = refundLaundryOrder({ orderId: viewing.id, amountMinor: a.amountMinor, mode: a.mode, treasury: viewingTerminalCharge ? (paymentTerminals.find((row) => row.id === viewingTerminalCharge.terminalId)?.settlementAccountCode ?? a.treasury) : a.treasury, reason: a.reason, approvedBy: a.approvedBy, terminalRefund: a.terminalRefund })
                    toast.show(`سُجل مرتجع خدمة ${u.orderNumber} بقيمة ${fmt(a.amountMinor)} ${cur.symbol} وتولد القيد العاكس ✅`)
                  } catch (err) { toast.show((err as Error).message, 'error') }
                }}
              />
            )}

            {viewingEntries.map((entry) => (
              <div key={entry.id} className="rounded-2xl border border-sky-500/20 bg-sky-500/[0.03] overflow-hidden">
                <div className="px-4 py-2.5 text-[12px] font-bold text-sky-600 dark:text-sky-400 border-b border-sky-500/10 flex items-center gap-1.5">
                  <BookOpenText size={13} /> قيد #{entry.entryNumber} — {entry.description}
                </div>
                <table className="w-full text-[12px]">
                  <tbody>
                    {entry.lines.map((l, i) => (
                      <tr key={i} className="border-t border-sky-500/5">
                        <td className="px-4 py-1.5 text-slate-600 dark:text-slate-300">{l.debit > 0 ? '' : '\u00A0\u00A0\u00A0\u00A0إلى '} {l.note ?? l.accountCode}</td>
                        <td className="px-4 py-1.5 w-28 font-bold">{l.debit > 0 ? fmt(l.debit) : ''}</td>
                        <td className="px-4 py-1.5 w-28 font-bold text-slate-400">{l.credit > 0 ? fmt(l.credit) : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  )
}
