/**
 * لوحة اليوم — بلغة التاجر (وثيقة التصميم 9.1)
 * الأرقام الآن حقيقية 100%: مشتقة من دفتر الأستاذ (نفس مصدر ميزان المراجعة)
 */
import { useMemo } from 'react'
import { TrendingUp, Wallet, Coins, AlertTriangle, ArrowUpLeft, ArrowDownLeft, ReceiptText, BookOpenText } from 'lucide-react'
import { useAppStore } from '../../stores/app.store.ts'
import { useDataStore } from '../../data/repo.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor } from '../../core/money.ts'
import { accountBalance, STANDARD_COA } from '../../core/ledger.ts'
import { Link } from 'react-router-dom'
import { collectBusinessAlerts } from '../../core/alerts.ts'
import { collectAlerts as collectInstallmentAlerts } from '../../core/installments.ts'
import { customerStatement, customerUnitDocs, statementBalance } from '../../core/statements.ts'

export function Dashboard() {
  const { setup } = useAppStore()
  const { journal, sales, items, purchases, purchaseReturns, treasuries, batches, installmentPlans, cheques, customers, saleReturns, vouchers, clientSettlements, trips, tickets, rentalContracts } = useDataStore()
  const country = setup.countryCode ? getCountry(setup.countryCode) : undefined
  const cur = country?.currency ?? { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
  const fmt = (minor: number) => formatMinor(minor, cur)

  /** الأرصدة الحية من دفتر الأستاذ — المصدر الواحد للحقيقة */
  const ledger = useMemo(() => {
    const totals = new Map<string, { d: number; c: number }>()
    for (const e of journal) {
      for (const l of e.lines) {
        const t = totals.get(l.accountCode) ?? { d: 0, c: 0 }
        t.d += l.debit; t.c += l.credit
        totals.set(l.accountCode, t)
      }
    }
    const bal = (code: string) => {
      const acc = STANDARD_COA.find((a) => a.code === code)
      const t = totals.get(code) ?? { d: 0, c: 0 }
      return acc ? accountBalance(acc.rootType, t.d, t.c) : 0
    }
    // «في الخزينة» = مجموع كل الخزائن والبنوك المسجلة مهما كان عددها (طلب المالك)
    const cashCodes = treasuries.length ? treasuries.map((t) => t.code) : ['1101', '1102']
    return {
      cash: cashCodes.reduce((sum, code) => {
        const t = totals.get(code) ?? { d: 0, c: 0 }
        return sum + accountBalance('assets', t.d, t.c)
      }, 0),
      customers: bal('1104'),
      salesTotal: bal('4101'),
      cogs: bal('5101'),
      vat: bal('2102'),
    }
  }, [journal, treasuries])

  const today = new Date().toISOString().slice(0, 10)
  const todaySales = useMemo(() => sales.filter((s) => s.date.startsWith(today)), [sales, today])
  // أرقام اليوم من دفتر الأستاذ نفسه — تشمل كل العمليات (بيع، صيانة، تحاليل، عيادة، إيجار، نقلات، مقاولات…)
  // وليس فواتير الكاشير فقط — هذا ما يمنع «الأصفار» رغم وجود عمليات من وحدات أخرى
  const todayLedger = useMemo(() => {
    let rev = 0, exp = 0
    for (const e of journal) {
      if (!e.date.startsWith(today)) continue
      for (const l of e.lines) {
        if (l.accountCode.startsWith('4')) rev += l.credit - l.debit
        else if (l.accountCode.startsWith('5')) exp += l.debit - l.credit
      }
    }
    return { revenue: rev, profit: rev - exp }
  }, [journal, today])
  const todayRevenue = todayLedger.revenue
  const todayProfit = todayLedger.profit

  // إجماليات كل الفترات — كل العمليات منذ البداية (من دفتر الأستاذ)
  const allTime = useMemo(() => {
    let rev = 0, exp = 0
    for (const e of journal) {
      for (const l of e.lines) {
        if (l.accountCode.startsWith('4')) rev += l.credit - l.debit
        else if (l.accountCode.startsWith('5')) exp += l.debit - l.credit
      }
    }
    return { revenue: rev, expenses: exp, net: rev - exp, entries: journal.length }
  }, [journal])

  const lowStock = items.filter((it) => (it.stockQty ?? 0) <= it.minQty && it.minQty > 0)

  /* مركز التنبيهات الموحد (جولة المراجعة الختامية): صلاحية/أقساط/شيكات/حد ائتمان + نواقص */
  const businessAlerts = useMemo(() => {
    const allVouchers = [
      ...vouchers,
      ...clientSettlements.map((st) => ({ voucherNumber: st.settlementNumber, kind: 'receipt' as const, date: st.date, partyKind: 'customer' as const, partyId: st.customerId, amountMinor: st.amountMinor })),
    ]
    return collectBusinessAlerts({
      todayIso: new Date().toISOString(),
      items: items.map((it) => ({ id: it.id, nameAr: it.nameAr, stockQty: it.stockQty ?? 0, minQty: it.minQty, isActive: it.isActive })),
      batches,
      installmentAlerts: collectInstallmentAlerts(installmentPlans, new Date().toISOString().slice(0, 10)),
      cheques,
      customers,
      customerBalances: (id) => statementBalance(customerStatement({ customerId: id, sales, saleReturns, allSales: sales, vouchers: allVouchers, cheques, extraDocs: customerUnitDocs({ customerId: id, trips, tickets, rentals: rentalContracts }) })),
      fmt,
    })
  }, [items, batches, installmentPlans, cheques, customers, sales, saleReturns, vouchers, clientSettlements, trips, tickets, rentalContracts])
  // دين الموردين = فواتير غير مسددة − مرتجعات الشراء المخفِّضة للدين
  const suppliersDebt = Math.max(
    0,
    purchases.reduce((a, p) => a + Math.max(0, (p.supplierDueMinor ?? p.grandTotalMinor) - p.paidMinor), 0) -
      purchaseReturns.filter((r) => r.refund === 'debt').reduce((a, r) => a + r.totalMinor, 0),
  )

  const cards = [
    { title: 'إيراد اليوم', value: fmt(todayRevenue), icon: TrendingUp, color: 'from-emerald-500 to-teal-500', glow: 'shadow-emerald-500/30', delta: `${todaySales.length} فاتورة كاشير + كل الوحدات` },
    { title: 'ربح اليوم', value: fmt(todayProfit), icon: Coins, color: 'from-violet-500 to-fuchsia-500', glow: 'shadow-violet-500/30', delta: 'إيراد − كل المصروفات' },
    { title: 'في الخزينة', value: fmt(ledger.cash), icon: Wallet, color: 'from-sky-500 to-cyan-500', glow: 'shadow-sky-500/30', delta: 'من دفتر الأستاذ مباشرة' },
    { title: 'تنبيهات', value: String(businessAlerts.length), icon: AlertTriangle, color: 'from-amber-500 to-orange-500', glow: 'shadow-amber-500/30', delta: businessAlerts.length ? businessAlerts[0].titleAr : 'كله تمام ✓' },
  ]

  return (
    <div className="space-y-6">
      {/* البطاقات */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {cards.map((c, i) => (
          <div
            key={c.title}
            style={{ animationDelay: `${i * 80}ms` }}
            className={`anim-up group relative overflow-hidden rounded-2xl p-5 bg-gradient-to-br ${c.color} text-white shadow-xl ${c.glow} transition-all duration-300 hover:scale-[1.03] hover:shadow-2xl cursor-default`}
          >
            <div className="absolute -left-6 -bottom-6 opacity-15 transition-transform duration-500 group-hover:scale-125 group-hover:rotate-12">
              <c.icon size={110} />
            </div>
            <div className="relative">
              <div className="text-sm opacity-85 font-semibold">{c.title}</div>
              <div className="text-2xl font-black mt-1.5">{c.value}</div>
              <div className="text-[11px] opacity-75 mt-2">{c.delta}</div>
            </div>
          </div>
        ))}
      </div>

      {/* إجمالي كل العمليات منذ البداية — من دفتر الأستاذ الموحّد */}
      <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-4 flex flex-wrap items-center gap-x-8 gap-y-2" style={{ animationDelay: '280ms' }}>
        <div className="text-[12px] font-black text-slate-500 dark:text-slate-400">📊 إجمالي كل العمليات:</div>
        <div className="text-[13px]"><span className="text-slate-400 text-[11px]">الإيرادات</span> <b className="text-emerald-600 dark:text-emerald-400 me-1">{fmt(allTime.revenue)}</b></div>
        <div className="text-[13px]"><span className="text-slate-400 text-[11px]">المصروفات</span> <b className="text-rose-500 me-1">{fmt(allTime.expenses)}</b></div>
        <div className="text-[13px]"><span className="text-slate-400 text-[11px]">صافي الربح</span> <b className={`me-1 ${allTime.net >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'}`}>{fmt(allTime.net)}</b></div>
        <div className="text-[13px]"><span className="text-slate-400 text-[11px]">قيود اليومية</span> <b className="text-slate-700 dark:text-slate-200 me-1">{allTime.entries}</b></div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* لك وعليك */}
        <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-5" style={{ animationDelay: '320ms' }}>
          <h3 className="font-extrabold text-slate-800 dark:text-white mb-4">لك وعليك</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3.5 rounded-xl bg-emerald-500/5 border border-emerald-500/15">
              <div className="flex items-center gap-2.5">
                <ArrowUpLeft size={18} className="text-emerald-500" />
                <span className="text-sm text-slate-600 dark:text-slate-300">لك عند العملاء (آجل)</span>
              </div>
              <span className="font-black text-emerald-600 dark:text-emerald-400">{fmt(ledger.customers)}</span>
            </div>
            <div className="flex items-center justify-between p-3.5 rounded-xl bg-rose-500/5 border border-rose-500/15">
              <div className="flex items-center gap-2.5">
                <ArrowDownLeft size={18} className="text-rose-500" />
                <span className="text-sm text-slate-600 dark:text-slate-300">عليك للموردين</span>
              </div>
              <span className="font-black text-rose-600 dark:text-rose-400">{fmt(suppliersDebt)}</span>
            </div>
            {ledger.vat > 0 && (
              <div className="flex items-center justify-between p-3.5 rounded-xl bg-amber-500/5 border border-amber-500/15">
                <div className="flex items-center gap-2.5">
                  <ReceiptText size={18} className="text-amber-500" />
                  <span className="text-sm text-slate-600 dark:text-slate-300">ضريبة مستحقة للدولة</span>
                </div>
                <span className="font-black text-amber-600 dark:text-amber-400">{fmt(ledger.vat)}</span>
              </div>
            )}
          </div>
          <p className="text-[11px] text-slate-400 mt-4 leading-relaxed">
            💡 هذه الأرقام مشتقة من دفتر الأستاذ الموحّد — نفس مصدر ميزان المراجعة، فلا تتناقض أبداً.
          </p>
        </div>

        {/* مركز التنبيهات الموحد */}
        {businessAlerts.length > 0 && (
          <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-5 lg:col-span-2" style={{ animationDelay: '350ms' }}>
            <h3 className="font-extrabold text-slate-800 dark:text-white mb-3 flex items-center gap-2">
              <AlertTriangle size={17} className="text-rose-500" /> مركز التنبيهات
            </h3>
            <div className="grid sm:grid-cols-2 gap-2">
              {businessAlerts.map((a) => (
                <Link key={a.kind} to={a.route} className={`block p-3 rounded-xl border transition-all hover:scale-[1.01] ${a.severity === 'danger' ? 'bg-rose-500/5 border-rose-500/20 hover:bg-rose-500/10' : 'bg-amber-500/5 border-amber-500/20 hover:bg-amber-500/10'}`}>
                  <div className={`text-[12.5px] font-black ${a.severity === 'danger' ? 'text-rose-600' : 'text-amber-600'}`}>{a.severity === 'danger' ? '🔴' : '🟠'} {a.titleAr}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">{a.detailAr}</div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* نواقص المخزون */}
        <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-5" style={{ animationDelay: '400ms' }}>
          <h3 className="font-extrabold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
            <AlertTriangle size={17} className="text-amber-500" /> نواقص المخزون
          </h3>
          {lowStock.length === 0 ? (
            <div className="text-center py-8 text-slate-300 dark:text-slate-600 text-sm">
              ✓ لا نواقص — كل الأصناف فوق حد الطلب
              <div className="text-[11px] mt-1">(حدد "حد إعادة الطلب" في الأصناف ليعمل التنبيه)</div>
            </div>
          ) : (
            <div className="space-y-2">
              {lowStock.slice(0, 6).map((it) => (
                <div key={it.id} className="flex items-center justify-between p-2.5 rounded-xl bg-rose-500/5 border border-rose-500/10">
                  <span className="text-[13px] font-bold text-slate-700 dark:text-slate-200">{it.nameAr}</span>
                  <span className="text-[11px] font-black text-rose-500">{it.stockQty ?? 0} / حد {it.minQty}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* إحصاءات المحرك */}
        <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-5" style={{ animationDelay: '480ms' }}>
          <h3 className="font-extrabold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
            <BookOpenText size={17} className="text-rose-500" /> المحرك المحاسبي
          </h3>
          <div className="space-y-2.5 text-[13px]">
            <div className="flex justify-between"><span className="text-slate-500">قيود اليومية</span><b className="text-slate-700 dark:text-slate-200">{journal.length}</b></div>
            <div className="flex justify-between"><span className="text-slate-500">فواتير بيع</span><b className="text-slate-700 dark:text-slate-200">{sales.length}</b></div>
            <div className="flex justify-between"><span className="text-slate-500">فواتير شراء</span><b className="text-slate-700 dark:text-slate-200">{purchases.length}</b></div>
            <div className="flex justify-between"><span className="text-slate-500">إجمالي المبيعات (صافي)</span><b className="text-emerald-600">{fmt(ledger.salesTotal)}</b></div>
            <div className="flex justify-between"><span className="text-slate-500">تكلفة المبيعات</span><b className="text-slate-700 dark:text-slate-200">{fmt(ledger.cogs)}</b></div>
          </div>
          <p className="text-[11px] text-slate-400 mt-4 leading-relaxed">
            كل فاتورة تولّد قيداً متوازناً تلقائياً — راجعها في الحسابات العامة ← اليومية (فعّل الوضع المحاسبي الكامل من الأعلى).
          </p>
        </div>
      </div>
    </div>
  )
}
