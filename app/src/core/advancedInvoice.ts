export type InvoiceEditorMode = 'simple' | 'standard' | 'profit' | 'advanced'
export type TaxTreatment = 'exempt' | 'exclusive' | 'inclusive'
export type ExpenseSettlement = 'paid_now' | 'payable_later'
export type LandedCostAllocation = 'none' | 'value' | 'quantity' | 'weight' | 'volume' | 'equal' | 'manual'
export interface AdvancedInvoiceLine { id:string; itemId:number|null; description:string; warehouseId:number|null; warehouseSource:'default'|'manual'; qty:number; unitPriceMinor:number; lineDiscountMinor:number; taxPercent:number; availableQty?:number; weight?:number; volume?:number }
export interface CustomerCharge { id:string; label:string; amountMinor:number; taxTreatment:TaxTreatment; taxPercent:number }
export interface InternalExpense { id:string; label:string; amountMinor:number; accountCode:string; partyId?:number|null; settlement:ExpenseSettlement; treasury?:string; payableAccountCode?:string; taxTreatment:TaxTreatment; taxPercent:number; affectsProfit:boolean; landedCostAllocation:LandedCostAllocation; manualAllocations?:Record<string,number> }
export interface AdvancedTotals { linesGrossMinor:number; lineDiscountMinor:number; invoiceDiscountMinor:number; netLinesMinor:number; customerChargesMinor:number; taxableMinor:number; taxMinor:number; roundingMinor:number; customerGrandMinor:number; internalExpensesMinor:number; expectedProfitMinor:number|null }
const validMinor=(n:number,name:string)=>{if(!Number.isSafeInteger(n)||n<0)throw new Error(`${name} غير صالح`)}
export function computeAdvancedTotals(args:{lines:AdvancedInvoiceLine[];invoiceDiscountMinor:number;charges:CustomerCharge[];expenses:InternalExpense[];roundingMinor?:number;cogsMinor?:number}):AdvancedTotals{
 validMinor(args.invoiceDiscountMinor,'خصم الفاتورة');let linesGrossMinor=0,lineDiscountMinor=0,taxMinor=0
 for(const l of args.lines){if(!Number.isFinite(l.qty)||l.qty<=0)throw new Error('كمية السطر يجب أن تكون موجبة');validMinor(l.unitPriceMinor,'سعر السطر');validMinor(l.lineDiscountMinor,'خصم السطر');const gross=Math.round(l.qty*l.unitPriceMinor);if(l.lineDiscountMinor>gross)throw new Error('خصم السطر يتجاوز قيمته');linesGrossMinor+=gross;lineDiscountMinor+=l.lineDiscountMinor;taxMinor+=Math.round((gross-l.lineDiscountMinor)*l.taxPercent/100)}
 const beforeInvoiceDiscount=linesGrossMinor-lineDiscountMinor;if(args.invoiceDiscountMinor>beforeInvoiceDiscount)throw new Error('خصم الفاتورة يتجاوز صافي البنود');const netLinesMinor=beforeInvoiceDiscount-args.invoiceDiscountMinor
 // خصم الفاتورة يخفض ضريبة البنود نسبياً.
 if(beforeInvoiceDiscount>0&&args.invoiceDiscountMinor>0)taxMinor=Math.round(taxMinor*netLinesMinor/beforeInvoiceDiscount)
 let customerChargesMinor=0,taxableChargeMinor=0
 for(const c of args.charges){validMinor(c.amountMinor,'الإضافة');customerChargesMinor+=c.amountMinor;if(c.taxTreatment==='exclusive') {taxableChargeMinor+=c.amountMinor;taxMinor+=Math.round(c.amountMinor*c.taxPercent/100)} else if(c.taxTreatment==='inclusive'){taxableChargeMinor+=Math.round(c.amountMinor/(1+c.taxPercent/100));taxMinor+=c.amountMinor-Math.round(c.amountMinor/(1+c.taxPercent/100))}}
 const internalExpensesMinor=args.expenses.filter(e=>e.affectsProfit).reduce((s,e)=>{validMinor(e.amountMinor,'المصروف الداخلي');return s+e.amountMinor},0)
 const roundingMinor=args.roundingMinor??0;if(!Number.isSafeInteger(roundingMinor))throw new Error('التقريب غير صالح')
 const customerGrandMinor=netLinesMinor+customerChargesMinor+taxMinor+roundingMinor
 const expectedProfitMinor=args.cogsMinor===undefined?null:customerGrandMinor-taxMinor-roundingMinor-(args.cogsMinor+internalExpensesMinor)
 return{linesGrossMinor,lineDiscountMinor,invoiceDiscountMinor:args.invoiceDiscountMinor,netLinesMinor,customerChargesMinor,taxableMinor:netLinesMinor+taxableChargeMinor,taxMinor,roundingMinor,customerGrandMinor,internalExpensesMinor,expectedProfitMinor}
}
export function applyDefaultWarehouse(lines:AdvancedInvoiceLine[],warehouseId:number|null){return lines.map(l=>l.warehouseSource==='manual'?l:{...l,warehouseId})}
export function inventoryWarnings(lines:AdvancedInvoiceLine[],allowNegative:boolean){return lines.flatMap(l=>{if(l.availableQty===undefined||l.qty<=l.availableQty)return[];const expected=l.availableQty-l.qty;return[{lineId:l.id,severity:allowNegative?'warning' as const:'error' as const,message:allowNegative?`سيصبح الرصيد ${expected}`:`المتاح ${l.availableQty} والمطلوب ${l.qty}`} ]})}
export function allocateLandedCost(expense:InternalExpense,lines:AdvancedInvoiceLine[]):Record<string,number>{
 if(expense.landedCostAllocation==='none')return{};if(expense.landedCostAllocation==='manual'){const a=expense.manualAllocations??{};if(Object.values(a).reduce((s,v)=>s+v,0)!==expense.amountMinor)throw new Error('التوزيع اليدوي لا يساوي المصروف');return a}
 const weights=lines.map(l=>expense.landedCostAllocation==='value'?l.qty*l.unitPriceMinor:expense.landedCostAllocation==='quantity'?l.qty:expense.landedCostAllocation==='weight'?(l.weight??0)*l.qty:expense.landedCostAllocation==='volume'?(l.volume??0)*l.qty:1);const total=weights.reduce((a,b)=>a+b,0);if(total<=0)throw new Error('لا يوجد أساس صالح لتوزيع المصروف');let used=0;const out:Record<string,number>={};lines.forEach((l,i)=>{const value=i===lines.length-1?expense.amountMinor-used:Math.round(expense.amountMinor*weights[i]/total);out[l.id]=value;used+=value});return out
}
