import type { DerivedCacheStore } from '@/lib/media/derived-cache'
import type { MediaByteStore } from '@/lib/media/media-byte-store'

/**
 * The active workspace stores. Null until the user has a connected folder.
 * The media and cache singletons read this on every call, so connecting a
 * workspace does not require replacing those singletons.
 */
let media: MediaByteStore | null = null
let cache: DerivedCacheStore | null = null

export function bindWorkspaceStores(
  nextMedia: MediaByteStore | null,
  nextCache: DerivedCacheStore | null,
): void {
  media = nextMedia
  cache = nextCache
}

export function boundWorkspaceMedia(): MediaByteStore | null {
  return media
}

export function boundWorkspaceCache(): DerivedCacheStore | null {
  return cache
}
