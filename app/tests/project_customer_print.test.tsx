import { afterEach, beforeEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { renderProjectHtml } from '../src/ui/print/printProject.ts'
import { ProjectsPage } from '../src/ui/pages/ContractingPages.tsx'
import { usePrintPreview } from '../src/ui/components/printPreviewStore.ts'
import { EMPTY_EXTENDED, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'

const initial = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
 const setup = { ...app.setup, completed: true, countryCode: 'EG', activityId: 'contracting' as const, modules: ['contracting'] as never[] }
 useAppStore.setState({ setup, companySetup: setup })
 useRawDataStore.setState({ ...initial, currentUserId: null, activeBranchId: null, branches: [], customers: [], projects: [], boqItems: [], projectExtracts: [], projectSurveys: [], projectExtractDrafts: [], projectCloseouts: [], projectCosts: [], clientAdvances: [], changeOrders: [], journal: [], vouchers: [], clientSettlements: [], approvalRequests: [] } as never)
 S().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'العميل', phone: '', creditLimitMinor: 0, notes: '' })
 const customer = S().customers.at(-1)!
 const project = S().addProject({ nameAr: 'فيلا <عميل>', clientName: customer.nameAr, clientId: customer.id, contractValueMinor: 10000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
 S().addBoqItem({ projectId: project.id, code: '1', descriptionAr: 'دهانات', unit: 'م2', qty: 100, unitPriceMinor: 100 })
})
afterEach(() => { cleanup(); usePrintPreview.getState().closePreview(); useRawDataStore.setState(initial); useAppStore.setState(app) })

it('يعرض العقد والحصر وأوامر التغيير دون اختلاق كمياتها أو إدخال المسودة في قيمة العقد', () => {
 const project = S().projects[0], item = S().boqItems[0]
 S().saveProjectSurvey({ projectId: project.id, lines: [{ boqItemId: item.id, cumulativeQty: 25 }], expectedRevision: 0, reason: '', isFinal: false })
 const order = S().addChangeOrder({ projectId: project.id, titleAr: 'أعمال <إضافية>', amountMinor: 2000 })
 S().setChangeOrderStatus(order.id, 'approved')
 S().addChangeOrder({ projectId: project.id, titleAr: 'مسودة', amountMinor: 3000 })
 const html = renderProjectHtml({ shopName: 'الشركة', project, items: S().boqItems, orders: S().changeOrders, survey: S().projectSurveys[0], history: [], fmt: n => String(n), currency: 'ج' })
 expect(html).toContain('فيلا &lt;عميل&gt;')
 expect(html).toContain('أعمال &lt;إضافية&gt;')
 expect(html).toContain('كمية العقد')
 expect(html).toContain('كمية أوامر التغيير')
 expect(html).toContain('غير مفصلة')
 expect(html).toMatch(/المنفذ المحصور[\s\S]*?<td>100<\/td><td>غير مفصلة<\/td><td>25<\/td>/)
 expect(html).toContain('قيمة العقد بعد التغيير: <b>12000 ج</b>')
 expect(html).toContain('قيمة الكميات المحصورة بسعر بنود المشروع قبل الضريبة:</b> 2500 ج')
 expect(html).toContain('مسودة')
 expect(html).toContain('قياس يدوي')
})

it('المعاينة من المشروع تقرأ أحدث البيانات وتمنع الطباعة عند اختفاء المشروع', () => {
 render(<MemoryRouter><ProjectsPage /></MemoryRouter>)
 fireEvent.click(screen.getByTitle('التفاصيل والقيود'))
 fireEvent.click(screen.getByText('معاينة وطباعة بيان المشروع'))
 let preview = usePrintPreview.getState()
 expect(preview.open).toBe(true)
 expect(preview.handle?.html).toContain('لا يوجد حصر محفوظ')
 const order = S().addChangeOrder({ projectId: S().projects[0].id, titleAr: 'زيادة العقد', amountMinor: 2000 })
 S().setChangeOrderStatus(order.id, 'approved')
 preview.refresh()
 preview = usePrintPreview.getState()
 expect(preview.handle?.html).toContain('زيادة العقد')
 expect(preview.handle?.html).toContain('120.00')
 useRawDataStore.setState({ projects: [] })
 usePrintPreview.getState().refresh()
 expect(usePrintPreview.getState().rebuildError).toBe(true)
})
it('يعرض زيادة الكمية المعتمدة والقياس الإجمالي دون جمع مشكوك فيه', () => {
 const p = S().projects[0], b = S().boqItems[0]
 const order = S().addChangeOrder({ projectId: p.id, titleAr: 'زيادة', amountMinor: 2000, quantityChange: { originalBoqItemId: b.id, qty: 20 } })
 S().setChangeOrderStatus(order.id, 'approved')
 const child = S().boqItems.find(row => row.quantityChange)!
 S().saveProjectSurvey({ projectId: p.id, lines: [{ boqItemId: b.id, cumulativeQty: 100 }, { boqItemId: child.id, cumulativeQty: 15 }], expectedRevision: 0, reason: '', isFinal: false })
 const make = () => renderProjectHtml({ shopName: 'الشركة', project: p, items: S().boqItems, orders: S().changeOrders, survey: S().projectSurveys[0], history: [], fmt: String, currency: 'ج' })
 expect(make()).toContain('<td>100</td><td>20</td><td>115</td>')
 expect(make()).toContain('زيادة 20 م2')
 S().saveProjectSurvey({ projectId: p.id, lines: [{ boqItemId: b.id, cumulativeQty: 110 }], expectedRevision: 1, reason: '', isFinal: false })
 expect(make()).toContain('راجع توزيع الحصر بين العقد والتغيير')
 expect(make()).toContain('غير متاحة لعدم اكتمال الحصر')
})
