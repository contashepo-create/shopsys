/**
 * ختم الرمز الضريبي على نموذج مستند الطباعة — خطاف واحد لكل شاشات المبيعات.
 *
 * لماذا خطاف وليس دالة عادية؟ لأن شرط الطباعة يعتمد على أربعة مصادر حالة:
 * الترخيص (einvoice_sa/eg) + تشغيل الإصدار الإلكتروني + الرقم الضريبي واسم
 * المنشأة + مفتاح الطباعة. جمعها هنا يضمن ألا تختلف شروط شاشة عن أخرى —
 * وهو بالضبط ما وقع: محرر فاتورة المبيعات والمرتجع ومراكز فواتير الأنشطة
 * كانت تطبع بلا رمز رغم تفعيل زاتكا.
 *
 * الاستخدام (سطر واحد قبل الطباعة، بلا async لأن التوليد متزامن SVG):
 *   const stampTax = useTaxBarcodeStamp()
 *   stampTax(model, { dateIso: sale.date })
 */
import { useCallback, useMemo } from 'react'
import { useAppStore } from '../../stores/app.store.ts'
import { evaluateLicense, hasFeature } from '../../core/license.ts'
import { getCountry } from '../../core/countries.ts'
import type { ReceiptModel } from '../../core/receipt.ts'
import { taxBarcodePayload, withTaxBarcodeSync, type TaxBarcodeArgs } from '../print/taxBarcode.ts'

/** بيانات المستند التي لا يحملها نموذج الطباعة بالضرورة */
export interface TaxBarcodeDoc {
  /** تاريخ الفاتورة ISO — لا نستخدم تاريخ لحظة الطباعة (مهم لإعادة طباعة فاتورة قديمة) */
  dateIso: string
  invoiceNumber?: string
  totalMinor?: number
  taxMinor?: number
}

export type TaxBarcodeStamp = (
  model: Pick<ReceiptModel, 'invoiceNumber' | 'totalMinor' | 'taxMinor' | 'qrDataUrl'>,
  doc: TaxBarcodeDoc,
) => boolean

/**
 * بناء وسائط الرمز من حالة التطبيق — مصدر واحد تستخدمه نسخة الختم ونسخة
 * الحمولة (التجميد) فتستحيل مفارقة شروطهما.
 */
function useTaxBarcodeArgs(): (model: Pick<ReceiptModel, 'invoiceNumber' | 'totalMinor' | 'taxMinor'> | null, doc: TaxBarcodeDoc) => TaxBarcodeArgs {
  const { setup, einvoice, activatedPayload, trialStartedAt, lastSeenAt, deviceFlags } = useAppStore()
  const lic = useMemo(
    () => evaluateLicense({ activatedPayload, trialStartedAt, lastSeenAt, today: new Date().toISOString(), deviceFlags }),
    [activatedPayload, trialStartedAt, lastSeenAt, deviceFlags],
  )
  const decimals = (setup.countryCode ? getCountry(setup.countryCode)?.currency.decimals : undefined) ?? 2

  return useCallback((model, doc) => ({
    saFeatureActive: einvoice.enabled === true && hasFeature(lic, 'einvoice_sa'),
    egFeatureActive: einvoice.enabled === true && hasFeature(lic, 'einvoice_eg'),
    printEnabled: einvoice.printZatcaQr,
    sellerName: setup.shopName,
    taxNumber: einvoice.taxNumber,
    invoiceNumber: doc.invoiceNumber ?? model?.invoiceNumber ?? '',
    dateIso: doc.dateIso,
    totalMinor: doc.totalMinor ?? model?.totalMinor ?? 0,
    taxMinor: doc.taxMinor ?? model?.taxMinor ?? 0,
    decimals,
  }), [setup.shopName, einvoice, lic, decimals])
}

export function useTaxBarcodeStamp(): TaxBarcodeStamp {
  const argsFor = useTaxBarcodeArgs()
  return useCallback<TaxBarcodeStamp>(
    (model, doc) => withTaxBarcodeSync(model, argsFor(model, doc)),
    [argsFor],
  )
}

/**
 * حمولة الرمز النصية (للتجميد على المستند عند أول طباعة). `undefined` تعني
 * «لا رمز الآن» — لا يُحفظ شيء ولا يُطبع رمز.
 */
export function useTaxBarcodePayload(): (
  model: Pick<ReceiptModel, 'invoiceNumber' | 'totalMinor' | 'taxMinor'> | null,
  doc: TaxBarcodeDoc,
) => string | undefined {
  const argsFor = useTaxBarcodeArgs()
  return useCallback((model, doc) => taxBarcodePayload(argsFor(model, doc)), [argsFor])
}
