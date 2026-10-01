import{useEffect,useMemo,useRef,useState}from'react';import{useNavigate,useSearchParams}from'react-router-dom';import{Boxes,Calculator,CalendarClock,CalendarDays,Link2,Pencil,ScrollText,Truck,Wallet,Warehouse as WarehouseIcon}from'lucide-react';import { useWindowHost } from '../windows/windowHostContext.ts'
import { openItemEditorWindow, openItemLedgerWindow, openItemPricesWindow, openPartyEditorWindow } from '../windows/windowStore.ts'
import { buildWarehouseReceiptHtml } from '../../core/warehouseReceipt.ts'
import { formatInvoiceAuditLine } from '../../core/invoiceAudit.ts'
import { printHtml } from '../print/printReceipt.ts'
import { AnimatedMinor } from '../components/AnimatedMinor.tsx'
import { FillFromPicker, type FillSource } from '../components/FillFromPicker.tsx'
import { poRemainingQty, PURCHASE_ORDER_STATUS_AR, type PurchaseOrder, type PurchaseOrderLine } from '../../core/purchaseOrders.ts'
import{DocumentAttachmentsBox,type PendingAttachment}from'../components/DocumentAttachments.tsx';import{InvoiceDraftsModal}from'../components/InvoiceDraftsModal.tsx';import{useDataStore,type PurchaseExpense,type AdvancedInvoiceDraft}from'../../data/repo.ts';import{useAppStore}from'../../stores/app.store.ts';import{getCountry}from'../../core/countries.ts';import{getActivity}from'../../core/activities.ts';import{formatMinor,toMinor,partyBalanceText}from'../../core/money.ts';import{COMMON_FX_CURRENCIES,convertFxToBookMinor,describeFxLeg,formatRate,parseRateToPpm,validateFxLeg,type FxLeg}from'../../core/foreignCurrency.ts';import{Btn,Field,inputCls,Modal,useToast,useUnsavedChangesGuard,guardNavigation}from'../components/ui.tsx';import{PaymentMethodPicker}from'../components/PaymentMethodPicker.tsx';import type{InvoiceEditorMode}from'../../core/advancedInvoice.ts';import{buildSimpleDocModel,type InvoiceTemplate}from'../../core/receipt.ts';import{printModelWithTemplate,buildModelHtml}from'../print/printDoc.ts';import{PrintTemplateModal}from'../components/PrintTemplateModal.tsx';import{effectivePermissionsFor,rolesWithOverrides}from'../../core/permissions.ts';import{useSupervisorApproval}from'../components/SupervisorPinDialog.tsx';import {ItemQuickPicker,PartyQuickPicker,QuickSelect}from'../components/KeyboardPickers.tsx';import {InvoiceLinesTable} from '../components/InvoiceLinesTable.tsx';import{partyCode}from'../../core/partyCodes.ts';import {PurchaseExpenseManager} from '../components/PurchaseExpenseManager.tsx';import {PartyQuickEditModal}from'../components/PartyQuickEditModal.tsx';import{InvoicePOSFrame}from'../components/InvoicePOSFrame.tsx';import{usePrintSwitches}from'../components/PrintSwitches.tsx';import{openPrintPreview}from'../components/printPreviewStore.ts';import{PrintSettingsPopup}from'../components/PrintSettingsPopup.tsx';import{FxRatesManager}from'../components/FxRatesManager.tsx';import{fetchFxRates,fxLegWithDefaultRate,fxRateAgeLabel,fxRateIsFresh}from'../../core/fxRates.ts';import{resolveBusinessTax}from'../../core/taxRegistration.ts';import{purchaseExpenseTaxParts}from'../../core/purchases.ts';import{evaluateLicense,hasFeature}from'../../core/license.ts';import{electronicInvoiceLockActive}from'../../core/invoiceEdit.ts';
import { partyNotesFor } from '../../core/partyNotes.ts'
import { PartyNotesLog } from '../components/PartyNotesLog.tsx'
type Line={key:string;itemId:number;qty:number;orderedQty:number;rejectedQty:number;unitPriceMinor:number;vatPercent:number;warehouseId:number|null;warehouseSource:'default'|'manual';expiryDate?:string};const modes:Record<InvoiceEditorMode,string>={simple:'مبسط',standard:'شراء مباشر',profit:'احترافي — تكلفة نهائية',advanced:'احترافي — متقدم'};
/** شروط توريد جاهزة تُضاف بضغطة إلى ملاحظات أمر الشراء */
const PURCHASE_TERMS=['السداد بعد المطابقة والاستلام','ضمان المورد سنة على العيوب المصنعية','التوريد على نفقة المورد حتى المخزن','يُرد التالف خلال 7 أيام من الاستلام']

/** تلوين الرصيد كالفاتورة المرجعية: مستحق للمورد أحمر · له عندك أخضر · صفر محايد */
const partyBalanceTone=(balanceMinor:number):'debit'|'credit'|'flat'=>balanceMinor>0?'debit':balanceMinor<0?'credit':'flat'

export function AdvancedPurchaseInvoicePage(){const nav=useNavigate(),toast=useToast();const[searchParams]=useSearchParams();const host=useWindowHost();const editId=Number((host?.props.editId as number|undefined)??searchParams.get('edit')??0);const{setup,receipt,einvoice,activatedPayload,trialStartedAt,lastSeenAt,warehouseReceipt}=useAppStore();const cur=(setup.countryCode&&getCountry(setup.countryCode)?.currency)||{code:'EGP',symbol:'ج.م',decimals:2 as const,name:''};const taxPolicy=resolveBusinessTax(setup.taxRegistrationStatus,setup.vatPercent);const{items,categories,suppliers,warehouses,branches,treasuries,vehicles,custodyFiles,projects,costCenters,expenseTemplates,addExpenseTemplate,partyNotes,addPartyNote,advancedInvoiceDrafts,upsertAdvancedInvoiceDraft,deleteAdvancedInvoiceDraft,postPurchase,editPurchase,purchases,getSupplierBalance,currentUserId,appUsers,roleOverrides,customRoles,addDocumentFile,purchaseOrders,receivePurchaseOrder}=useDataStore();const[attachments,setAttachments]=useState<PendingAttachment[]>([]);const editingInvoice=purchases.find(invoice=>invoice.id===editId)??null;const lic=evaluateLicense({activatedPayload,trialStartedAt,lastSeenAt,today:new Date().toISOString()});const einvoiceActive=electronicInvoiceLockActive({licensed:hasFeature(lic,'einvoice_sa')||hasFeature(lic,'einvoice_eg'),enabled:einvoice.enabled===true,taxNumber:einvoice.taxNumber});const currentUser=appUsers.find(u=>u.id===currentUserId)??null,canViewCost=effectivePermissionsFor(currentUser,rolesWithOverrides(roleOverrides,customRoles,setup.activityId)).has('inv.cost.view');const supplierPickerInfo=(party:{id:number;active?:boolean})=>{const balance=getSupplierBalance(party.id);return{code:partyCode('SUP',party.id),balance:`الرصيد ${formatMinor(Math.abs(balance),cur,false)} ${cur.symbol} ${balance>0?'مستحق له':balance<0?'لك عنده':''}`}};const[draftsOpen,setDraftsOpen]=useState(false);const[draftId]=useState(()=>crypto.randomUUID());/* نمط المحرر الافتراضي = تفضيل المستخدم الحالي (طلب المالك) — لكل مستخدم نمطه */
const myPrefs=useDataStore.getState().userPrefs[String(currentUserId??'owner')]??{};
const[supplierId,setSupplierId]=useState(-1),[projectId,setProjectId]=useState(0),[supplierInvoiceNumber,setSupplierInvoiceNumber]=useState(''),[purchaseOrderNumber,setPurchaseOrderNumber]=useState(''),[receiptStatus,setReceiptStatus]=useState<'pending'|'partial'|'received'>('received'),[mode,setMode]=useState<InvoiceEditorMode>(()=>myPrefs.purchaseInvoiceMode??'simple'),[warehouseId,setWarehouseId]=useState<number|null>(setup.defaultWarehouseId??warehouses[0]?.id??null),[lines,setLines]=useState<Line[]>([]),[expenses,setExpenses]=useState<PurchaseExpense[]>([]),[applyTax,setApplyTax]=useState(false),[discount,setDiscount]=useState('0'),[discountAmount,setDiscountAmount]=useState(''),[paid,setPaid]=useState(''),[fxOn,setFxOn]=useState(false),[fxCode,setFxCode]=useState('USD'),[fxAmount,setFxAmount]=useState(''),[fxRate,setFxRate]=useState(''),paidTouched=useRef(false),[treasury,setTreasury]=useState('1101'),[notes,setNotes]=useState(''),[date,setDate]=useState(new Date().toISOString().slice(0,10)),[dueDate,setDueDate]=useState(''),[expensesDialog,setExpensesDialog]=useState(false),[printOpen,setPrintOpen]=useState(false),[printSettingsOpen,setPrintSettingsOpen]=useState(false),[partyEditorOpen,setPartyEditorOpen]=useState(false),[editReason,setEditReason]=useState('');const fxRates=useAppStore((s)=>s.fxRates);const[fxRatesOpen,setFxRatesOpen]=useState(false);
/* وضع API: سحب تلقائي لسعر العملة المختارة عند تفعيل السداد الأجنبي (نفس منطق البيع) */
const fxSettings=useAppStore((s)=>s.fxRatesSettings);const applyFxApiQuotes=useAppStore((s)=>s.applyFxApiQuotes);const updateFxRatesSettings=useAppStore((s)=>s.updateFxRatesSettings);const fxAutoPulled=useRef<string|null>(null);/* مغادرة النمط المتقدم تطفئ السداد الأجنبي وتفرّغ حقوله (مراجعة المالك 2026-10-01) */
useEffect(()=>{if(mode!=='advanced'&&fxOn){setFxOn(false);setFxAmount('');setFxRate('')}},[mode,fxOn]);useEffect(()=>{if(!fxOn)return;const code=fxCode.toUpperCase();if(fxAutoPulled.current===code)return;if(fxSettings.mode!=='api'||fxSettings.autoRefreshHours<=0)return;if(fxRateIsFresh(fxRates[code],fxSettings.autoRefreshHours)){fxAutoPulled.current=code;return}fxAutoPulled.current=code;void fetchFxRates({provider:fxSettings.apiProvider,customUrl:fxSettings.customUrl,bookCode:cur.code,codes:[code]}).then((quotes)=>{if(quotes.length){applyFxApiQuotes(quotes,'API (تلقائي)');updateFxRatesSettings({lastRefreshAt:new Date().toISOString(),lastRefreshError:null})}}).catch((error)=>{updateFxRatesSettings({lastRefreshError:(error as Error).message})})},[fxOn,fxCode]);/* مفاتيح الطباعة الثلاثة (طلب المالك ㉘): فاتورة الشراء تتبعها مثل البيع */const printSwitches=usePrintSwitches();const approval=useSupervisorApproval('pur.invoice.edit');const patch=(key:string,p:Partial<Line>)=>setLines(lines.map(l=>l.key===key?{...l,...p}:l));const replaceLineItem=(key:string,id:number)=>{const i=items.find(x=>x.id===id);if(!i)return;setLines(previous=>previous.map(line=>line.key===key?{...line,itemId:i.id,unitPriceMinor:i.costMinor}:line))};const changeWarehouse=(id:number|null)=>{setWarehouseId(id);setLines(lines.map(l=>l.warehouseSource==='default'?{...l,warehouseId:id}:l))};const addItem=(id:number,smart?:{qty?:number;price?:number;discount?:number})=>{const i=items.find(x=>x.id===id);const q=smart?.qty&&smart.qty>0?smart.qty:1;if(i)setLines([...lines,{key:crypto.randomUUID(),itemId:i.id,qty:q,orderedQty:q,rejectedQty:0,unitPriceMinor:smart?.price!==undefined?toMinor(String(smart.price),cur.decimals):i.costMinor,vatPercent:applyTax?taxPolicy.effectivePercent:0,warehouseId,warehouseSource:'default'}]);requestAnimationFrame(()=>document.querySelector<HTMLElement>('.invoice-editor tbody tr:last-child td[tabindex="0"]')?.focus())};const rawGoods=lines.reduce((s,l)=>s+Math.round(l.qty*l.unitPriceMinor),0);const discountRate=(()=>{const percent=Math.min(100,Math.max(0,Number(discount)||0));try{const manual=toMinor(discountAmount||'0',cur.decimals);return manual>0&&rawGoods>0?Math.min(100,Math.max(0,manual/rawGoods*100)):percent}catch{return percent}})();const pricedLines=lines.map(l=>({...l,unitPriceMinor:Math.max(0,Math.round(l.unitPriceMinor*(1-discountRate/100)))}));const activeExpenses=expenses.map(e=>!applyTax?{...e,taxTreatment:'exempt' as const,taxPercent:0}:e),inventoryExpenses=activeExpenses.filter(e=>(e.costTreatment??'inventory')==='inventory'),inventoryExpenseParts=inventoryExpenses.map(e=>purchaseExpenseTaxParts(taxPolicy.effectivePercent===0?{...e,taxTreatment:'exempt' as const,taxPercent:0}:e,taxPolicy)),goods=pricedLines.reduce((s,l)=>s+Math.round(l.qty*l.unitPriceMinor),0),discountMinor=rawGoods-pricedLines.reduce((s,l)=>s+Math.round(l.qty*l.unitPriceMinor),0),lineInputVat=taxPolicy.effectivePercent===0?0:pricedLines.reduce((s,l)=>s+Math.round(l.qty*l.unitPriceMinor*l.vatPercent/100),0),expenseInputVat=inventoryExpenseParts.reduce((s,p)=>s+p.recoverableTaxMinor,0),inputVat=lineInputVat+expenseInputVat,extra=inventoryExpenseParts.reduce((s,p)=>s+p.costMinor,0),periodExpenses=activeExpenses.filter(e=>e.costTreatment==='period').reduce((s,e)=>s+e.amountMinor,0),periodSupplierDue=activeExpenses.filter(e=>e.costTreatment==='period'&&(e.paidBy??'supplier')==='supplier').reduce((s,e)=>s+e.amountMinor,0),directInventoryPayments=inventoryExpenses.reduce((s,e,i)=>s+(e.paidBy==='treasury'||e.paidBy==='custody'||e.paidBy==='payable'?inventoryExpenseParts[i].payableMinor:0),0),total=goods+extra+inputVat,supplierDue=Math.max(0,total-directInventoryPayments+periodSupplierDue),supplierExpenses=Math.max(0,supplierDue-(goods+lineInputVat)),shopBorneExpenses=Math.max(0,periodExpenses-periodSupplierDue);const fxMeta=COMMON_FX_CURRENCIES.find(row=>row.code===fxCode)??COMMON_FX_CURRENCIES[0];const fxLeg:FxLeg=fxLegWithDefaultRate({currencyCode:fxCode,amountMinor:(()=>{try{return toMinor(fxAmount||'0',fxMeta.decimals)}catch{return 0}})(),ratePpm:parseRateToPpm(fxRate),decimals:fxMeta.decimals},fxRates);const fxErrors=fxOn?validateFxLeg(fxLeg,cur.code):[];const fxBookMinor=fxOn&&!fxErrors.length?convertFxToBookMinor(fxLeg,cur.decimals):0;const totalPaidMinor=fxOn?fxBookMinor:toMinor(paid||'0',cur.decimals);const paymentAllocations=totalPaidMinor>0?[{accountCode:treasury,amountMinor:totalPaidMinor,note:'السداد'}]:[];const allocations=useMemo(()=>{const value=goods||1;return lines.map(l=>{const p=pricedLines.find(row=>row.key===l.key)??l;return {key:l.key,share:expenses.filter(e=>(e.costTreatment??'inventory')==='inventory').reduce((s,e)=>s+Math.round(e.amountMinor*(e.method==='qty'?p.qty/Math.max(1,pricedLines.reduce((a,x)=>a+x.qty,0)):(p.qty*p.unitPriceMinor)/value)),0)}})},[lines,expenses,goods,pricedLines]);useEffect(()=>{if(supplierId===-1&&!paidTouched.current)setPaid(String(supplierDue/10**cur.decimals))},[supplierId,supplierDue,cur.decimals]);
  // تعبئة النموذج من الفاتورة المفتوحة للتعديل مرة واحدة لكل فاتورة (مفتاحها id).
  // إضافة بقية الحقول للاعتماديات تعيد الكتابة فوق ما يدخله المستخدم — لذلك تُستثنى عمداً.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(()=>{if(!editingInvoice)return;setMode('advanced');setSupplierId(editingInvoice.supplierId||-1);setWarehouseId(editingInvoice.warehouseId??setup.defaultWarehouseId??warehouses[0]?.id??null);setLines(editingInvoice.lines.map(line=>({...line,key:crypto.randomUUID(),orderedQty:line.qty,rejectedQty:0,vatPercent:line.vatPercent??0,warehouseId:line.warehouseId??editingInvoice.warehouseId??warehouseId,warehouseSource:'manual' as const})));setExpenses(editingInvoice.expenses??[]);setApplyTax((editingInvoice.inputVatMinor??0)>0||(editingInvoice.expenses??[]).some(expense=>expense.taxTreatment&&expense.taxTreatment!=='exempt'));setDiscount(String(editingInvoice.discountPercent??0));setDiscountAmount('');setPaid(String(editingInvoice.paidMinor/10**cur.decimals));paidTouched.current=true;setTreasury(editingInvoice.treasury??'1101');setSupplierInvoiceNumber(editingInvoice.supplierInvoiceNumber??'');setPurchaseOrderNumber(editingInvoice.purchaseOrderNumber??'');setNotes(editingInvoice.notes??'');setDate(editingInvoice.date.slice(0,10));setDueDate(editingInvoice.dueDate??'');setEditReason('')},[editingInvoice?.id])

;
 const [partyNote,setPartyNote]=useState('');const [notesLogOpen,setNotesLogOpen]=useState(false)
 /** تقييد ملاحظة الترويسة في سجل ملاحظات المورد بتاريخها وكاتبها ورقم الفاتورة */
 const commitPartyNote=(source:string)=>{const text=partyNote.trim();if(!text)return;if(supplierId<=0){toast.show('الملاحظة لم تُحفظ: الشراء النقدي بلا سجل مورد','error');return}
  try{addPartyNote({partyKind:'supplier',partyId:supplierId,text,userName:currentUser?.nameAr??setup.ownerName??'المالك',source});setPartyNote('')}catch(e){toast.show((e as Error).message,'error')}}
 /* سطر تدقيق الفاتورة المرحّلة: متى عُدِّلت ومن عدّلها ولماذا — سطر واحد في الشريط السفلي */
 const auditLine=formatInvoiceAuditLine(editingInvoice?.editHistory,currentUser?.nameAr??setup.ownerName??'المالك');
 /* إذن استلام المستودع: أصناف وكميات فقط — بلا أي سعر */
 const printWarehouseReceipt=()=>{if(!lines.length)return toast.show('أضف أصنافاً قبل طباعة إذن الاستلام','error');printHtml(buildWarehouseReceiptHtml({title:'إذن استلام من المستودع',docNumber:editingInvoice?.invoiceNumber??'مسودة',dateLabel:date,partyLabel:supplierId===-1?'مورد نقدي':suppliers.find(supplier=>supplier.id===supplierId)?.nameAr??'مورد غير محدد',branchLabel:branches.find(branch=>branch.warehouseId===warehouseId)?.nameAr??branches.find(branch=>branch.isMain)?.nameAr??'الفرع الرئيسي',companyName:setup.shopName??'المنشأة',userLabel:currentUser?.nameAr??setup.ownerName??'المالك',lines:lines.map(line=>{const item=items.find(row=>row.id===line.itemId);return{nameAr:item?.nameAr??`صنف #${line.itemId}`,qty:line.qty,unit:item?.baseUnit,code:item?.sku,barcode:item?.barcodes?.[0],warehouseAr:warehouses.find(warehouse=>warehouse.id===(line.warehouseId??warehouseId))?.nameAr}}),settings:warehouseReceipt}));toast.show('إذن الاستلام جاهز للطباعة — كميات فقط بلا أسعار 📦')};const saveDraft=()=>{upsertAdvancedInvoiceDraft({id:draftId,kind:'purchase',name:`مسودة مشتريات — ${supplierId===-1?'مورد نقدي':suppliers.find(s=>s.id===supplierId)?.nameAr??'بدون مورد'}`,payload:JSON.stringify({supplierId,projectId,supplierInvoiceNumber,purchaseOrderNumber,receiptStatus,mode,warehouseId,lines,expenses,applyTax,discount,discountAmount,paid,treasury,notes,date,dueDate,attachments})});unsaved.markClean();toast.show('حُفظت مسودة المشتريات محلياً ✓')};const applyDraft=(draft:AdvancedInvoiceDraft)=>{try{const d=JSON.parse(draft.payload);setSupplierId(d.supplierId??0);setProjectId(d.projectId??0);setSupplierInvoiceNumber(d.supplierInvoiceNumber??'');setPurchaseOrderNumber(d.purchaseOrderNumber??'');setReceiptStatus(d.receiptStatus??'received');setMode(d.mode??'simple');setWarehouseId(d.warehouseId??null);setLines(d.lines??[]);setExpenses(d.expenses??[]);setApplyTax(d.applyTax??false);setDiscount(d.discount??'0');setDiscountAmount(d.discountAmount??'');paidTouched.current=true;setPaid(d.paid??'');setTreasury(d.treasury??'1101');setNotes(d.notes??'');setDate(d.date??new Date().toISOString().slice(0,10));setDueDate(d.dueDate??'');setAttachments(d.attachments??[]);toast.show(`استُعيدت «${draft.name}» ✓`)}catch{toast.show('تعذر قراءة المسودة','error')}};const restoreDraft=()=>setDraftsOpen(true);const exportPdf=()=>{if(!lines.length)return toast.show('أضف أصنافاً قبل التصدير','error');toast.show('اختر «حفظ كـ PDF» في وجهة الطباعة 🖨️');printDraft('a4')};/* المعاينة الحية: الموديل يُبنى بإعدادات اللحظة وrebuild يعيد بناءه كاملاً */
const buildPrintModel=()=>{const live=useAppStore.getState().receipt;return buildSimpleDocModel({docTitle:'مسودة فاتورة شراء',invoiceNumber:'مسودة',refCode:'DRAFT',dateIso:date,partyLabel:supplierId===-1?'مورد نقدي':suppliers.find(s=>s.id===supplierId)?.nameAr??'مورد غير محدد',paymentLabel:toMinor(paid||'0',cur.decimals)>=total?'مدفوعة':'جزئية/آجلة',rows:pricedLines.map(l=>({nameAr:`${items.find(i=>i.id===l.itemId)?.sku||items.find(i=>i.id===l.itemId)?.barcodes?.[0]||l.itemId} — ${items.find(i=>i.id===l.itemId)?.nameAr??`صنف #${l.itemId}`}`, qty:l.qty,unitPriceMinor:l.unitPriceMinor,totalMinor:Math.round(l.qty*l.unitPriceMinor)})),totalMinor:total,paidMinor:Math.min(toMinor(paid||'0',cur.decimals),total),operatorName:currentUser?.nameAr??setup.ownerName??'المالك',settings:live});};const printDraft=(template:InvoiceTemplate)=>{if(!lines.length)return toast.show('أضف أصنافاً قبل المعاينة','error');const model=buildPrintModel();const live=useAppStore.getState().receipt;/* غير صامت ⇒ معاينة حرة في منتصف الشاشة ثم حوار الطباعة (نفس نمط فاتورة البيع) */if(!printSwitches.silentPrint){openPrintPreview({html:buildModelHtml(model,cur,live,template),wide:template!=='thermal',title:template!=='thermal'?'معاينة فاتورة الشراء قبل الطباعة':'معاينة الإيصال الحراري',rebuild:()=>{const r=useAppStore.getState().receipt;return buildModelHtml(buildPrintModel(),cur,r,template)}});return}printModelWithTemplate(model,cur,live,template)};const postInvoice=(approvedBy?:string|null)=>{try{const effectiveSupplierId=supplierId===-1?0:supplierId;if(fxOn&&mode!=='advanced')throw new Error('السداد بعملة أجنبية متاح في الفاتورة المتقدمة فقط');if(supplierId===-1&&totalPaidMinor<supplierDue)throw new Error('المشتريات النقدية يجب سداد مستحق المورد بالكامل');if(totalPaidMinor>supplierDue)throw new Error('المدفوع للمورد أكبر من مستحقه بعد خصم المصاريف المدفوعة مباشرة');if(supplierId!==-1&&!effectiveSupplierId)throw new Error('اختر المورد أو فاتورة نقدية');if(!lines.length)throw new Error('أضف صنفاً');const hasPending=mode!=='simple'&&lines.some(l=>l.orderedQty>l.qty+l.rejectedQty);if(mode!=='simple'&&receiptStatus==='received'&&hasPending)throw new Error('توجد كميات لم تُستلم؛ اختر استلاماً جزئياً');if(mode!=='simple'&&receiptStatus==='partial'&&!hasPending)throw new Error('لا توجد كمية معلقة لتسجيل استلام جزئي');if(mode!=='simple'&&receiptStatus==='pending'){saveDraft();toast.show('الفاتورة بانتظار الاستلام؛ لم يُنشأ قيد أو تحديث مخزون');return};const p=postPurchase({supplierId:effectiveSupplierId,approvedBy:approvedBy??null,projectId:mode!=='simple'&&setup.modules.includes('contracting')?(projectId||null):null,supplierInvoiceNumber,purchaseOrderNumber,receiptStatus:mode==='simple'?'received':receiptStatus,dueDate:mode==='simple'?'':dueDate,date,lines:pricedLines.map((line) => { const { key, warehouseSource, ...l } = line; void key; void warehouseSource; return { ...l, vatPercent: taxPolicy.effectivePercent === 0 ? 0 : l.vatPercent } }),expenses:expenses.map(e=>!applyTax||taxPolicy.effectivePercent===0?{...e,taxTreatment:'exempt' as const,taxPercent:0}:e),paidMinor:totalPaidMinor,paymentAllocations,treasury,warehouseId,inputVatMinor:lineInputVat,purchaseExpenseTaxRecoverable:taxPolicy.canRecoverInputTax,notes,fx:fxOn?{currencyCode:fxLeg.currencyCode,amountMinor:fxLeg.amountMinor,ratePpm:fxLeg.ratePpm,decimals:fxLeg.decimals}:undefined,bookDecimals:cur.decimals,bookCurrencyCode:cur.code});attachments.forEach(file=>{try{addDocumentFile({documentKind:'purchase',documentId:p.id,name:file.name,mime:file.mime,dataUrl:file.dataUrl,addedBy:currentUser?.nameAr??setup.ownerName??'المالك'})}catch{/* مرفق تالف لا يمنع ترحيل الفاتورة */}});setAttachments([]);deleteAdvancedInvoiceDraft(draftId);commitPartyNote(p.invoiceNumber);/* أمر الشراء المصدر يُحدَّث بالمستلم فتتغيّر حالته تلقائياً (جزئي/مكتمل) */
  if(sourceOrderId!=null)receivePurchaseOrder(sourceOrderId,pricedLines.map(line=>({itemId:line.itemId,qty:line.qty})),p.id)
  toast.show(`تم ترحيل ${p.invoiceNumber} وتحديث التكلفة والمخزون ✓`);/* مفاتيح الطباعة: «طباعة بعد الحفظ» تطبع فوراً بالنمط الذي يحدده مفتاح «طباعة كاشير» */if(printSwitches.printAfterSave){try{printDraft(printSwitches.cashierPrint?'thermal':'a4')}catch{/* الطباعة لا تعطّل الترحيل */}}finishDocument()}catch(e){toast.show((e as Error).message,'error')}};const editApproval=useSupervisorApproval('pur.invoice.edit');const editInvoice=(approvedBy?:string|null)=>{if(!editingInvoice)return;void approvedBy;try{if(!editReason.trim())throw new Error('سبب التعديل مطلوب لسجل التدقيق');if(!lines.length)throw new Error('الفاتورة المعدلة بلا أصناف');const updated=editPurchase({purchaseId:editingInvoice.id,supplierId:supplierId===-1?0:supplierId,lines:pricedLines.map(line=>{const{key,warehouseSource,orderedQty,rejectedQty,...clean}=line;void key;void warehouseSource;void orderedQty;void rejectedQty;return clean}),warehouseId,expenses:activeExpenses,paidMinor:totalPaidMinor,treasury,paymentAllocations:editingInvoice.paymentAllocations,supplierInvoiceNumber,purchaseOrderNumber,dueDate,notes,reason:editReason,einvoiceActive,inputVatMinor:lineInputVat});toast.show(`عُدلت ${updated.invoiceNumber} — عُكس القيد القديم وتولد قيد جديد صحيح ✓`);finishDocument()}catch(e){toast.show((e as Error).message,'error')}};const save=()=>{if(editingInvoice){editApproval.request(by=>editInvoice(by));return}if(expenses.some(e=>e.costTreatment==='period'||e.paidBy==='payable'))approval.request(by=>postInvoice(by));else postInvoice()};const invoiceSignature=JSON.stringify({mode,supplierId,projectId,supplierInvoiceNumber,purchaseOrderNumber,receiptStatus,warehouseId,lines,expenses,applyTax,discount,discountAmount,paid:paidTouched.current?paid:'',fxOn,fxCode,fxAmount,fxRate,treasury,notes,date,dueDate,editReason,editingId:editingInvoice?.id??null});const unsaved=useUnsavedChangesGuard(invoiceSignature);const finishDocument=()=>{if(host){host.setDirty(false);host.close()}else nav('/purchases/invoices')};const closeActionsRef=useRef({save:()=>{},discard:()=>{}});useEffect(()=>{closeActionsRef.current={save:()=>{saveDraft();finishDocument()},discard:()=>deleteAdvancedInvoiceDraft(draftId)}});useEffect(()=>{if(!host)return;host.setClosePrompt({hint:'هذه فاتورة المشتريات لم تُرحَّل بعد. «إغلاق وحذف المسودة» يمسح ما كتبته نهائياً ولا يمكن استرجاعه — أو احفظها كمسودة باسم المورد وافتحها لاحقاً من زر «المسودات».',saveLabel:'حفظ كمسودة ثم الإغلاق',discardLabel:'إغلاق وحذف المسودة',onSave:()=>closeActionsRef.current.save(),onDiscard:()=>closeActionsRef.current.discard()});return()=>host.setClosePrompt(null)},[host]);const hostSetDirty=host?.setDirty;const hostDirty=unsaved.isDirty;useEffect(()=>{hostSetDirty?.(hostDirty)},[hostSetDirty,hostDirty]);const goTo=(path:string)=>{if(!guardNavigation(()=>nav(path)))nav(path)};const selectedSupplier=suppliers.find(supplier=>supplier.id===supplierId)??null;const selectedSupplierBalance=selectedSupplier?getSupplierBalance(selectedSupplier.id):0;const projectedSupplierBalance=selectedSupplierBalance+Math.max(0,supplierDue-totalPaidMinor);const [activeItemId,setActiveItemId]=useState<number|null>(null)
 /* «الصنف المحدد» يتبع السطر النشِط في الجدول (نقراً أو بالأسهم) لا آخر سطر فقط */
 const focusedItem=(activeItemId!=null?items.find(item=>item.id===activeItemId):null)??(lines.length?items.find(item=>item.id===lines[lines.length-1].itemId)??null:null)
 /* الحقول حسب نمط المحرِّر (قرار المالك ⑩ح): المبسط أربعة حقول · بيع مباشر يضيف
    الشريطين · الاحترافي/المتقدم كل الحقول. نفس قاعدة فاتورة البيع حرفياً. */
 const fullFields=mode==='profit'||mode==='advanced'
 const showStrips=mode!=='simple'

 /* «تعبئة من» (طلب المالك): بنود فاتورة الشراء تُنسخ من أمر شراء مفتوح.
    إصلاح (مراجعة المالك 2026-10-01): التعبئة كانت تنسخ الكمية والسعر فقط —
    الضريبة تُنسخ من الأمر وتُفعَّل رقاقة الخضوع إن كان فيها ضريبة، وبنود الأمر
    بلا ضريبة ترث نسبة السياسة عندما تكون الفاتورة خاضعة، ويُقيد رقم الأمر مرجعاً. */
 const [sourceOrderId,setSourceOrderId]=useState<number|null>(null)
 const applyPurchaseOrder=(order:PurchaseOrder)=>{
  const remainingLines=order.lines.filter(line=>poRemainingQty(line)>0)
  if(!remainingLines.length){toast.show('كل بنود هذا الأمر استُلمت بالفعل','error');return}
  if(order.supplierId)setSupplierId(order.supplierId)
  if(order.warehouseId)setWarehouseId(order.warehouseId)
  const poHasVat=remainingLines.some(line=>(line.vatPercent||0)>0)
  if(poHasVat&&!applyTax&&taxPolicy.effectivePercent>0)setApplyTax(true)
  /* أمر فيه ضريبة صراحةً ⇒ نُقل نسبة كل بند كما هي (0 فيه = إعفاء صريح)؛
     أمر بلا ضريبة (كما ينشئها محرر الأوامر) ⇒ ترث بنوده رقاقة خضوع الفاتورة */
  const lineVat=(line:PurchaseOrderLine)=>poHasVat?(line.vatPercent||0):((applyTax&&taxPolicy.effectivePercent>0)?taxPolicy.effectivePercent:0)
  setLines(remainingLines.map(line=>({
   key:crypto.randomUUID(),itemId:line.itemId,qty:poRemainingQty(line),orderedQty:poRemainingQty(line),rejectedQty:0,
   unitPriceMinor:line.unitPriceMinor,vatPercent:lineVat(line),warehouseId:order.warehouseId??warehouseId,warehouseSource:'default' as const,
  })))
  setSourceOrderId(order.id)
  setPurchaseOrderNumber(order.orderNumber)
  toast.show(`عُبِّئت الفاتورة من ${order.orderNumber} — ${remainingLines.length} بند`)
 }
 /* مرجع أحدث نسخة من دالة التعبئة حتى لا تحبس لوحة «تعبئة من» قيماً قديمة */
 const fillApplyRef=useRef(applyPurchaseOrder)
 fillApplyRef.current=applyPurchaseOrder
 const fillSources=useMemo<FillSource[]>(()=>purchaseOrders
  .filter(order=>order.status!=='cancelled'&&order.lines.some(line=>poRemainingQty(line)>0))
  .map(order=>({
   id:order.orderNumber,
   group:'أوامر الشراء' as const,
   title:`${order.orderNumber} — ${order.supplierName}`,
   hint:`تسليم ${order.expectedDate} · ${PURCHASE_ORDER_STATUS_AR[order.status]}`,
   lineCount:order.lines.filter(line=>poRemainingQty(line)>0).length,
   apply:()=>fillApplyRef.current(order),
  })),[purchaseOrders])
 /* زر «فاتورة استلام» في شاشة أوامر الشراء يفتح هذه الفاتورة معبَّأة من الأمر مباشرة
    (خصائص النافذة)، والمرة واحدة لكل فتح حتى لا تُداس تعديلات المستخدم */
 const prefillPoId=Number((host?.props.prefill as {purchaseOrderId?:number}|undefined)?.purchaseOrderId??searchParams.get('po')??0)
 const prefillApplied=useRef(false)
 useEffect(()=>{
  if(prefillApplied.current||!prefillPoId||editingInvoice)return
  const order=purchaseOrders.find(row=>row.id===prefillPoId)
  if(!order)return
  prefillApplied.current=true
  applyPurchaseOrder(order)
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[prefillPoId,editingInvoice?.id,purchaseOrders])

 return <InvoicePOSFrame auditLabel={auditLine ?? undefined} onWarehouseReceipt={printWarehouseReceipt} kind="purchase" modeLabel={editingInvoice ? 'تعديل فاتورة' : modes[mode]} currencyLabel={`${cur.code} · ${cur.symbol}`} dateLabel={date} branchLabel={branches.find(branch => branch.warehouseId === warehouseId)?.nameAr ?? branches.find(branch => branch.isMain)?.nameAr ?? 'وضع الفرع الواحد'} userLabel={currentUser?.nameAr ?? setup.ownerName ?? 'المالك'} activityLabel={getActivity(setup.activityId)?.nameAr ?? 'نشاط عام'}  headerFields={
 <>
  <Field label="المورد" icon={<Truck size={11}/>} extra={<FillFromPicker sources={fillSources}/>}><div className="invoice-pos-party-field invoice-doc-infield"><button type="button" className="invoice-pos-edit-party" onClick={()=>{if(host&&selectedSupplier){openPartyEditorWindow('supplier',selectedSupplier.id,host.windowId);return}setPartyEditorOpen(true)}} disabled={!selectedSupplier} title="تعديل بيانات المورد"><Pencil size={8}/></button><PartyQuickPicker parties={suppliers} value={supplierId} onChange={setSupplierId} cashValue={-1} cashLabel="مورد نقدي" label="بحث المورد — F4" partyInfo={supplierPickerInfo} onConfirm={()=>window.dispatchEvent(new Event('shopsys:focus-item'))} autoFocus/><span className="invoice-doc-infield-chip">{selectedSupplier?partyCode('SUP',selectedSupplier.id):'CASH'}</span></div></Field>
  <Field label="التاريخ" icon={<CalendarDays size={11}/>}><input type="date" className={inputCls} value={date} onChange={e=>setDate(e.target.value)}/></Field>
  {fullFields&&<Field label="الاستحقاق" icon={<CalendarClock size={11}/>}><input type="date" min={date} className={inputCls} value={dueDate} onChange={e=>setDueDate(e.target.value)}/></Field>}
  <Field label="المخزن" icon={<WarehouseIcon size={11}/>}><QuickSelect className={inputCls} value={warehouseId??''} onChange={e=>changeWarehouse(e.target.value?Number(e.target.value):null)}><option value="">كل المخازن — اختيار لكل سطر</option>{warehouses.map(w=><option key={w.id} value={w.id}>{w.nameAr}</option>)}</QuickSelect></Field>
  {fullFields&&<Field label="المرجع" icon={<Link2 size={11}/>}><input className={inputCls} value={supplierInvoiceNumber} onChange={e=>setSupplierInvoiceNumber(e.target.value)} placeholder="رقم الفاتورة الواردة من المورد"/></Field>}
  <Field label="النمط" icon={<Boxes size={11}/>}><QuickSelect className={inputCls} value={mode} onChange={e=>setMode(e.target.value as InvoiceEditorMode)} aria-label="نمط تحرير الفاتورة">{Object.entries(modes).filter(([key])=>key!=='profit'||canViewCost).map(([k,v])=><option key={k} value={k}>{v}</option>)}</QuickSelect></Field>
 </>
}partyMeta={showStrips?<div className="invoice-doc-partymeta">
   <span>التصنيف: <b>{selectedSupplier?.category?.trim()||'مورد عام'}</b></span>
   <span>شروط السداد: <b>{selectedSupplier?.paymentTermsDays?`${selectedSupplier.paymentTermsDays} يوماً`:'نقدي'}</b></span>
   <span>الحالة: <b>{supplierId===-1?'شراء نقدي':selectedSupplier?.active===false?'مورد موقوف':'مورد نشط'}</b></span>
   <button type="button" onClick={()=>{if(!selectedSupplier)return toast.show('اختر مورداً مسجَّلاً أولاً','error');setPartyEditorOpen(true)}}>✎ تعديل التصنيف والبيانات</button>
   <span className="invoice-doc-stripsep" aria-hidden="true" />
   <span className="invoice-doc-stripfield">أمر الشراء<input value={purchaseOrderNumber} onChange={e=>setPurchaseOrderNumber(e.target.value)} placeholder="رقم داخلي — اختياري" aria-label="رقم أمر الشراء الداخلي"/></span>
   <span className="invoice-doc-stripfield">الاستلام
    <QuickSelect aria-label="حالة استلام البضاعة" value={receiptStatus} onChange={e=>setReceiptStatus(e.target.value as typeof receiptStatus)}><option value="pending">بانتظار الاستلام</option><option value="partial">استلام جزئي</option><option value="received">مستلمة</option></QuickSelect>
   </span>
   <label className="invoice-doc-stripcheck" title="خضوع الفاتورة للضريبة"><input type="checkbox" checked={applyTax} onChange={e=>{const enabled=e.target.checked;setApplyTax(enabled);/* إصلاح (مراجعة المالك 2026-10-01): كانت تكتب vatPercentOverride — حقل وهمي في فاتورة الشراء لا تقرؤه الترحيل، فلا تتغير ضريبة السطور الموجودة؛ السطور هنا تحمل vatPercent مباشرة */setLines(previous=>previous.map(line=>({...line,vatPercent:enabled?taxPolicy.effectivePercent:0})))}}/> خاضعة للضريبة {applyTax?`${taxPolicy.effectivePercent}%`:''}</label>
   {setup.modules.includes('contracting')&&<span className="invoice-doc-stripfield">المشروع
    <QuickSelect aria-label="المشروع أو مركز الربحية" value={projectId} onChange={e=>setProjectId(Number(e.target.value))}><option value={0}>بدون مشروع</option>{projects.filter(p=>p.status==='active').map(p=><option key={p.id} value={p.id}>{p.nameAr}</option>)}</QuickSelect>
   </span>}
   {editingInvoice&&<span className="invoice-doc-stripfield is-warn">سبب التعديل<input value={editReason} onChange={e=>setEditReason(e.target.value)} placeholder="إلزامي — يُحفظ في سجل التدقيق" aria-label="سبب تعديل المستند"/></span>}
   <span className="invoice-doc-noteline" title={selectedSupplier?`ملاحظة تُحفظ في سجل ملاحظات ${selectedSupplier.nameAr}`:'اختر مورداً مسجَّلاً لحفظ الملاحظة في سجله'}>
    <button type="button" className="invoice-doc-notebtn" onClick={()=>{if(!selectedSupplier)return toast.show('اختر مورداً مسجَّلاً لعرض سجل ملاحظاته','error');setNotesLogOpen(true)}} title="سجل كل ملاحظات المورد — تتبّع وتعديل وحذف">ملاحظات المورد{!!selectedSupplier&&partyNotesFor(partyNotes,'supplier',selectedSupplier.id).length>0?` (${partyNotesFor(partyNotes,'supplier',selectedSupplier.id).length})`:''}</button>
    <input value={partyNote} onChange={e=>setPartyNote(e.target.value)} placeholder={selectedSupplier&&partyNotesFor(partyNotes,'supplier',selectedSupplier.id).length?`آخر ملاحظة: ${partyNotesFor(partyNotes,'supplier',selectedSupplier.id)[0].text}`:(selectedSupplier?`اكتب ملاحظة عن ${selectedSupplier.nameAr} — تُحفظ في سجل ملاحظاته بتاريخها ورقم الفاتورة`:'اكتب ملاحظة — تُحفظ في سجل ملاحظات المورد عند اختيار مورد مسجَّل')} aria-label="ملاحظة تُحفظ في سجل ملاحظات المورد"/>
   </span>
  </div>:undefined}  partyProfile={<>
 <div className="invoice-doc-cardhead"><b><Truck size={11}/> حساب {selectedSupplier?'المورد':'الشراء النقدي'}</b><span className={`invoice-party-state ${!selectedSupplier?'is-cash':selectedSupplier.active===false?'is-off':''}`} title={!selectedSupplier?'شراء نقدي بلا حساب آجل':selectedSupplier.active===false?'الحساب موقوف — راجع ملف المورد':'الحساب نشط'}><i/>{!selectedSupplier?'نقدي':selectedSupplier.active===false?'موقوف':'نشط'}</span></div>
 <div className="invoice-doc-metric"><span>شروط السداد</span><b>{selectedSupplier?.paymentTermsDays?`${selectedSupplier.paymentTermsDays} يوم`:'نقدي'}</b></div>
 <div className="invoice-doc-metric"><span>الرصيد السابق</span><b dir="ltr" className={`is-${partyBalanceTone(-selectedSupplierBalance)}`} title={partyBalanceText(selectedSupplierBalance,!!selectedSupplier,cur,{owes:'مستحق له',owed:'لك عنده'})}>{selectedSupplier?`${formatMinor(Math.abs(selectedSupplierBalance),cur,false)} ${cur.symbol}`:'نقدي'}</b></div>
 <div className="invoice-doc-cardfoot"><span>الرصيد بعد الترحيل</span><b dir="ltr" className={`is-${partyBalanceTone(-projectedSupplierBalance)}`} title="رصيد المورد بعد ترحيل هذه الفاتورة وخصم المسدَّد منها">{selectedSupplier?`${formatMinor(Math.abs(projectedSupplierBalance),cur,false)} ${cur.symbol}`:'نقدي'}</b></div>
 {selectedSupplier?.active===false&&<div className="invoice-doc-cardwarn">موقوف — الشراء الآجل ممنوع</div>}
</>} itemProfile={showStrips?<>
 <span className="invoice-doc-strip-k">الصنف المحدد</span><span className="invoice-doc-strip-v">{focusedItem?focusedItem.nameAr:'—'}</span>
 <span className="invoice-doc-stripsep" aria-hidden="true" />
 <span className="invoice-doc-strip-k">المتاح</span><span className="invoice-doc-strip-v" dir="ltr">{focusedItem?`${focusedItem.stockQty??0} ${focusedItem.baseUnit??''}`:'—'}</span>
 {canViewCost&&<><span className="invoice-doc-stripsep" aria-hidden="true" /><span className="invoice-doc-strip-k">متوسط التكلفة</span><span className="invoice-doc-strip-v" dir="ltr">{focusedItem?formatMinor(focusedItem.costMinor,cur,false):'—'}</span></>}
 <span className="invoice-doc-stripsep" aria-hidden="true" />
 <span className="invoice-doc-strip-k">سعر البيع الحالي</span><span className="invoice-doc-strip-v is-ok" dir="ltr">{focusedItem?formatMinor(focusedItem.priceMinor,cur,false):'—'}</span>
 <span className="invoice-doc-stripspacer" />
 <span className="invoice-doc-strip-k">حد الطلب</span><span className="invoice-doc-strip-v">{focusedItem?((focusedItem.stockQty??0)<=focusedItem.minQty?'دون حد إعادة الطلب':'فوق حد إعادة الطلب'):'—'}</span>
</>:undefined} onBack={() => unsaved.requestClose(() => finishDocument())} onNavigate={goTo} onPartySearch={() => window.dispatchEvent(new Event('shopsys:open-party'))} onItemSearch={() => window.dispatchEvent(new Event('shopsys:open-item'))} onSaveDraft={saveDraft} draftCount={advancedInvoiceDrafts.filter(d=>d.kind==='purchase').length} onRestoreDraft={restoreDraft} onPrint={() => setPrintOpen(true)} onOpenPrintSettings={()=>setPrintSettingsOpen(true)} onQuickPrint={()=>printDraft((useDataStore.getState().userPrefs[String(currentUserId??'owner')]?.preferredPrintTemplate)??(printSwitches.cashierPrint?'thermal':'a4'))} onExportPdf={exportPdf} onPost={save}
  documentNumber={editingInvoice?editingInvoice.invoiceNumber:undefined}
>
<section className="invoice-shell invoice-reference-shell overflow-visible rounded-b-2xl border-x border-b border-slate-300 bg-white shadow-lg dark:border-slate-700 dark:bg-card-dark"><PartyQuickEditModal open={partyEditorOpen} target={selectedSupplier?{kind:'supplier',party:selectedSupplier}:null} currencyDecimals={cur.decimals} currencySymbol={cur.symbol} onClose={()=>setPartyEditorOpen(false)}/>
  <div className="invoice-body-grid">
   <div className="invoice-lines-column">
  <InvoiceLinesTable
   entry={<ItemQuickPicker items={items} onPick={addItem} onEdit={id => openItemEditorWindow(id, host?.windowId ?? null)} onMovement={id => openItemLedgerWindow(id, host?.windowId ?? null)} itemMeta={item => ({ category: categories.find(cat => cat.id === item.categoryId)?.nameAr ?? '—', unit: item.baseUnit ?? '', stock: item.isService ? 'خدمة' : String(item.stockQty ?? 0), low: !item.isService && (item.stockQty ?? 0) <= 0, price: formatMinor(item.priceMinor ?? 0, cur, false), cost: formatMinor(item.costMinor ?? 0, cur, false) })} categories={categories} onPrices={id => openItemPricesWindow(id, host?.windowId ?? null)} amountLabel={item => `متاح ${item.stockQty ?? 0} · تكلفة ${formatMinor(item.costMinor ?? 0, cur, false)}`} placeholder="امسح الباركود أو اكتب اسم الصنف / الكود السريع" />}
   kind="purchase"
   mode={mode}
   lines={lines}
   items={items}
   warehouses={warehouses}
   warehouseId={warehouseId}
   currencyCode={cur.code}
   currencyDecimals={cur.decimals}
   currencySymbol={cur.symbol}
   canViewCost={canViewCost}
   taxEnabled={applyTax && taxPolicy.effectivePercent > 0}
   costShares={new Map(allocations.map(row => [row.key, row.share]))}
   onMoveLine={(key, direction) => setLines(previous => { const at = previous.findIndex(line => line.key === key); const to = at + direction; if (at < 0 || to < 0 || to >= previous.length) return previous; const next = [...previous]; const [row] = next.splice(at, 1); next.splice(to, 0, row); return next })}
   onDuplicate={key => setLines(previous => { const source = previous.find(line => line.key === key); if (!source) return previous; const copy = { ...source, key: crypto.randomUUID() }; const at = previous.findIndex(line => line.key === key); return [...previous.slice(0, at + 1), copy, ...previous.slice(at + 1)] })}
   documentTaxPercent={applyTax ? taxPolicy.effectivePercent : 0}
   onPick={addItem}
   onActiveItem={setActiveItemId}
   onPatch={(key, patchValue) => patch(key, patchValue as Partial<Line>)}
   onRemove={key => setLines(lines.filter(line => line.key !== key))}
   onReplaceLine={replaceLineItem}
   onEdit={id => openItemEditorWindow(id, host?.windowId ?? null)}
   onMovement={id => openItemLedgerWindow(id, host?.windowId ?? null)}
   onPrices={id => openItemPricesWindow(id, host?.windowId ?? null)}
   amountLabel={item => `متاح ${item.stockQty ?? 0} · تكلفة ${formatMinor(item.costMinor ?? 0, cur, false)}`}
   placeholder="اكتب اسم الصنف أو الكود؛ ثم اختر بالسهم + Enter أو مرتين"
   showPicker={false}
  />
   </div>
  <Modal open={notesLogOpen&&!!selectedSupplier} onClose={() => setNotesLogOpen(false)} title={`سجل ملاحظات ${selectedSupplier?.nameAr??'المورد'}`}>
   {selectedSupplier&&<PartyNotesLog kind="supplier" partyId={selectedSupplier.id} partyName={selectedSupplier.nameAr} />}
  </Modal>
  <Modal open={expensesDialog} onClose={() => setExpensesDialog(false)} title="مصروفات الشراء والتكلفة المحملة" extraWide><PurchaseExpenseManager expenses={expenses} onChange={setExpenses} expenseTemplates={expenseTemplates} onAddTemplate={addExpenseTemplate} costCenters={costCenters} vehicles={vehicles} treasuries={treasuries} custodyFiles={custodyFiles} currencyDecimals={cur.decimals} taxPercent={taxPolicy.effectivePercent} taxEnabled={applyTax && taxPolicy.canRecoverInputTax} defaultTreasury={treasury} /><div className="flex justify-end mt-3"><Btn onClick={() => setExpensesDialog(false)}>تم</Btn></div></Modal>
    {/* إعدادات الطباعة السريعة من فاتورة الشراء (طلب المالك): نافذة منبثقة + «المزيد» لقسم الطباعة */}
    <PrintSettingsPopup open={printSettingsOpen} onClose={()=>setPrintSettingsOpen(false)} wide={!printSwitches.cashierPrint}/>
    {/* نافذة أسعار الصرف — مفلترة تلقائياً على العملة المختارة في الفاتورة (طلب المالك) */}
    <Modal open={fxRatesOpen} onClose={()=>setFxRatesOpen(false)} title={`سعر ${fxCode} مقابل ${cur.code} — تعديل بأسعار الصرف`} data-fx-rates-popup>
      <FxRatesManager focusCode={fxCode} onDone={()=>setFxRatesOpen(false)} />
    </Modal>
<section className="invoice-totals-footer">
   {/* ① الشروط والملاحظات */}
   <div className="invoice-doc-panel" data-invoice-notes>
    <div className="invoice-doc-panel-head"><span className="invoice-doc-panel-icon"><ScrollText size={11}/></span><b>الملاحظات وشروط التوريد</b><small>تُحفظ مع المستند</small></div>
    <div className="invoice-doc-panel-body">
     <div className="invoice-doc-quick" data-invoice-terms>{PURCHASE_TERMS.map(term=><button key={term} type="button" title="إضافة الشرط إلى مربع الشروط" onClick={()=>setNotes(notes.trim()?`${notes.trim()}\n${term}`:term)}>+ {term}</button>)}</div>
     <textarea className={`${inputCls} invoice-doc-termsbox`} value={notes} onChange={e=>setNotes(e.target.value)} aria-label="ملاحظات وشروط المستند" placeholder="اختر شرطاً من الأزرار أعلاه أو اكتب شروطك هنا — تظهر في نسخة المورد"/>
     <div className="invoice-doc-addons">
      <button type="button" className="is-amber" onClick={()=>setExpensesDialog(true)} title="شحن · جمارك · تأمين — تُحمَّل على تكلفة المخزون أو تُقيَّد مصروف فترة، ولا تدخل إجمالي فاتورة المورد">＋ مصاريف الشراء <span className="invoice-doc-count">{expenses.length}</span></button>
      {fullFields&&<button type="button" onClick={()=>setExpensesDialog(true)} title="عرض وتعديل المصاريف المحمَّلة على هذه الفاتورة">☰ إدارة المصاريف</button>}
     </div>
     {expenses.length>0&&<div className="invoice-doc-addonlist">{expenses.map((expense,index)=><span key={index}>{expense.nameAr}: {formatMinor(expense.amountMinor,cur,false)} · {(expense.costTreatment??'inventory')==='inventory'?'على المخزون':'على المحل'} · {expense.paidBy==='payable'?'مستحق':expense.paidBy==='supplier'?'على المورد':'مدفوع'}</span>)}</div>}
    </div>
    <div className="invoice-doc-panel-foot"><DocumentAttachmentsBox documentKind="purchase" documentId={editingInvoice?.id??null} pending={attachments} onPendingChange={setAttachments} addedBy={currentUser?.nameAr??setup.ownerName??'المالك'}/><span>شروط سداد المورد</span><b>{selectedSupplier?.paymentTermsDays?`${selectedSupplier.paymentTermsDays} يوم`:'نقدي'}</b></div>
   </div>
   {/* ② الدفع الآن */}
   <div className="invoice-doc-panel">
    <div className="invoice-doc-panel-head"><span className="invoice-doc-panel-icon"><Wallet size={11}/></span><b>الدفع الآن</b><small>نقدية / بنك</small></div>
    <div className="invoice-doc-panel-body">
     <PaymentMethodPicker value={{treasury,terminalPayment:{terminalId:'',providerReference:'',cardLast4:''}}} onChange={value=>setTreasury(value.treasury)} operation="payment" allowTerminal={false}/>
     <Field label={fxOn?`المبلغ المدفوع بعملة الدفتر (محسوب من ${fxCode})`:"المبلغ المدفوع الآن"}><div className="invoice-doc-amountfield"><input data-invoice-paid="true" className={inputCls} readOnly={fxOn} value={fxOn?formatMinor(fxBookMinor,cur,false):paid} onChange={e=>{paidTouched.current=true;setPaid(e.target.value)}} inputMode="decimal" placeholder="0.00"/><span className="invoice-doc-amountcur">{cur.code}</span></div></Field>
     {/* السداد بعملة أجنبية: للفاتورة المتقدمة فقط (طلب المالك 2026-10-01) */}
     {mode==='advanced'&&<div className="invoice-doc-fx" data-invoice-fx="true">
      <label className="invoice-doc-fx-toggle"><input type="checkbox" checked={fxOn} onChange={e=>{const on=e.target.checked;setFxOn(on);paidTouched.current=true;if(on){setPaid('')}else{setFxAmount('');setFxRate('')}}}/><span>سداد بعملة أجنبية</span><small>القيد يبقى بعملة الدفتر {cur.code}</small></label>
      {fxOn&&<><div className="invoice-doc-panel-grid">
       <div>
        <Field label="العملة"><select data-invoice-fx-code="true" className={inputCls} value={fxCode} onChange={e=>setFxCode(e.target.value)}>{COMMON_FX_CURRENCIES.filter(row=>row.code!==cur.code).map(row=><option key={row.code} value={row.code}>{row.code} — {row.nameAr}</option>)}</select></Field>
        <button type="button" className="invoice-doc-fx-today" data-fx-today onClick={()=>setFxRatesOpen(true)} title="اضغط لفتح نافذة أسعار الصرف — مفلترة تلقائياً على هذه العملة">
          {fxRates[fxCode]?<>سعر اليوم: <b dir="ltr">{formatRate(fxLeg.ratePpm||fxRates[fxCode].ratePpm)}</b> {fxCode}→{cur.code} · {fxRateAgeLabel(fxRates[fxCode])} · اضغط للتعديل</>:<>لا سعر محفوظ لـ{fxCode} — اضغط لتعيينه</>}
        </button>
       </div>
       <Field label={`المبلغ بالـ${fxCode}`}><input data-invoice-fx-amount="true" className={inputCls} value={fxAmount} onChange={e=>setFxAmount(e.target.value)} inputMode="decimal" placeholder="0.00" dir="ltr"/></Field>
       <Field label={`سعر الصرف مقابل ${cur.code}`}><input data-invoice-fx-rate="true" className={inputCls} value={fxRate} onChange={e=>setFxRate(e.target.value)} inputMode="decimal" placeholder="0.000000" dir="ltr"/></Field>
      </div>
      <p className={fxErrors.length?"invoice-doc-panel-note is-danger":"invoice-doc-panel-note"} data-invoice-fx-note="true">{fxErrors.length?fxErrors.join(' — '):`${describeFxLeg(fxLeg,fxBookMinor,cur.decimals)} — يُرحَّل بعملة الدفتر ${cur.code}؛ دين المورد ينقص بالمحوَّل ولا تُقيَّد فروق عملة`}</p></>}
     </div>}
     <p className="invoice-doc-panel-note">المصاريف المدفوعة من خزينة أو عهدة أو المسجلة كاستحقاق لا تُضاف إلى رصيد المورد.</p>
    </div>
    <div className="invoice-doc-panel-foot"><span>المستحق للمورد <b dir="ltr">{formatMinor(supplierDue,cur,false)} {cur.symbol}</b></span><span className="is-due">المتبقي <b dir="ltr">{formatMinor(Math.max(0,supplierDue-totalPaidMinor),cur,false)} {cur.symbol}</b></span></div>
   </div>
   {/* ③ الإجماليات */}
   <div className="invoice-doc-panel">
    <div className="invoice-doc-panel-head"><span className="invoice-doc-panel-icon"><Calculator size={11}/></span><b>إجمالي فاتورة الشراء</b><small>ملخص التكلفة</small></div>
    <div className="invoice-doc-panel-body">
     {/* كشف التكلفة بصفوف النموذج المعتمد ثم الإجمالي الكبير؛ المستحق والمتبقي
         في حاشية لوحة الدفع، وحالة القيد رقاقة في شريط المستند. */}
     <div className="invoice-doc-sum">
      <Row n="إجمالي الأصناف قبل الخصم" v={rawGoods}/>
      <Row n="الخصم" v={-discountMinor} minus/>
      <Row n="ضريبة المدخلات" v={lineInputVat}/>
      {supplierExpenses>0&&<Row n="مصاريف على فاتورة المورد" v={supplierExpenses}/>}
     </div>
     {/* قرار المالك: ما يُحمَّل على المخزون أو على المحل **لا يدخل إجمالي الفاتورة** —
         الإجمالي هو ما يطالب به المورد فقط، وما عداه معلومة تكلفة أسفله. */}
     <div className="invoice-doc-grand"><span>إجمالي فاتورة المورد</span><b><AnimatedMinor value={supplierDue} format={minor=>formatMinor(minor,cur,false)}/> {cur.symbol}</b></div>
     {(shopBorneExpenses>0||extra>0)&&<div className="invoice-doc-sum invoice-doc-suminfo">
      <Row n="مصاريف محمَّلة على المخزون (خارج الإجمالي)" v={extra} info/>
      {shopBorneExpenses>0&&<Row n="مصروفات على المحل (خارج الإجمالي)" v={shopBorneExpenses} info/>}
      <Row n="تكلفة البضاعة بعد التحميل — للتسعير" v={goods+extra} info/>
     </div>}
    </div>
   </div>
  </section>
  </div>
  </section>{approval.dialog}{editApproval.dialog}{unsaved.prompt}<InvoiceDraftsModal open={draftsOpen} onClose={()=>setDraftsOpen(false)} kind="purchase" drafts={advancedInvoiceDrafts} currency={cur} currentDraftId={draftId} onPick={applyDraft} onDelete={deleteAdvancedInvoiceDraft}/><PrintTemplateModal open={printOpen} onClose={()=>setPrintOpen(false)} defaultTemplate={receipt.defaultTemplate} title="معاينة نسخة المورد" onPrint={printDraft}/></InvoicePOSFrame>;function Row({n,v,strong,minus,info}:{n:string;v:number;strong?:boolean;minus?:boolean;info?:boolean}){return <div className={`invoice-doc-sum-row${strong?' is-strong':''}${minus&&v!==0?' is-minus':''}${info?' is-info':''}`}><span>{n}</span><i/><b><AnimatedMinor value={v} format={minor=>formatMinor(minor,cur,false)}/> {cur.symbol}</b></div>}}
