import { describe, expect, it } from 'vitest'
import { isProjectSaveShortcut, type ShortcutEvent } from '@/features/editor/shortcuts'

function key(overrides: Partial<ShortcutEvent> = {}): ShortcutEvent {
  return {
    key: 's',
    code: 'KeyS',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    ...overrides,
  }
}

describe('isProjectSaveShortcut', () => {
  it('matches command and control on the S key', () => {
    expect(isProjectSaveShortcut(key({ metaKey: true }))).toBe(true)
    expect(isProjectSaveShortcut(key({ ctrlKey: true }))).toBe(true)
  })

  it('matches the physical key when the character is not s', () => {
    expect(
      isProjectSaveShortcut(key({ metaKey: true, key: 'ы', code: 'KeyS' })),
    ).toBe(true)
  })

  it('ignores the letter without a modifier and modified shortcuts', () => {
    expect(isProjectSaveShortcut(key())).toBe(false)
    expect(isProjectSaveShortcut(key({ metaKey: true, altKey: true }))).toBe(false)
    expect(
      isProjectSaveShortcut(key({ metaKey: true, key: 'z', code: 'KeyZ' })),
    ).toBe(false)
  })
})
