/** نفس النسبة تطبق على HTML المعاينة والطباعة، بلا قص أو إخفاء المحتوى. */
export function applyPreviewScale(html: string, percent: number): string {
  const safe = Math.min(120, Math.max(40, Number.isFinite(percent) ? Math.round(percent) : 100))
  if (safe === 100) return html
  const style = `<style data-preview-print-scale>html { zoom: ${safe}% !important; }</style>`
  return /<\/head\s*>/i.test(html) ? html.replace(/<\/head\s*>/i, `${style}</head>`) : `${style}${html}`
}
