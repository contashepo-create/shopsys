import { describe, expect, it } from 'vitest'
import { customerStatement, employeeStatement, supplierStatement } from '../src/core/statements.ts'

describe('كشوف حساب الأطراف', () => {
  it('يعرض فاتورة العميل حتى عند سدادها بالكامل ويحافظ على الرصيد الصحيح', () => {
    const rows = customerStatement({
      customerId: 7,
      sales: [
        { invoiceNumber: 'S-0001', date: '2026-09-01', customerId: 7, payment: 'cash', paidMinor: 1000, totals: { totalMinor: 1000 } },
        { invoiceNumber: 'S-0002', date: '2026-09-02', customerId: 7, payment: 'credit', paidMinor: 250, totals: { totalMinor: 750 } },
      ],
      saleReturns: [],
      allSales: [],
      vouchers: [],
      cheques: [],
    })

    expect(rows.map((row) => row.docLabel)).toEqual(['فاتورة S-0001 (نقدي/مسدد)', 'فاتورة S-0002 (جزئي)'])
    expect(rows[0].operationMinor).toBe(1000)
    expect(rows.at(-1)?.balanceMinor).toBe(500)
  })

  it('يعرض مرتجع العميل النقدي كعملية دون اختراع رصيد دائن', () => {
    const rows = customerStatement({
      customerId: 7,
      sales: [],
      saleReturns: [{ returnNumber: 'R-0001', date: '2026-09-03', saleId: 10, refund: 'cash', totals: { totalMinor: 300 } }],
      allSales: [{ id: 10, customerId: 7 }],
      vouchers: [],
      cheques: [],
    })

    expect(rows).toHaveLength(1)
    expect(rows[0].operationMinor).toBe(300)
    expect(rows[0].debitMinor).toBe(0)
    expect(rows[0].creditMinor).toBe(0)
  })

  it('يعرض فاتورة المورد المسددة بالكامل', () => {
    const rows = supplierStatement({
      supplierId: 4,
      purchases: [{ invoiceNumber: 'P-0001', date: '2026-09-01', supplierId: 4, grandTotalMinor: 2000, supplierDueMinor: 2000, paidMinor: 2000 }],
      purchaseReturns: [],
      allPurchases: [],
      vouchers: [],
      cheques: [],
    })

    expect(rows).toHaveLength(1)
    expect(rows[0].operationMinor).toBe(2000)
    expect(rows[0].balanceMinor).toBe(0)
  })

  it('يعرض مسير الموظف والعمولة والعهدة إلى جانب السلف', () => {
    const rows = employeeStatement({
      employeeId: 3,
      advances: [],
      payrollRuns: [{ runNumber: 'SAL-0001', date: '2026-09-01', lines: [{ employeeId: 3, baseMinor: 5000, allowancesMinor: 500, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 0, grossMinor: 5500, netMinor: 5500 }] }],
      commissions: [{ code: 'SCM-0001', date: '2026-09-02', employeeId: 3, amountMinor: 400, status: 'accrued', description: 'عمولة بيع' }],
      custodyTransactions: [{ date: '2026-09-03', employeeId: 3, type: 'fund', amountMinor: 1000, description: 'تعزيز عهدة' }],
    })

    expect(rows.map((row) => row.docLabel)).toEqual(['مسير SAL-0001 — إجمالي 5500، صافي 5500', 'عمولة SCM-0001 — عمولة بيع (مستحقة)', 'تعزيز عهدة (fund)'])
    expect(rows[0].operationMinor).toBe(5500)
    expect(rows.at(-1)?.balanceMinor).toBe(600)
  })
})
