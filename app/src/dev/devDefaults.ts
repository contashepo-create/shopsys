/**
 * بيانات اختبار محلية للمطور فقط.
 *
 * لا تُفعّل هذه القيم في build الإنتاج: import.meta.env.DEV يساوي false
 * عند vite build، لذلك لا تُنشأ هوية أو كلمة سر تجريبية للمستخدم النهائي.
 */
import { ACTIVITY_TEMPLATES, type ActivityTemplate } from '../core/activities.ts'
import { getCountry } from '../core/countries.ts'
import { useAppStore } from '../stores/app.store.ts'
import { useDataStore } from '../data/repo.ts'

export const DEV_TEST_CREDENTIALS = {
  shopName: 'تجريبي',
  ownerName: 'محمد عبده',
  email: 'conta.shepo@gmail.com',
  phone: '01000000000',
  city: 'المنصورة',
  street: 'شارع تجريبي',
  pin: '123456',
} as const

// hashPin يستخدم البادئة tahakam: قبل SHA-256. لا توجد قيمة PIN في بيانات الإنتاج.
const DEV_PIN_HASH = 'dd963634ae8f2839313302f03077c41b6de321c73056d69b1f34334c193c425e'

function developerActivity(): ActivityTemplate {
  const grocery = ACTIVITY_TEMPLATES.find((activity) => activity.id === 'grocery') ?? ACTIVITY_TEMPLATES[0]
  const features = [...new Set(ACTIVITY_TEMPLATES.flatMap((activity) => activity.features))]
  const modules = [...new Set(ACTIVITY_TEMPLATES.flatMap((activity) => activity.modules))]
  return { ...grocery, features, modules }
}

/** يملأ حساباً جديداً مرة واحدة في dev فقط، من دون الكتابة فوق بيانات المطور الموجودة. */
export function seedDeveloperDefaults(): void {
  if (!import.meta.env.DEV) return
  const app = useAppStore.getState()
  if (app.setup.completed) return

  const activity = developerActivity()
  const country = getCountry('EG')
  if (!country) return

  app.completeSetup({
    country,
    activity,
    shopName: DEV_TEST_CREDENTIALS.shopName,
    ownerName: DEV_TEST_CREDENTIALS.ownerName,
    fiscalYear: { nameAr: '2026', startDate: '2026-01-01', endDate: '2026-12-31' },
    contact: {
      phone: DEV_TEST_CREDENTIALS.phone,
      email: DEV_TEST_CREDENTIALS.email,
      city: DEV_TEST_CREDENTIALS.city,
      street: DEV_TEST_CREDENTIALS.street,
    },
  })

  const data = useDataStore.getState()
  data.seed(activity.features)
  useDataStore.setState({
    ownerPinHash: DEV_PIN_HASH,
    ownerProfile: {
      ...data.ownerProfile,
      nameAr: DEV_TEST_CREDENTIALS.ownerName,
      phone: DEV_TEST_CREDENTIALS.phone,
      email: DEV_TEST_CREDENTIALS.email,
    },
    currentUserId: null,
    loggedOut: false,
  })
}
