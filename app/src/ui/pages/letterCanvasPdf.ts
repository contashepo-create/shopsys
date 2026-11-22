import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'

/** كل ورقة تُلتقط مستقلة فلا يُجزأ سطر بسبب تقطيع صورة طويلة. */
export async function exportLetterCanvasPdf(pages: HTMLElement[], filename: string): Promise<void> {
  if (!pages.length) throw new Error('لا توجد صفحات للتصدير')
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  for (const [index, page] of pages.entries()) {
    const canvas = await html2canvas(page, {
      scale: 2, useCORS: false, backgroundColor: '#ffffff',
      onclone: document => { document.querySelectorAll('.letters-canvas-item').forEach(node => { node.classList.remove('is-selected'); (node as HTMLElement).style.outline = 'none' }) },
    })
    if (index) pdf.addPage('a4', 'portrait')
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.98), 'JPEG', 0, 0, 210, 297)
  }
  pdf.save(filename)
}
