export interface BrowserCapabilities {
  webCodecs: boolean
  webGpu: boolean
  fileSystemAccess: boolean
}

export function detectBrowserCapabilities(): BrowserCapabilities {
  return {
    webCodecs: typeof window !== 'undefined' && 'VideoDecoder' in window,
    webGpu: typeof navigator !== 'undefined' && 'gpu' in navigator,
    fileSystemAccess:
      typeof window !== 'undefined' && 'showOpenFilePicker' in window,
  }
}
