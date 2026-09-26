import type { MediaByteStore } from '@/lib/media/media-byte-store'
import { createOpfsMediaStore, isPersistentMediaAvailable } from '@/lib/media/opfs-media-store'
import { boundWorkspaceMedia } from './store-binding'

/**
 * Copies legacy OPFS source bytes into the workspace when the workspace does
 * not already have them.
 *
 * TODO: delete the OPFS source only after a workspace copy has been verified
 * and that deletion is an explicit product decision. This copy is conservative
 * and leaves the OPFS file in place.
 */
export async function copyLegacyOpfsMediaIntoWorkspace(
  mediaSourceIds: string[],
  stores?: { legacy: MediaByteStore; workspace: MediaByteStore },
): Promise<string[]> {
  const workspace = stores?.workspace ?? boundWorkspaceMedia()
  if (!workspace) return []
  const legacy =
    stores?.legacy ?? (isPersistentMediaAvailable() ? createOpfsMediaStore() : null)
  if (!legacy) return []

  const copied: string[] = []
  for (const mediaSourceId of mediaSourceIds) {
    try {
      if (await workspace.has(mediaSourceId)) continue
      const stored = await legacy.get(mediaSourceId)
      if (!stored) continue
      await workspace.save(mediaSourceId, stored.blob, {
        name: stored.name,
        mimeType: stored.mimeType,
      })
      const written = await workspace.get(mediaSourceId)
      if (!written || written.blob.size !== stored.blob.size) {
        await workspace.delete(mediaSourceId).catch(() => undefined)
        continue
      }
      copied.push(mediaSourceId)
    } catch {
      // A failed copy leaves the OPFS bytes and the project media record.
    }
  }
  return copied
}
