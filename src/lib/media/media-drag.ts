/** In-page drag of a library item onto the timeline. */

const MEDIA_DRAG_TYPE = 'application/x-framebase-media'

let draggingId: string | null = null

export function beginMediaDrag(mediaSourceId: string, dataTransfer: DataTransfer) {
  draggingId = mediaSourceId
  dataTransfer.effectAllowed = 'copy'
  dataTransfer.setData(MEDIA_DRAG_TYPE, mediaSourceId)
  dataTransfer.setData('text/plain', mediaSourceId)
}

export function endMediaDrag() {
  draggingId = null
}

export function draggingMediaSourceId(): string | null {
  return draggingId
}

export function isLibraryMediaDrag(dataTransfer: DataTransfer): boolean {
  return (
    draggingId != null ||
    Array.from(dataTransfer.types).includes(MEDIA_DRAG_TYPE)
  )
}

export function libraryMediaIdFromDrop(dataTransfer: DataTransfer): string | null {
  return (
    dataTransfer.getData(MEDIA_DRAG_TYPE) ||
    draggingId ||
    dataTransfer.getData('text/plain') ||
    null
  )
}
