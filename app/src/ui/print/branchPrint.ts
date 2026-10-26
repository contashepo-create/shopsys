/**
 * هوية وإعدادات طباعة المستند بحسب فرعه المالك — لا بحسب الفرع المعروض.
 *
 * هذا هو المسار الموحد لطباعة مستندات القوائم في «العرض الشامل» ولأي
 * معاينة تُفتح بينما الفرع النشط مختلف عن فرع المستند. نقرأ الفروع
 * والمخازن والخزائن من المخزن الخام لأن المخزن المصفّى قد يحجب مخازن
 * الفروع الأخرى التي يحتاجها حسم ملكية المستند القديم.
 */
import { getCountry } from '../../core/countries.ts'
import { evaluateLicense, hasFeature } from '../../core/license.ts'
import type { ReceiptModel } from '../../core/receipt.ts'
import { useRawDataStore } from '../../data/repo.ts'
import {
  branchIdentityMissingFields,
  resolveBranchAppSettings,
  resolveDocumentBranchAppSettings,
  useAppStore,
  type BranchEffectiveAppSettings,
} from '../../stores/app.store.ts'
import { taxBarcodePayload, withTaxBarcodeSync, type TaxBarcodeArgs } from './taxBarcode.ts'

export interface DocumentTaxBarcodeDoc {
  dateIso: string
  invoiceNumber?: string
  totalMinor?: number
  taxMinor?: number
}

/** كل إعدادات المنشأة/الفرع المالك لمستند بعينه. */
export function resolveDocumentPrintSettings(
  record: object | null | undefined,
): BranchEffectiveAppSettings & { branchId: number | null; branchName: string; identityComplete: boolean } {
  const raw = useRawDataStore.getState()
  const resolved = resolveDocumentBranchAppSettings(
    useAppStore.getState(),
    record,
    raw.branches,
    raw.warehouses,
    raw.treasuries,
  )
  const identityComplete = !resolved.branch || resolved.branch.isMain
    || branchIdentityMissingFields(resolved.setup, resolved.einvoice).length === 0
  return {
    ...resolved,
    branchId: resolved.branch?.id ?? null,
    branchName: resolved.branch?.nameAr ?? resolved.setup.shopName,
    identityComplete,
  }
}

/** إعدادات فرع محدد بالمعرف؛ غياب المعرف أو عدم وجوده يعني المنشأة الرئيسية. */
export function resolveBranchPrintSettings(branchId: number | null | undefined): BranchEffectiveAppSettings {
  const raw = useRawDataStore.getState()
  const branch = branchId == null
    ? raw.branches.find((candidate) => candidate.isMain) ?? null
    : raw.branches.find((candidate) => candidate.id === branchId) ?? null
  return resolveBranchAppSettings(useAppStore.getState(), branch)
}

/** وسائط الرمز الضريبي بهوية فرع المستند — للمسارات غير المتزامنة (PNG). */
export function documentTaxBarcodeArgs(
  model: Pick<ReceiptModel, 'invoiceNumber' | 'totalMinor' | 'taxMinor'> | null,
  record: object | null | undefined,
  doc: DocumentTaxBarcodeDoc,
): TaxBarcodeArgs {
  const app = useAppStore.getState()
  const resolved = resolveDocumentPrintSettings(record)
  const license = evaluateLicense({
    activatedPayload: app.activatedPayload,
    trialStartedAt: app.trialStartedAt,
    lastSeenAt: app.lastSeenAt,
    today: new Date().toISOString(),
    deviceFlags: app.deviceFlags,
  })
  const decimals = (resolved.setup.countryCode
    ? getCountry(resolved.setup.countryCode)?.currency.decimals
    : undefined) ?? 2
  return {
    saFeatureActive: resolved.identityComplete && resolved.einvoice.enabled === true && hasFeature(license, 'einvoice_sa'),
    egFeatureActive: resolved.identityComplete && resolved.einvoice.enabled === true && hasFeature(license, 'einvoice_eg'),
    printEnabled: resolved.einvoice.printZatcaQr,
    sellerName: resolved.setup.shopName,
    taxNumber: resolved.einvoice.taxNumber,
    invoiceNumber: doc.invoiceNumber ?? model?.invoiceNumber ?? '',
    dateIso: doc.dateIso,
    totalMinor: doc.totalMinor ?? model?.totalMinor ?? 0,
    taxMinor: doc.taxMinor ?? model?.taxMinor ?? 0,
    decimals,
  }
}

/**
 * يختم الرمز الضريبي باسم ورقم فرع المستند نفسه. لا يجوز استخدام
 * useTaxBarcodeStamp لمستند من قائمة شاملة لأنه يقرأ الفرع النشط.
 */
export function stampDocumentTaxBarcode(
  model: Pick<ReceiptModel, 'invoiceNumber' | 'totalMinor' | 'taxMinor' | 'qrDataUrl'>,
  record: object | null | undefined,
  doc: DocumentTaxBarcodeDoc,
): boolean {
  return withTaxBarcodeSync(model, documentTaxBarcodeArgs(model, record, doc))
}

/** حمولة الرمز التي تُجمَّد على فاتورة عند أول طباعة — بهوية فرع الفاتورة. */
export function documentTaxBarcodePayload(
  model: Pick<ReceiptModel, 'invoiceNumber' | 'totalMinor' | 'taxMinor'> | null,
  record: object | null | undefined,
  doc: DocumentTaxBarcodeDoc,
): string | undefined {
  return taxBarcodePayload(documentTaxBarcodeArgs(model, record, doc))
}
