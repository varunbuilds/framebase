/** Runtime-only object URL registry. Not part of the serializable document. */

const objectUrls = new Map<string, string>()

export function setObjectUrl(mediaSourceId: string, url: string): void {
  const existing = objectUrls.get(mediaSourceId)
  if (existing && existing !== url) {
    URL.revokeObjectURL(existing)
  }
  objectUrls.set(mediaSourceId, url)
}

export function getObjectUrl(mediaSourceId: string): string | undefined {
  return objectUrls.get(mediaSourceId)
}

export function revokeObjectUrl(mediaSourceId: string): void {
  const existing = objectUrls.get(mediaSourceId)
  if (existing) {
    URL.revokeObjectURL(existing)
    objectUrls.delete(mediaSourceId)
  }
}

export function revokeAllObjectUrls(): void {
  for (const url of objectUrls.values()) {
    URL.revokeObjectURL(url)
  }
  objectUrls.clear()
}
