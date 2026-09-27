export function triggerDownload(url: string, filename: string): void {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
}

export function downloadBlob(blob: Blob, filename: string): string {
  const url = URL.createObjectURL(blob)
  triggerDownload(url, filename)
  return url
}

export function revokeDownloadUrl(url: string): void {
  URL.revokeObjectURL(url)
}
