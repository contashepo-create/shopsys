/**
 * verify_rare_surfaces.mjs — الطبقة ①-ب: الأسطح النادرة الاستخدام
 * ──────────────────────────────────────────────────────────────────
 * بوابة «حصر الأسطح» تفشل إن بقي أي سطح متجر بلا استدعاء. هذا الملف يستدعي
 * الأسطح التي لا تمرّ في الرحلات اليومية، ويتحقق من سلوكها لا من وجودها فقط:
 *   • طلب اعتماد مستند: يُنشأ بحالة pending وبمعرّف فريد وقيم مطابقة.
 *   • حذف مسودة فاتورة متقدمة: يحذف المسودة المستهدفة وحدها.
 *   • ختم رمز الضريبة (فاتورة/مرتجع): يُختم مرة واحدة ولا يُستبدل (قاعدة ZATCA).
 */
import { freshCase, addSimpleItem, assertInvariants, reporter } from './auditKit.mjs'

const r = reporter('الأسطح النادرة')
const c = await freshCase({ activityId: 'grocery', vatPercent: 0 })
const st = c.st

r.section('🗂️ طلب اعتماد مستند (submitDocForApproval)')
const before = st().docApprovals.length
const request = st().submitDocForApproval({
  kind: 'purchase', title: 'فاتورة مورد', partyName: 'مورد الاختبار',
  amountMinor: 12_345, payload: '{"lines":[]}', requestedBy: null, requestedByName: 'مدير',
})
if (st().docApprovals.length !== before + 1) throw new Error('طلب الاعتماد لم يُضف إلى السجل')
if (request.status !== 'pending') throw new Error(`حالة الطلب الابتدائية يجب أن تكون pending — فعلي ${request.status}`)
if (request.amountMinor !== 12_345 || request.requestedByName !== 'مدير') throw new Error('قيم الطلب لم تُحفظ كما أُدخلت')
if (st().docApprovals.filter((row) => row.id === request.id).length !== 1) throw new Error('معرّف الطلب غير فريد')
r.ok('يُنشأ طلب اعتماد pending بمعرّف فريد وقيم مطابقة')

r.section('🗂️ حذف مسودة فاتورة متقدمة (deleteAdvancedInvoiceDraft)')
const savedA = st().upsertAdvancedInvoiceDraft({ id: 'draft-a', kind: 'purchase', name: 'مسودة أ', payload: '{}' })
const savedB = st().upsertAdvancedInvoiceDraft({ id: 'draft-b', kind: 'purchase', name: 'مسودة ب', payload: '{}' })
if (savedA.createdAt == null || savedB.updatedAt == null) throw new Error('المسودة لم تحمل طوابع الوقت')
st().deleteAdvancedInvoiceDraft('draft-a')
const left = st().advancedInvoiceDrafts
if (left.some((draft) => draft.id === 'draft-a')) throw new Error('المسودة المستهدفة لم تُحذف')
if (!left.some((draft) => draft.id === 'draft-b')) throw new Error('حذف المسودة أزال مسودة أخرى')
r.ok('الحذف يستهدف مسودة واحدة ولا يمسّ غيرها')
const countBeforeNoop = left.length
st().deleteAdvancedInvoiceDraft('غير-موجود')
if (st().advancedInvoiceDrafts.length !== countBeforeNoop) throw new Error('حذف معرّف غير موجود غيّر الحالة')
r.ok('الحذف بمعرّف غير موجود لا يرمي ولا يغيّر شيئاً')

r.section('🧾 ختم رمز الضريبة (attachSaleTaxQr / attachSaleReturnTaxQr)')
const item = addSimpleItem(c, { nameAr: 'صنف ختم', priceMinor: 1000 })
st().addSupplier({ nameAr: 'مورد', phone: '', notes: '' })
const supplier = st().suppliers.at(-1)
const warehouseId = st().warehouses[0]?.id ?? 1
st().postPurchase({ supplierId: supplier.id, date: '2026-11-17', lines: [{ itemId: item.id, qty: 10, unitPriceMinor: 500, vatPercent: 0, warehouseId }], expenses: [], paidMinor: 0, treasury: '1101', notes: '' })
const sale = st().postSale({ lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 1, unitPriceMinor: 1000, unitCostMinor: st().items.find((row) => row.id === item.id).costMinor, discountPercent: 0, soldByWeight: false, warehouseId }], customerId: null, payment: 'cash', treasury: '1101', paidMinor: 1000, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false })
st().attachSaleTaxQr(sale.id, 'QR-ONE')
st().attachSaleTaxQr(sale.id, 'QR-TWO')
const stamped = st().sales.find((row) => row.id === sale.id)
if (stamped.taxQrPayload !== 'QR-ONE') throw new Error(`رمز الضريبة يجب ألا يُستبدل بعد الختم — فعلي ${stamped.taxQrPayload}`)
r.ok('رمز الفاتورة يُثبَّت مرة واحدة (لا يُستبدل بختم ثانٍ)')

const ret = st().postSaleReturn({ saleId: sale.id, lineSpecs: [{ lineIndex: 0, qty: 1, condition: 'good' }], refund: 'cash' })
st().attachSaleReturnTaxQr(ret.id, 'RQR-ONE')
st().attachSaleReturnTaxQr(ret.id, 'RQR-TWO')
const stampedReturn = st().saleReturns.find((row) => row.id === ret.id)
if (stampedReturn.taxQrPayload !== 'RQR-ONE') throw new Error(`رمز المرتجع يجب ألا يُستبدل — فعلي ${stampedReturn.taxQrPayload}`)
r.ok('رمز المرتجع يُثبَّت مرة واحدة')

assertInvariants('بعد الأسطح النادرة', c)
r.ok('الثوابت العشرة سليمة بعد كل الأسطح النادرة')
r.done()
