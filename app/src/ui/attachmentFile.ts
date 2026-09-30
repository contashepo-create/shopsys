/** مرفق لم يُرحَّل بعد — يعيش مع المسودة حتى تصير الفاتورة مستنداً حقيقياً */
export type PendingAttachment = { key: string; name: string; mime: string; dataUrl: string }

/**
 * يحوّل الملف إلى dataUrl: الصور تُضغط (1400px · JPEG 0.82) لأن التخزين المحلي
 * محدود، وملفات PDF تُحفظ كما هي. نفس خط مرفقات ملف المريض بالضبط.
 */
export async function fileToAttachmentDataUrl(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('تعذرت قراءة الملف'))
    reader.readAsDataURL(file)
  })
  if (file.type === 'application/pdf') return dataUrl
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, 1400 / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      const ctx = canvas.getContext('2d')
      if (!ctx) { resolve(dataUrl); return }
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', 0.82))
    }
    img.onerror = () => reject(new Error('الصورة غير مقروءة'))
    img.src = dataUrl
  })
}

/** حجم تقريبي بالكيلوبايت من طول base64 */
export function attachmentSizeKb(dataUrl: string): number {
  return Math.max(1, Math.round((dataUrl.length * 3) / 4 / 1024))
}

