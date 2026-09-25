/** Download the picture currently shown by a preview video as a PNG. */

function waitForVideoFrame(video: HTMLVideoElement, timeSeconds: number): Promise<void> {
  if (
    video.readyState >= 2 &&
    Math.abs(video.currentTime - timeSeconds) < 0.02
  ) {
    return Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    const finish = () => {
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('error', onError)
      resolve()
    }
    const onSeeked = () => finish()
    const onError = () => {
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('error', onError)
      reject(new Error('Could not read the current frame.'))
    }
    video.addEventListener('seeked', onSeeked)
    video.addEventListener('error', onError)
    try {
      video.currentTime = timeSeconds
    } catch (error) {
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('error', onError)
      reject(error)
    }
  })
}

export async function downloadVideoFrame(
  video: HTMLVideoElement,
  timeSeconds: number,
  filename: string,
): Promise<boolean> {
  if (video.readyState < 1) {
    await new Promise<void>((resolve, reject) => {
      const onReady = () => {
        video.removeEventListener('loadedmetadata', onReady)
        video.removeEventListener('error', onError)
        resolve()
      }
      const onError = () => {
        video.removeEventListener('loadedmetadata', onReady)
        video.removeEventListener('error', onError)
        reject(new Error('Could not read the current frame.'))
      }
      video.addEventListener('loadedmetadata', onReady)
      video.addEventListener('error', onError)
    })
  }

  await waitForVideoFrame(video, timeSeconds)

  const width = video.videoWidth
  const height = video.videoHeight
  if (!width || !height) return false

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return false
  context.drawImage(video, 0, 0, width, height)

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/png')
  })
  if (!blob) return false

  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
  return true
}
