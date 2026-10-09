import { assertMediaSourceId } from '@/lib/media/media-byte-store'
import {
  FILMSTRIP_FRAME_HEIGHT,
  FILMSTRIP_JPEG_QUALITY,
  FILMSTRIP_VERSION,
  WAVEFORM_VERSION,
} from '@/lib/media/derived-cache'
import { isProjectId } from '@/features/projects/document'

/** Framebase-owned marker. Replaces the generic workspace.json identity file. */
export const WORKSPACE_MARKER_FILE = '.framebase-workspace.json'
/** Previous marker. Read only to migrate an existing folder. */
export const LEGACY_WORKSPACE_MARKER_FILE = 'workspace.json'
export const WORKSPACE_README_FILE = 'README.md'
export const WORKSPACE_INDEX_FILE = 'index.json'
export const PROJECTS_DIRECTORY = 'projects'
export const MEDIA_DIRECTORY = 'media'
export const LEGACY_CACHE_DIRECTORY = 'cache'

export const PROJECT_FILE = 'project.json'
export const MEDIA_LINKS_FILE = 'media-links.json'
export const PROJECT_THUMBNAIL_FILE = 'thumbnail.jpg'
export const RENDER_QUEUE_FILE = 'render-queue.json'
export const MEDIA_METADATA_FILE = 'metadata.json'
export const MEDIA_THUMBNAIL_FILE = 'thumbnail.jpg'
export const MEDIA_CACHE_DIRECTORY = 'cache'

const FILMSTRIP_QUALITY_PERCENT = Math.round(FILMSTRIP_JPEG_QUALITY * 100)

export type FilmstripCacheConfig = {
  version?: number
  height?: number
  qualityPercent?: number
}

export type WaveformCacheConfig = {
  version?: number
  peakCount: number
}

export function getProjectDir(projectId: string): string {
  assertProjectId(projectId)
  return `${PROJECTS_DIRECTORY}/${projectId}`
}

export function getProjectFile(projectId: string): string {
  return `${getProjectDir(projectId)}/${PROJECT_FILE}`
}

export function getProjectThumbnail(projectId: string): string {
  return `${getProjectDir(projectId)}/${PROJECT_THUMBNAIL_FILE}`
}

export function getMediaLinksFile(projectId: string): string {
  return `${getProjectDir(projectId)}/${MEDIA_LINKS_FILE}`
}

export function getRenderQueueFile(projectId: string): string {
  return `${getProjectDir(projectId)}/${RENDER_QUEUE_FILE}`
}

export function getMediaDir(mediaId: string): string {
  assertMediaSourceId(mediaId)
  return `${MEDIA_DIRECTORY}/${mediaId}`
}

export function getMediaMetadataFile(mediaId: string): string {
  return `${getMediaDir(mediaId)}/${MEDIA_METADATA_FILE}`
}

export function getMediaThumbnailFile(mediaId: string): string {
  return `${getMediaDir(mediaId)}/${MEDIA_THUMBNAIL_FILE}`
}

export function getMediaCacheDir(mediaId: string): string {
  return `${getMediaDir(mediaId)}/${MEDIA_CACHE_DIRECTORY}`
}

/** `source.mov` — extension comes from the original file, never invented as a codec. */
export function getMediaSourceFile(fileName: string, mimeType: string): string {
  return `source${extensionForMedia(fileName, mimeType)}`
}

export function getFilmstripCacheDir(
  mediaId: string,
  config: FilmstripCacheConfig = {},
): string {
  const version = config.version ?? FILMSTRIP_VERSION
  const height = config.height ?? FILMSTRIP_FRAME_HEIGHT
  const quality = config.qualityPercent ?? FILMSTRIP_QUALITY_PERCENT
  return `${getMediaCacheDir(mediaId)}/filmstrip/v${version}/h${height}-q${quality}`
}

export function getWaveformCacheDir(mediaId: string, config: WaveformCacheConfig): string {
  const version = config.version ?? WAVEFORM_VERSION
  return `${getMediaCacheDir(mediaId)}/waveform/v${version}/peaks-${config.peakCount}.bin`
}

export function splitWorkspacePath(path: string): string[] {
  const segments = path.split('/').filter(Boolean)
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error('Invalid workspace path')
  }
  return segments
}

export function extensionForMedia(fileName: string, mimeType: string): string {
  const fromName = extensionFromFileName(fileName)
  if (fromName) return fromName
  return extensionFromMime(mimeType) ?? '.bin'
}

function extensionFromFileName(fileName: string): string | null {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(fileName.trim())
  if (!match?.[1]) return null
  return `.${match[1].toLowerCase()}`
}

function extensionFromMime(mimeType: string): string | null {
  switch (mimeType.toLowerCase().split(';')[0]?.trim()) {
    case 'video/mp4':
      return '.mp4'
    case 'video/quicktime':
      return '.mov'
    case 'video/webm':
      return '.webm'
    case 'video/x-matroska':
      return '.mkv'
    case 'audio/mpeg':
      return '.mp3'
    case 'audio/wav':
    case 'audio/wave':
    case 'audio/x-wav':
      return '.wav'
    case 'audio/aac':
      return '.aac'
    case 'audio/mp4':
      return '.m4a'
    case 'audio/ogg':
      return '.ogg'
    case 'audio/flac':
      return '.flac'
    default:
      return null
  }
}

function assertProjectId(projectId: string): void {
  if (!isProjectId(projectId)) throw new Error('Invalid project id')
}
