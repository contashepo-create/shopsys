import{describe,expect,it}from'vitest';import{allocateLandedCost,applyDefaultWarehouse,buildInternalExpenseLines,computeAdvancedTotals,inventoryWarnings,availableForDocEdit,saleCollectionSplit,type AdvancedInvoiceLine,type InternalExpense}from'../src/core/advancedInvoice.ts';
const lines:AdvancedInvoiceLine[]=[{id:'a',itemId:1,description:'أ',warehouseId:1,warehouseSource:'default',qty:2,unitPriceMinor:10000,lineDiscountMinor:1000,taxPercent:14,availableQty:1},{id:'b',itemId:2,description:'ب',warehouseId:2,warehouseSource:'manual',qty:1,unitPriceMinor:5000,lineDiscountMinor:0,taxPercent:14,availableQty:3}];
const expense:InternalExpense={id:'e',label:'تحميل',amountMinor:500,accountCode:'5101',settlement:'payable_later',taxTreatment:'exempt',taxPercent:0,affectsProfit:true,landedCostAllocation:'value'};
describe('الفاتورة المتقدمة',()=>{
it('يرتب الإجماليات ويفصل مصروف المنشأة عن فاتورة العميل',()=>{const t=computeAdvancedTotals({lines,invoiceDiscountMinor:1000,charges:[{id:'c',label:'شحن عميل',amountMinor:500,taxTreatment:'exempt',taxPercent:0}],expenses:[expense],cogsMinor:12000});expect(t).toMatchObject({linesGrossMinor:25000,lineDiscountMinor:1000,invoiceDiscountMinor:1000,netLinesMinor:23000,customerChargesMinor:500,internalExpensesMinor:500});expect(t.customerGrandMinor).toBe(26720);expect(t.expectedProfitMinor).toBe(11000)})
it('يجعل الإضافة الضريبية ديناميكية',()=>{const exempt=computeAdvancedTotals({lines:[],invoiceDiscountMinor:0,charges:[{id:'x',label:'شحن',amountMinor:500,taxTreatment:'exempt',taxPercent:14}],expenses:[]});const taxable=computeAdvancedTotals({lines:[],invoiceDiscountMinor:0,charges:[{id:'x',label:'شحن',amountMinor:500,taxTreatment:'exclusive',taxPercent:14}],expenses:[]});expect(exempt.taxMinor).toBe(0);expect(taxable.taxMinor).toBe(70)})
it('يغير المخزن الافتراضي ولا يمس السطر اليدوي',()=>expect(applyDefaultWarehouse(lines,9).map(l=>l.warehouseId)).toEqual([9,2]))
it('يمنع السالب أو يحذر حسب السياسة',()=>{expect(inventoryWarnings(lines,false)[0].severity).toBe('error');expect(inventoryWarnings(lines,true)[0]).toMatchObject({severity:'warning',message:'سيصبح الرصيد -1'})})
it('يثبت المصروف المدفوع أو المستحق بقيد متوازن ولا يحمله على العميل',()=>{const payable=buildInternalExpenseLines([expense]);expect(payable).toEqual([{accountCode:'5101',debit:500,credit:0,note:'مصروف داخلي — تحميل'},{accountCode:'2117',debit:0,credit:500,note:'مصروف مستحق — تحميل'}]);const paid=buildInternalExpenseLines([{...expense,settlement:'paid_now',treasury:'1102',taxTreatment:'exclusive',taxPercent:14}]);expect(paid.reduce((s,l)=>s+l.debit,0)).toBe(570);expect(paid.reduce((s,l)=>s+l.credit,0)).toBe(570)})
it('يوزع تكلفة الشراء المحملة بلا فرق تقريب',()=>{const a=allocateLandedCost(expense,lines);expect(Object.values(a).reduce((s,v)=>s+v,0)).toBe(500);expect(a.a).toBeGreaterThan(a.b)})
it('يدعم التوزيع اليدوي ويتحقق من مجموعه',()=>{expect(()=>allocateLandedCost({...expense,landedCostAllocation:'manual',manualAllocations:{a:100,b:100}},lines)).toThrow('لا يساوي')})
it('يستعيد التحصيل المجزأ من وسائل الفاتورة ولا ينهار إلى نقدي وحده عند التعديل',()=>{
 const cash=[{accountCode:'1101',amountMinor:6000,note:'تحصيل نقدي/بنكي'}]
 expect(saleCollectionSplit(cash,6000)).toEqual({cashMinor:6000,bankMinor:0,employeeMinor:0,employeeId:null,multiPay:false})
 const multi=[{accountCode:'1101',amountMinor:5000,note:'تحصيل نقدي/بنكي'},{accountCode:'1102',amountMinor:3000,note:'تحويل بنكي'}]
 expect(saleCollectionSplit(multi,8000)).toEqual({cashMinor:5000,bankMinor:3000,employeeMinor:0,employeeId:null,multiPay:true})
 const staff=[{accountCode:'1101',amountMinor:3000,note:'تحصيل نقدي/بنكي'},{accountCode:'1107',amountMinor:2000,note:'على حساب الموظف',employeeId:7}]
 expect(saleCollectionSplit(staff,5000)).toEqual({cashMinor:3000,bankMinor:0,employeeMinor:2000,employeeId:7,multiPay:false})
 const both=[{accountCode:'1101',amountMinor:2000,note:'تحصيل نقدي/بنكي'},{accountCode:'1102',amountMinor:4000,note:'تحويل بنكي'},{accountCode:'1107',amountMinor:2000,note:'على حساب الموظف',employeeId:9}]
 expect(saleCollectionSplit(both,8000)).toEqual({cashMinor:2000,bankMinor:4000,employeeMinor:2000,employeeId:9,multiPay:true})
 // سجل قديم مختل (وسائل ≠ مدفوع) أو بلا مدفوع ⇒ بلا تقسيم: المبلغ كله خزينة كما قبل — لا تُخترع أطراف
 expect(saleCollectionSplit(cash,3000)).toEqual({cashMinor:3000,bankMinor:0,employeeMinor:0,employeeId:null,multiPay:false})
 expect(saleCollectionSplit([],0)).toEqual({cashMinor:0,bankMinor:0,employeeMinor:0,employeeId:null,multiPay:false})
})
it('المتاح أثناء تعديل مستند مرحل = الرصيد الحالي + كمياته الأصلية',()=>{
 expect(availableForDocEdit(-10,10)).toBe(0)
 expect(inventoryWarnings([{id:'l',itemId:1,description:'صنف',warehouseId:null,warehouseSource:'manual',qty:5,unitPriceMinor:1000,lineDiscountMinor:0,taxPercent:0,availableQty:availableForDocEdit(-10,10)}],true)[0]).toMatchObject({message:'سيصبح الرصيد -5'})
})
})
