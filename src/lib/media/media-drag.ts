/** In-page drag of library items onto the timeline, in selection order. */

const MEDIA_DRAG_TYPE = 'application/x-framebase-media'

let draggingIds: string[] = []
let dragPreview: HTMLElement | null = null

function clearDragPreview() {
  dragPreview?.remove()
  dragPreview = null
}

/** Stacked ghost with a count, so a multi-item grab is obvious under the cursor. */
function mountCountDragImage(dataTransfer: DataTransfer, count: number) {
  clearDragPreview()
  const root = document.createElement('div')
  root.setAttribute('aria-hidden', 'true')
  root.style.cssText = [
    'position:fixed',
    'left:-1000px',
    'top:0',
    'width:132px',
    'height:92px',
    'pointer-events:none',
  ].join(';')

  const layers = [
    'inset:16px 22px 0 8px;background:#273239',
    'inset:10px 14px 8px 2px;background:#1c3852',
    'inset:4px 8px 14px 0;background:#1c4b78;border:1px solid #2d74b9',
  ]
  for (const layer of layers) {
    const card = document.createElement('div')
    card.style.cssText = `position:absolute;border-radius:8px;${layer}`
    root.appendChild(card)
  }

  const badge = document.createElement('div')
  badge.textContent = String(count)
  badge.style.cssText = [
    'position:absolute',
    'top:0',
    'right:0',
    'min-width:28px',
    'height:28px',
    'padding:0 7px',
    'box-sizing:border-box',
    'border-radius:999px',
    'background:#3f82c7',
    'color:#fff',
    'font:700 13px Onest,sans-serif',
    'letter-spacing:0',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'box-shadow:0 0 0 2px #11181d',
  ].join(';')
  root.appendChild(badge)

  document.body.appendChild(root)
  dataTransfer.setDragImage(root, 16, 22)
  dragPreview = root
}

function parseIds(value: string): string[] {
  return value
    .split('\n')
    .map((id) => id.trim())
    .filter(Boolean)
}

export function beginMediaDrag(mediaSourceIds: string[], dataTransfer: DataTransfer) {
  draggingIds = mediaSourceIds.filter(Boolean)
  const payload = draggingIds.join('\n')
  dataTransfer.effectAllowed = 'copy'
  dataTransfer.setData(MEDIA_DRAG_TYPE, payload)
  dataTransfer.setData('text/plain', payload)
  document.documentElement.classList.add('media-dragging')
  if (draggingIds.length > 1) {
    mountCountDragImage(dataTransfer, draggingIds.length)
  }
}

export function endMediaDrag() {
  draggingIds = []
  clearDragPreview()
  document.documentElement.classList.remove('media-dragging')
}

export function draggingMediaSourceIds(): string[] {
  return draggingIds
}

export function draggingMediaSourceId(): string | null {
  return draggingIds[0] ?? null
}

export function isLibraryMediaDrag(dataTransfer: DataTransfer): boolean {
  return (
    draggingIds.length > 0 ||
    Array.from(dataTransfer.types).includes(MEDIA_DRAG_TYPE)
  )
}

export function libraryMediaIdsFromDrop(dataTransfer: DataTransfer): string[] {
  const parsed = parseIds(
    dataTransfer.getData(MEDIA_DRAG_TYPE) || dataTransfer.getData('text/plain'),
  )
  return parsed.length > 0 ? parsed : draggingIds
}
