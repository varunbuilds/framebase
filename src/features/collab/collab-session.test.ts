import { describe, expect, it } from 'vitest'
import {
  collabConnection,
  collabDocumentReady,
  collabFailureForCode,
  collabIndicator,
  collabPendingChanges,
  collabPhase,
  type CollabSessionView,
} from './collab-session'

function view(overrides: Partial<CollabSessionView> = {}): CollabSessionView {
  return {
    phase: 'ready',
    connection: 'connected',
    pendingChanges: false,
    errorMessage: null,
    ...overrides,
  }
}

describe('collaborative connection state', () => {
  it('maps Liveblocks status onto the editor connection states', () => {
    expect(collabConnection('initial')).toBe('connecting')
    expect(collabConnection('connecting')).toBe('connecting')
    expect(collabConnection('connected')).toBe('connected')
    expect(collabConnection('reconnecting')).toBe('reconnecting')
    expect(collabConnection('disconnected')).toBe('disconnected')
  })

  it('treats unauthorized close codes as access failures', () => {
    expect(collabFailureForCode(4001)).toBe('unauthorized')
    expect(collabFailureForCode(-1)).toBe('unauthorized')
    expect(collabFailureForCode(1006)).toBe('room-load')
    expect(collabFailureForCode(4000)).toBe('room-load')
  })

  it('does not mark the document ready until storage has loaded', () => {
    expect(
      collabPhase({
        connection: 'connecting',
        documentReady: false,
        failure: null,
      }),
    ).toBe('connecting')
    expect(
      collabPhase({
        connection: 'connected',
        documentReady: false,
        failure: null,
      }),
    ).toBe('loading')
    expect(
      collabPhase({
        connection: 'connected',
        documentReady: true,
        failure: null,
      }),
    ).toBe('ready')
    expect(
      collabDocumentReady(
        view({
          phase: collabPhase({
            connection: 'connected',
            documentReady: true,
            failure: null,
          }),
        }),
      ),
    ).toBe(true)
  })

  it('keeps pending local edits visible while synchronizing', () => {
    expect(collabPendingChanges('synchronizing')).toBe(true)
    expect(collabPendingChanges('synchronized')).toBe(false)
  })

  it('surfaces reconnect and offline as blocking, live as a toolbar status', () => {
    expect(collabIndicator(view()).blocking).toBe(false)
    expect(collabIndicator(view()).short).toBe('Live')
    expect(collabIndicator(view({ pendingChanges: true })).short).toBe('Syncing…')
    expect(
      collabIndicator(view({ connection: 'reconnecting' })).blocking,
    ).toBe(true)
    expect(collabIndicator(view({ connection: 'disconnected' })).tone).toBe('warn')
    expect(collabIndicator(view({ phase: 'unauthorized' })).tone).toBe('error')
    expect(collabIndicator(view({ phase: 'failed' })).tone).toBe('error')
    expect(collabIndicator(view({ phase: 'connecting' })).blocking).toBe(false)
  })
})
