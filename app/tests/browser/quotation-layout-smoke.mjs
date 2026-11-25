/** CHROMIUM_EXECUTABLE_PATH=/path/to/chromium node tests/browser/quotation-layout-smoke.mjs
 * يحتاج خادم Vite محلياً؛ اختبار Chromium لا يغني عن Windows أو متصفحات أخرى. */
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH
if (!executablePath) throw new Error('حدد CHROMIUM_EXECUTABLE_PATH')
const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
try {
  for (const width of [360, 660, 900, 1280, 1920]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('http://127.0.0.1:5173/tests/browser/quotation-layout.html')
    await page.getByRole('button', { name: /عرض \/ مناقصة/ }).click()
    const editor = page.locator('[data-quotation-doc-editor]')
    await editor.waitFor()
    for (const kind of ['quotation', 'tender']) {
      await page.getByLabel('نوع المستند').selectOption(kind)
      const sizes = await editor.locator('.invoice-doc-fields > .form-field').evaluateAll(fields => fields.map(field => {
        const head = field.querySelector(':scope > label, :scope > .field-head')
        const control = [...field.children].find(el => el !== head)
        const f = field.getBoundingClientRect(), h = head?.getBoundingClientRect(), c = control?.getBoundingClientRect()
        return { label: head?.textContent?.trim(), gap: c && h ? c.top - h.bottom : null, top: f.top, bottom: f.bottom, left: f.left, right: f.right, height: f.height, headScroll: head?.scrollHeight, headHeight: head?.clientHeight, controlTop: c?.top, controlLeft: c?.left, controlRight: c?.right, controlBottom: c?.bottom }
      }))
      assert.ok(sizes.some(row => row.label?.includes('العميل المسجَّل')) && sizes.some(row => row.label?.includes('ساري حتى')))
      for (const row of sizes) {
        assert.ok(row.gap >= 3, `${width}/${kind}: لا مسافة كافية بعد ${row.label}: ${row.gap}`)
        assert.ok(row.headScroll <= row.headHeight + 1, `${width}/${kind}: تسمية مقصوصة ${row.label}`)
        assert.ok(row.controlLeft >= row.left - 1 && row.controlRight <= row.right + 1 && row.controlBottom <= row.bottom + 1, `${width}/${kind}: حقل خارج مساحته ${row.label}`)
      }
      for (const first of sizes) for (const other of sizes) {
        if (first !== other && Math.abs(first.top - other.top) < 1) {
          assert.ok(Math.abs(first.controlTop - other.controlTop) < 2, `${width}/${kind}: الحقول غير مصطفة: ${first.label} و${other.label}`)
          assert.ok(first.right <= other.left + 1 || other.right <= first.left + 1, `${width}/${kind}: الحقول متداخلة أفقياً`)
        }
      }
    }
    const customerField = await page.locator('#quotation-client-field').evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth, children: [...el.children].map(child => { const bounds = child.getBoundingClientRect(), parent = el.getBoundingClientRect(); return { width: bounds.width, left: bounds.left - parent.left, right: bounds.right - parent.right } }) }))
    assert.ok(customerField.scroll <= customerField.width + 1 && customerField.children.every(child => child.width > 20 && child.left >= -1 && child.right <= 1), `${width}: حقلا العميل لا يتسعان داخل الحقل`)
    await page.getByLabel('نوع المستند').selectOption('quotation')
    await page.getByLabel('ساري حتى').fill('2099-01-31')
    assert.equal(await page.getByLabel('ساري حتى').inputValue(), '2099-01-31')
    await page.getByPlaceholder('تشطيب فيلا — الدور الأول…').fill('عرض اختبار')
    await page.getByLabel('بحث العميل المسجَّل').press('ArrowDown')
    await page.locator('[role="dialog"] [data-quick-option][data-value="1"]').click()
    assert.equal(await page.getByLabel('اسم العميل').inputValue(), 'عميل تجريبي')
    await page.getByPlaceholder('حفر وأساسات').fill('بند اختبار')
    await page.getByPlaceholder('حفر حتى منسوب التأسيس مع نقل المخلفات…').fill('وصف تجريبي')
    await page.locator('[data-quotation-lines] tbody tr').first().locator('input').nth(3).fill('100')
    assert.ok((await page.locator('[data-quotation-sum-gross]').textContent()).includes('115'))
    await page.getByRole('button', { name: 'إغلاق المستند' }).click()
    await page.getByTitle('فتح العرض وتعديله').click()
    assert.equal(await page.getByLabel('ساري حتى').inputValue(), '2099-01-01')
    assert.equal(await page.getByLabel('اسم العميل').inputValue(), 'عميل تجريبي')
    for (const label of ['العميل المسجَّل', 'ساري حتى']) {
      const field = editor.locator('.invoice-doc-fields > .form-field').filter({ hasText: label })
      const gap = await field.evaluate(el => {
        const title = el.querySelector(':scope > label, :scope > .field-head')
        const input = [...el.children].find(child => child !== title)
        return input && title ? input.getBoundingClientRect().top - title.getBoundingClientRect().bottom : -1
      })
      assert.ok(gap >= 3, `${width}: المسافة في تعديل العرض غير كافية: ${label}`)
    }
    assert.deepEqual(errors, [])
    await page.close()
    const sale = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 })
    const saleErrors = []
    sale.on('pageerror', error => saleErrors.push(error.message))
    await sale.goto('http://127.0.0.1:5173/tests/browser/quotation-layout.html?view=sale')
    const saleField = sale.locator('.invoice-doc-fields > .form-field').first()
    await saleField.waitFor()
    const metrics = await saleField.evaluate(el => ({ gap: parseFloat(getComputedStyle(el).rowGap), font: parseFloat(getComputedStyle(document.documentElement).fontSize), rows: getComputedStyle(el).gridTemplateRows.split(' ').map(parseFloat) }))
    assert.ok(Math.abs(metrics.gap / metrics.font - 0.06) < 0.005, `${width}: تغير تباعد فاتورة البيع`)
    assert.ok(Math.abs(metrics.rows[0] / metrics.font - 1.02) < 0.02 && Math.abs(metrics.rows[1] / metrics.font - 1.9) < 0.02, `${width}: تغيرت شبكة فاتورة البيع`)
    await sale.getByLabel('نوع طرف الفاتورة').selectOption('supplier')
    assert.equal(await sale.getByLabel('نوع طرف الفاتورة').inputValue(), 'supplier')
    await sale.getByLabel('نوع طرف الفاتورة').selectOption('customer')
    await sale.getByLabel('تاريخ الفاتورة — يمكن اختيار تاريخ سابق؛ لا يتغير عند تعديل فاتورة مرحلة').fill('2025-01-01')
    assert.equal(await sale.getByLabel('تاريخ الفاتورة — يمكن اختيار تاريخ سابق؛ لا يتغير عند تعديل فاتورة مرحلة').inputValue(), '2025-01-01')
    await sale.getByLabel('إظهار عمود الملاحظات').check()
    assert.equal(await sale.getByLabel('إظهار عمود الملاحظات').isChecked(), true)
    assert.deepEqual(saleErrors, [])
    await sale.close()
    console.log(`PASS: ${width}px عرض ومناقصة وفاتورة بيع`)
  }
} finally { await browser.close() }
