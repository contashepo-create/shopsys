/* Isolated CI fixture: real invoice renderer and preload; SQLite runs behind fixture IPC handlers. */
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { draftFromCategory } from '../../src/core/items.ts'
import { flushPendingDesktopSnapshots } from '../../src/data/persistentStorage.ts'
import { useRawDataStore } from '../../src/data/repo.ts'
import { useAppStore } from '../../src/stores/app.store.ts'
import { SatelliteViewRoot } from '../../src/ui/windows/satellite.tsx'
import type { SatelliteDescriptor } from '../../src/data/desktopBridge.ts'

type SmokeWindow = Window & { __smokeReady?: boolean; __smokeError?: string; __smokeStage?: string; __orderId?: number }
const smoke = window as SmokeWindow

async function start() {
  console.log('Purchase smoke fixture imports complete')
  smoke.__smokeStage = 'rehydrating stores'
  await Promise.all([useRawDataStore.persist.rehydrate(), useAppStore.persist.rehydrate()])
  smoke.__smokeStage = 'hydrated'
  const token = new URL(location.href).searchParams.get('sat')
  if (token) {
    const descriptor = await window.shopsysDesktop!.windows!.claim(token) as SatelliteDescriptor | null
    if (!descriptor) throw new Error('Satellite descriptor missing')
    createRoot(document.getElementById('root')!).render(<MemoryRouter><SatelliteViewRoot descriptor={descriptor} /></MemoryRouter>)
  } else {
    const app = useAppStore.getState()
    const setup = { ...app.setup, completed: true, countryCode: 'EG', activityId: 'grocery' as const, vatPercent: 0, taxRegistrationStatus: 'exempt' as const }
    useAppStore.setState({ setup, companySetup: setup, fiscalYears: [], receipt: { ...app.receipt, printAfterSave: false, silentPrint: false } })
    useRawDataStore.setState({ currentUserId: null, activeBranchId: null, branches: [], suppliers: [{ id: 7, nameAr: 'مورد اختبار ويندوز', phone: '', active: true }] as never, items: [{ ...draftFromCategory(undefined, 'WIN-SMOKE'), id: 1, nameAr: 'صنف اختبار ويندوز', costMinor: 3000, priceMinor: 5000, stockQty: 0 }], purchases: [], purchaseOrders: [], journal: [], warehouses: [], batches: [], serials: [] })
    const order = useRawDataStore.getState().addPurchaseOrder({ supplierId: 7, supplierName: 'مورد اختبار ويندوز', date: '2026-01-01', expectedDate: '2026-01-02', warehouseId: null, notes: '', lines: [{ itemId: 1, nameAr: 'صنف اختبار ويندوز', qty: 2, receivedQty: 0, unitAr: 'قطعة', unitPriceMinor: 3000, vatPercent: 0, notes: '' }] })
    smoke.__orderId = order.id
    await Promise.all([flushPendingDesktopSnapshots('shopsys-app'), flushPendingDesktopSnapshots('shopsys-data')])
  }
  smoke.__smokeReady = true
}
void start().catch(error => { smoke.__smokeError = error instanceof Error ? error.stack ?? error.message : String(error) })
