import { describe,expect,it } from 'vitest'
import { reconcileProviderStatement,summarizeReconciliation } from '../src/core/paymentProviderReconciliation.ts'
import type { PaymentTerminalTransaction } from '../src/core/paymentTerminalTransactions.ts'
const tx=(id:string,kind:'charge'|'refund',amountMinor:number):PaymentTerminalTransaction=>({id,idempotencyKey:id,kind,terminalId:'t',branchId:'b',userId:1,documentId:id,amountMinor,providerReference:id,occurredAt:'2026-01-01'})
describe('إقفال ومطابقة يوم الماكينة',()=>{
 it('يغلق يوماً متطابقاً يشمل البيع والرد',()=>{const m=reconcileProviderStatement('t',[{providerReference:'c',amountMinor:1000},{providerReference:'r',amountMinor:-200}],[tx('c','charge',1000),tx('r','refund',200)]);expect(summarizeReconciliation(m)).toEqual({matchedCount:2,exceptionCount:0,statementNetMinor:800,localNetMinor:800,differenceMinor:0,canClose:true})})
 it('يرفض الإقفال عند مفقود أو فرق أو تكرار',()=>{const m=reconcileProviderStatement('t',[{providerReference:'c',amountMinor:900},{providerReference:'x',amountMinor:100},{providerReference:'x',amountMinor:100}],[tx('c','charge',1000)]);const s=summarizeReconciliation(m);expect(s.canClose).toBe(false);expect(s.exceptionCount).toBe(3);expect(s.matchedCount).toBe(0)})
})
