/**
 * فحص وحدة الشيكات (أوراق القبض والدفع)
 * node --experimental-strip-types scripts/verify_cheques.mjs
 */
import {
  validateCheque, assertTransition, isFinalStatus,
  buildChequeReceiveEntry, buildChequeCollectEntry, buildChequeBounceEntry,
  buildChequeIssueEntry, buildChequeClearEntry, buildChequeCancelEntry,
  dueCheques, chequePortfolio, CHEQUE_STATUS_LABELS,
  NOTES_RECEIVABLE, NOTES_PAYABLE,
} from '../src/core/cheques.ts'
import { STANDARD_COA, buildReversalLines } from '../src/core/ledger.ts'

let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) { pass++ } else { fail++; console.error(`❌ ${name}`) } }
const throws = (fn, name) => { try { fn(); fail++; console.error(`❌ لم يرمِ: ${name}`) } catch { pass++ } }
const balanced = (lines) => lines.reduce((a, l) => a + l.debit, 0) === lines.reduce((a, l) => a + l.credit, 0)
const side = (lines, code) => lines.find((l) => l.accountCode === code)

/* ─── الحسابات الجديدة بالشجرة ─── */
const byCode = new Map(STANDARD_COA.map((a) => [a.code, a]))
ok(byCode.has('1106'), '1106 أوراق قبض موجود بالشجرة')
ok(byCode.has('2106'), '2106 أوراق دفع موجود بالشجرة')
ok(byCode.get('1106').rootType === 'assets' && byCode.get('1106').isPostable, '1106 أصل ورقي')
ok(byCode.get('2106').rootType === 'liabilities' && byCode.get('2106').isPostable, '2106 التزام ورقي')
ok(byCode.get('1106').systemKey === 'notes_receivable', 'مفتاح نظام 1106')
ok(byCode.get('2106').systemKey === 'notes_payable', 'مفتاح نظام 2106')
ok(NOTES_RECEIVABLE === '1106' && NOTES_PAYABLE === '2106', 'ثوابت الحسابات مطابقة')

/* ─── التحقق ─── */
throws(() => validateCheque({ chequeNumber: '', amountMinor: 100, dueDate: '2026-01-01', partyId: 1 }), 'رقم شيك فارغ')
throws(() => validateCheque({ chequeNumber: '1', amountMinor: 0, dueDate: '2026-01-01', partyId: 1 }), 'مبلغ صفري')
throws(() => validateCheque({ chequeNumber: '1', amountMinor: -5, dueDate: '2026-01-01', partyId: 1 }), 'مبلغ سالب')
throws(() => validateCheque({ chequeNumber: '1', amountMinor: 10.5, dueDate: '2026-01-01', partyId: 1 }), 'مبلغ غير صحيح (كسور)')
throws(() => validateCheque({ chequeNumber: '1', amountMinor: 100, dueDate: '01/01/2026', partyId: 1 }), 'تاريخ غير ISO')
throws(() => validateCheque({ chequeNumber: '1', amountMinor: 100, dueDate: '2026-01-01', partyId: 0 }), 'طرف غير محدد')
validateCheque({ chequeNumber: '000123', amountMinor: 50_000_00, dueDate: '2026-10-01', partyId: 3 }); pass++

/* ─── قيود الشيك الوارد ─── */
const rcv = buildChequeReceiveEntry(50_000_00, 'شيك 123')
ok(balanced(rcv), 'قيد الاستلام متوازن')
ok(side(rcv, '1106').debit === 50_000_00, 'الاستلام: مدين أوراق قبض')
ok(side(rcv, '1104').credit === 50_000_00, 'الاستلام: دائن العملاء (تخفيض دينه)')

const col = buildChequeCollectEntry(50_000_00, 'شيك 123')
ok(balanced(col), 'قيد التحصيل متوازن')
ok(side(col, '1102').debit === 50_000_00, 'التحصيل: مدين البنوك')
ok(side(col, '1106').credit === 50_000_00, 'التحصيل: دائن أوراق قبض')

const bounce = buildChequeBounceEntry(50_000_00, 'شيك 123')
ok(balanced(bounce), 'قيد الارتداد متوازن')
ok(side(bounce, '1104').debit === 50_000_00, 'الارتداد: الدين يعود على العميل')
ok(side(bounce, '1106').credit === 50_000_00, 'الارتداد: تفريغ أوراق القبض')
// الارتداد = عكس الاستلام تماماً
const canon = (lines) => JSON.stringify([...lines.map((l) => [l.accountCode, l.debit, l.credit])].sort())
ok(canon(bounce) === canon(buildReversalLines(rcv)), 'الارتداد مطابق للقيد العاكس للاستلام (بغض النظر عن ترتيب الأسطر)')

/* ─── قيود الشيك الصادر ─── */
const iss = buildChequeIssueEntry(30_000_00, 'شيك 55')
ok(balanced(iss), 'قيد التحرير متوازن')
ok(side(iss, '2101').debit === 30_000_00, 'التحرير: مدين الموردون (تخفيض ديننا)')
ok(side(iss, '2106').credit === 30_000_00, 'التحرير: دائن أوراق دفع')

const clr = buildChequeClearEntry(30_000_00, 'شيك 55')
ok(balanced(clr), 'قيد الصرف متوازن')
ok(side(clr, '2106').debit === 30_000_00, 'الصرف: تفريغ أوراق الدفع')
ok(side(clr, '1102').credit === 30_000_00, 'الصرف: دائن البنوك')

const cxl = buildChequeCancelEntry(30_000_00, 'شيك 55')
ok(balanced(cxl), 'قيد الإلغاء متوازن')
ok(side(cxl, '2106').debit === 30_000_00, 'الإلغاء: تفريغ أوراق الدفع')
ok(side(cxl, '2101').credit === 30_000_00, 'الإلغاء: الدين يعود للمورد')

/* مبالغ صفرية مرفوضة بنيوياً (assertBalanced يرمي على قيد صفري) */
throws(() => buildChequeReceiveEntry(0, 'x'), 'قيد استلام صفري مرفوض')
throws(() => buildChequeIssueEntry(0, 'x'), 'قيد تحرير صفري مرفوض')

/* ─── آلة الحالات ─── */
assertTransition('held', 'deposited'); pass++
assertTransition('held', 'collected'); pass++
assertTransition('held', 'bounced'); pass++
assertTransition('deposited', 'collected'); pass++
assertTransition('deposited', 'bounced'); pass++
assertTransition('issued', 'cleared'); pass++
assertTransition('issued', 'cancelled'); pass++
throws(() => assertTransition('collected', 'bounced'), 'لا رجعة بعد التحصيل')
throws(() => assertTransition('bounced', 'collected'), 'لا تحصيل بعد الارتداد')
throws(() => assertTransition('cleared', 'cancelled'), 'لا إلغاء بعد الصرف')
throws(() => assertTransition('cancelled', 'cleared'), 'لا صرف بعد الإلغاء')
throws(() => assertTransition('held', 'cleared'), 'وارد لا يأخذ حالات الصادر')
throws(() => assertTransition('issued', 'collected'), 'صادر لا يأخذ حالات الوارد')
throws(() => assertTransition('deposited', 'held'), 'لا عودة من الإيداع للحافظة')
ok(isFinalStatus('collected') && isFinalStatus('bounced') && isFinalStatus('cleared') && isFinalStatus('cancelled'), 'الحالات النهائية')
ok(!isFinalStatus('held') && !isFinalStatus('deposited') && !isFinalStatus('issued'), 'الحالات المفتوحة')
ok(Object.keys(CHEQUE_STATUS_LABELS).length === 7, 'كل حالة لها تسمية عربية')

/* ─── تنبيهات الاستحقاق ─── */
const mk = (id, status, dueDate, direction = 'incoming', amountMinor = 10_000_00) => ({
  id, chequeNumber: `c${id}`, direction, partyId: 1, partyName: 'ط', bankName: 'ب',
  amountMinor, dueDate, status, notes: '', createdAt: '2026-09-01T00:00:00Z',
  receiveEntryId: 1, settleEntryId: null, reverseEntryId: null, depositedAt: null, settledAt: null,
})
const today = '2026-09-14'
const alerts = dueCheques([
  mk(1, 'held', '2026-09-10'),        // متأخر 4 أيام
  mk(2, 'deposited', '2026-09-14'),   // اليوم
  mk(3, 'issued', '2026-09-20', 'outgoing'), // بعد 6 أيام
  mk(4, 'held', '2026-10-30'),        // بعيد — لا يظهر
  mk(5, 'collected', '2026-09-10'),   // نهائي — لا يظهر
], today)
ok(alerts.length === 3, 'ثلاثة تنبيهات فقط')
ok(alerts[0].cheque.id === 1 && alerts[0].daysLeft === -4, 'المتأخر أولاً بأيامه')
ok(alerts[1].cheque.id === 2 && alerts[1].daysLeft === 0, 'يستحق اليوم')
ok(alerts[2].cheque.id === 3 && alerts[2].daysLeft === 6, 'القادم خلال الأسبوع')

/* ─── ملخص المحفظة ─── */
const pf = chequePortfolio([
  mk(1, 'held', '2026-09-10', 'incoming', 10_000_00),
  mk(2, 'deposited', '2026-09-14', 'incoming', 20_000_00),
  mk(3, 'collected', '2026-09-01', 'incoming', 99_000_00), // نهائي لا يُحسب مفتوحاً
  mk(4, 'bounced', '2026-09-01', 'incoming', 5_000_00),
  mk(5, 'issued', '2026-09-20', 'outgoing', 30_000_00),
  mk(6, 'cleared', '2026-09-01', 'outgoing', 70_000_00),
])
ok(pf.incomingOpenMinor === 30_000_00 && pf.incomingOpenCount === 2, 'أوراق قبض مفتوحة')
ok(pf.outgoingOpenMinor === 30_000_00 && pf.outgoingOpenCount === 1, 'أوراق دفع مفتوحة')
ok(pf.bouncedCount === 1, 'عداد المرتد')

console.log(`PASS=${pass} FAIL=${fail}`)
if (fail > 0) process.exit(1)
console.log(`🎉 نجح فحص الشيكات — ${pass} اختباراً`)
