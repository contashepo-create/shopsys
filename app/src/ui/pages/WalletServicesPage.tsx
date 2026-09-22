/**
 * خدمات المحافظ والدفع الإلكتروني (طلب المالك — نمط mobileshop حرفياً):
 * تحويل رصيد/دفع فواتير/شحن بمزوّدين، الربح = المحصَّل − المدفوع للمزوّد
 * (مشتق آلياً لا يُدخل)، أصل الاستلام مستقل عن أصل التمويل، آجل على
 * عميل مسجل، ضريبة بلد المنشأة على الهامش، ومرتجع بقيد عاكس.
 */
import { useMemo, useState } from 'react'
import { Smartphone, Plus, RotateCcw, BookOpenText, Wallet2 } from 'lucide-react'
import { useDataStore, type WalletServiceOp } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry, phonePlaceholder } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { WALLET_SERVICE_TYPES, WALLET_PROVIDERS, walletSummary, type WalletServiceType, type WalletProvider } from '../../core/walletServices.ts'
import { Btn, Field, inputCls, Modal, useToast, EmptyState } from '../components/ui.tsx'
import { useSupervisorApproval } from '../components/SupervisorPinDialog.tsx'
import { CreditLimitError } from '../../core/pos.ts'
import { TreasuryPicker } from '../components/TreasuryPicker.tsx'
import { TerminalPaymentPicker, type TerminalPaymentDraft } from '../components/TerminalPaymentPicker.tsx'
import { ACCOUNT_NAMES } from './accountNames.ts'

export function WalletServicesPage() {
  const { walletOps, customers, journal, paymentTerminals, paymentTerminalTransactions, postWalletService, returnWalletService } = useDataStore()
  const { setup } = useAppStore()
  const toast = useToast()
  const approval = useSupervisorApproval() // موافقة المشرف على مرتجع خدمة المحافظ
  // خدمة آجلة فوق حد ائتمان العميل — تجاوز باعتماد مدير
  const creditApproval = useSupervisorApproval('sales.credit.override')
  const cur = (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
  const fmt = (m: number) => formatMinor(m, cur, false)

  const [open, setOpen] = useState(false)
  const [viewing, setViewing] = useState<WalletServiceOp | null>(null)
  const [type, setType] = useState<WalletServiceType>('balance_transfer')
  const [provider, setProvider] = useState<WalletProvider>('vodafone')
  const [targetPhone, setTargetPhone] = useState('')
  const [paidToProvider, setPaidToProvider] = useState('')
  const [charge, setCharge] = useState('')
  const [paid, setPaid] = useState('')
  const [customerId, setCustomerId] = useState(0)
  const [funding, setFunding] = useState('1101')
  const [receive, setReceive] = useState('1101')
  const [terminalPayment, setTerminalPayment] = useState<TerminalPaymentDraft>({ terminalId: '', providerReference: '', cardLast4: '' })
  const [taxable, setTaxable] = useState(false) // أغلب خدمات المحافظ معفاة — اختياري حسب بلد/نشاط
  const [notes, setNotes] = useState('')

  const summary = useMemo(() => walletSummary(walletOps), [walletOps])
  const profitPreview = useMemo(() => {
    const c = toMinor(charge || '0', cur.decimals)
    const p = toMinor(paidToProvider || '0', cur.decimals)
    return c > 0 && p > 0 ? c - p : null
  }, [charge, paidToProvider, cur.decimals])

  const save = (creditLimitOverrideBy?: string) => {
    try {
      const terminal = paymentTerminals.find((row) => row.id === terminalPayment.terminalId)
      if (terminal && !terminalPayment.providerReference.trim()) throw new Error('مرجع إيصال ماكينة الدفع مطلوب')
      const chargeMinor = toMinor(charge || '0', cur.decimals)
      const op = postWalletService({
        type, provider, targetPhone,
        paidToProviderMinor: toMinor(paidToProvider || '0', cur.decimals),
        chargeMinor,
        paidMinor: paid === '' ? chargeMinor : toMinor(paid || '0', cur.decimals),
        customerId: customerId || null,
        fundingTreasury: funding,
        receiveTreasury: terminal?.settlementAccountCode ?? receive,
        terminalPayment: terminal ? { terminalId: terminal.id, providerReference: terminalPayment.providerReference.trim(), cardLast4: terminalPayment.cardLast4 || undefined } : undefined,
        vatPercent: taxable ? setup.vatPercent : 0,
        notes,
        creditLimitOverrideBy: creditLimitOverrideBy ?? null,
      })
      toast.show(`سُجلت ${op.opNumber} — الربح ${fmt(op.totals.profitGrossMinor)} محسوب آلياً ✓`)
      setOpen(false); setTargetPhone(''); setPaidToProvider(''); setCharge(''); setPaid(''); setCustomerId(0); setNotes('')
    } catch (e) {
      if (e instanceof CreditLimitError) { creditApproval.request((by) => save(by ?? 'المشرف')); return }
      toast.show((e as Error).message, 'error')
    }
  }

  const doReturn = (op: WalletServiceOp) => {
    const originalTerminal = paymentTerminalTransactions.find((row) => row.kind === 'charge' && row.documentType === 'wallet_service' && row.documentId === String(op.id))
    const refundReference = originalTerminal ? window.prompt('أدخل مرجع refund من إيصال ماكينة الدفع')?.trim() : undefined
    if (originalTerminal && !refundReference) return
    approval.request((approvedBy) => {
    try {
      returnWalletService(op.id, 'مرتجع من الشاشة', approvedBy, originalTerminal ? { originalTransactionId: originalTerminal.id, providerReference: refundReference! } : undefined)
      toast.show(`ارتجعت ${op.opNumber} بقيد عاكس كامل ✓${approvedBy ? ` (اعتمده «${approvedBy}»)` : ''}`)
    } catch (e) { toast.show((e as Error).message, 'error') }
    })
  }

  const typeName = (t: string) => WALLET_SERVICE_TYPES.find((x) => x.id === t)?.nameAr ?? t
  const providerName = (p: string) => WALLET_PROVIDERS.find((x) => x.id === p)?.nameAr ?? p

  return (
    <div className="space-y-4">
      {/* ملخص */}
      <div className="anim-up grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-4">
          <div className="text-[11px] text-slate-400 font-bold">عمليات مسجلة</div>
          <div className="text-2xl font-black text-slate-800 dark:text-white mt-1">{summary.count}</div>
        </div>
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-4">
          <div className="text-[11px] text-slate-400 font-bold">إجمالي المحصَّل</div>
          <div className="text-2xl font-black text-sky-600 mt-1">{fmt(summary.chargeMinor)}</div>
        </div>
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-4">
          <div className="text-[11px] text-slate-400 font-bold">صافي ربح الخدمات</div>
          <div className={`text-2xl font-black mt-1 ${summary.profitMinor >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{fmt(summary.profitMinor)}</div>
        </div>
      </div>

      <div className="anim-up flex items-center justify-between flex-wrap gap-2">
        <p className="text-[11.5px] text-slate-400">
          💡 الربح يُحسب آلياً: المحصَّل من العميل − المدفوع للمزوّد. استلام الكاش في درجك وتمويل التحويل من محفظتك — لكلٍ خزينته المستقلة.
        </p>
        <Btn onClick={() => setOpen(true)}><Plus size={15} /> عملية جديدة</Btn>
      </div>

      {walletOps.length === 0 ? (
        <EmptyState icon="📲" title="لا عمليات محافظ بعد" sub="تحويل رصيد، دفع فواتير، شحن، إنستاباي وفوري — كلها من هنا بقيد محاسبي فوري" />
      ) : (
        <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-right text-[10px] text-slate-400 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
                <th className="px-4 py-2.5">العملية</th>
                <th className="px-4 py-2.5">النوع / المزوّد</th>
                <th className="px-4 py-2.5">الوجهة</th>
                <th className="px-4 py-2.5">مدفوع للمزوّد</th>
                <th className="px-4 py-2.5">المحصَّل</th>
                <th className="px-4 py-2.5">الربح</th>
                <th className="px-4 py-2.5">الحالة</th>
                <th className="px-4 py-2.5 w-24"></th>
              </tr>
            </thead>
            <tbody>
              {[...walletOps].reverse().map((op) => (
                <tr key={op.id} className={`border-b border-slate-50 dark:border-slate-800/50 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors ${op.status === 'returned' ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-2.5">
                    <div className="font-bold text-slate-800 dark:text-white">{op.opNumber}</div>
                    <div className="text-[10px] text-slate-400">{op.date}</div>
                  </td>
                  <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">{typeName(op.type)} · {providerName(op.provider)}</td>
                  <td className="px-4 py-2.5 font-mono text-[11px]" dir="ltr">{op.targetPhone}</td>
                  <td className="px-4 py-2.5">{fmt(op.paidToProviderMinor)}</td>
                  <td className="px-4 py-2.5 font-bold">{fmt(op.chargeMinor)}</td>
                  <td className={`px-4 py-2.5 font-black ${op.totals.profitGrossMinor >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{fmt(op.totals.profitGrossMinor)}</td>
                  <td className="px-4 py-2.5">
                    {op.status === 'returned'
                      ? <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-500 font-bold">مرتجعة</span>
                      : <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 font-bold">تمت</span>}
                  </td>
                  <td className="px-4 py-2.5 text-left whitespace-nowrap">
                    <button onClick={() => setViewing(op)} title="عرض القيد" className="p-2 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-500/10 transition-all">
                      <BookOpenText size={14} />
                    </button>
                    {op.status === 'done' && (
                      <button onClick={() => doReturn(op)} title="مرتجع — يعكس القيد كاملاً ويعيد الأرصدة" className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-500/10 transition-all">
                        <RotateCcw size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* عملية جديدة */}
      <Modal open={open} onClose={() => setOpen(false)} title="📲 عملية محافظ جديدة" wide>
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {WALLET_SERVICE_TYPES.map((t) => (
              <button key={t.id} onClick={() => setType(t.id)} className={`p-2.5 rounded-xl border-2 text-[12px] font-bold transition-all ${type === t.id ? 'border-brand-500/60 bg-brand-500/10 text-brand-700 dark:text-brand-300' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}>
                {t.icon} {t.nameAr}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="المزوّد">
              <select value={provider} onChange={(e) => setProvider(e.target.value as WalletProvider)} className={inputCls}>
                {WALLET_PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.nameAr}</option>)}
              </select>
            </Field>
            <Field label="رقم الوجهة / المرجع">
              <input value={targetPhone} onChange={(e) => setTargetPhone(e.target.value)} className={inputCls} dir="ltr" placeholder={phonePlaceholder(setup.countryCode)} />
            </Field>
            <Field label={`المدفوع للمزوّد (${cur.symbol})`} hint="ما يخرج فعلاً من المحفظة/المكينة الممولة">
              <input value={paidToProvider} onChange={(e) => setPaidToProvider(e.target.value)} className={inputCls} dir="ltr" />
            </Field>
            <Field label={`المحصَّل من العميل (${cur.symbol})`} hint="الربح = المحصَّل − المدفوع للمزوّد (يُحسب آلياً)">
              <input value={charge} onChange={(e) => setCharge(e.target.value)} className={inputCls} dir="ltr" />
            </Field>
            <Field label="أصل التمويل" hint="المحفظة/المكينة التي خرج منها التحويل">
              <TreasuryPicker value={funding} onChange={setFunding} compact />
            </Field>
            <Field label="مكان استلام مبلغ العميل" hint="قد يختلف عن التمويل: كاش بالدرج وتحويل من إنستاباي">
              <div className="space-y-2"><TerminalPaymentPicker value={terminalPayment} onChange={setTerminalPayment}/>{!terminalPayment.terminalId && <TreasuryPicker value={receive} onChange={setReceive} compact />}</div>
            </Field>
            <Field label={`المدفوع الآن (${cur.symbol})`} hint="اتركه فارغاً = محصَّل بالكامل؛ الباقي دين على العميل">
              <input value={paid} onChange={(e) => setPaid(e.target.value)} className={inputCls} dir="ltr" placeholder="الكل" />
            </Field>
            <Field label="العميل" hint="إلزامي فقط لو جزء من المبلغ آجل">
              <select value={customerId} onChange={(e) => setCustomerId(Number(e.target.value))} className={inputCls}>
                <option value={0}>عميل نقدي</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.nameAr}</option>)}
              </select>
            </Field>
          </div>
          {setup.vatPercent > 0 && (
            <label className="flex items-center gap-2 text-[12px] font-bold text-slate-600 dark:text-slate-300 cursor-pointer">
              <input type="checkbox" checked={taxable} onChange={(e) => setTaxable(e.target.checked)} className="w-4 h-4 accent-brand-600" />
              خدمة خاضعة للضريبة ({setup.vatPercent}٪ على هامش الخدمة) — أغلب خدمات المحافظ معفاة، فعّلها فقط لو نشاطك يفوترها بضريبة
            </label>
          )}
          <Field label="ملاحظات">
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
          </Field>
          {profitPreview != null && (
            <div className="flex items-center justify-between p-3 rounded-2xl bg-emerald-500/5 border border-emerald-500/20">
              <span className="text-[12px] text-slate-500 flex items-center gap-1.5"><Wallet2 size={14} /> الربح المحسوب آلياً</span>
              <span className={`font-black text-xl ${profitPreview >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{fmt(profitPreview)} {cur.symbol}</span>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setOpen(false)}>إلغاء</Btn>
            <Btn onClick={save} disabled={!paidToProvider || !charge || !targetPhone.trim()}><Smartphone size={15} /> تسجيل العملية</Btn>
          </div>
        </div>
      </Modal>

      {/* عرض القيد */}
      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing ? `${viewing.opNumber} — ${typeName(viewing.type)}` : ''}>
        {viewing && (() => {
          const entry = journal.find((e) => e.id === viewing.journalEntryId)
          return (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-3 text-[12px] text-slate-500">
                <span>📅 {viewing.date}</span>
                <span>🏷️ {providerName(viewing.provider)}</span>
                <span dir="ltr">📞 {viewing.targetPhone}</span>
                {viewing.refCode && <span className="font-mono text-sky-600" dir="ltr">{viewing.refCode}</span>}
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50"><div className="text-[10px] text-slate-400">للمزوّد</div><div className="font-bold">{fmt(viewing.paidToProviderMinor)}</div></div>
                <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50"><div className="text-[10px] text-slate-400">المحصَّل</div><div className="font-bold">{fmt(viewing.chargeMinor)}</div></div>
                <div className="p-2.5 rounded-xl bg-emerald-500/5"><div className="text-[10px] text-slate-400">الربح</div><div className="font-black text-emerald-600">{fmt(viewing.totals.profitGrossMinor)}</div></div>
              </div>
              {entry && (
                <div className="rounded-2xl border border-rose-500/20 bg-rose-500/[0.03] overflow-hidden">
                  <div className="px-4 py-2 text-[12px] font-bold text-rose-600 dark:text-rose-400 border-b border-rose-500/10">القيد #{entry.entryNumber}</div>
                  <table className="w-full text-[12px]">
                    <tbody>
                      {entry.lines.map((l, i) => (
                        <tr key={i} className="border-t border-rose-500/5">
                          <td className="px-4 py-1.5 text-slate-600 dark:text-slate-300">{l.debit > 0 ? '' : '\u00A0\u00A0\u00A0\u00A0إلى '}{ACCOUNT_NAMES[l.accountCode] ?? l.accountCode}</td>
                          <td className="px-4 py-1.5 w-24 font-bold">{l.debit > 0 ? fmt(l.debit) : ''}</td>
                          <td className="px-4 py-1.5 w-24 font-bold text-slate-400">{l.credit > 0 ? fmt(l.credit) : ''}</td>
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
      {approval.dialog}
      {creditApproval.dialog}
    </div>
  )
}
