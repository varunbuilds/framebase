import { describe, expect, it } from 'vitest'
import { createEmptyProject } from '@/features/editor/project'
import {
  QUALITY_PRESETS,
  defaultExportSettings,
  estimateOutputBytes,
  inspectExportReadiness,
  preflightExport,
  resolutionChoices,
} from './export-settings'
import type { Mp4EncodeProbe } from './export-capabilities'

const probe = (video: boolean, audio: boolean, webCodecs = true): Mp4EncodeProbe => ({
  webCodecs,
  canEncodeAvc: async () => video,
  canEncodeAac: async () => audio,
})

describe('export settings', () => {
  it('maps quality presets to encoder bitrates', () => {
    expect(QUALITY_PRESETS.recommended.videoBitrate).toBe(8_000_000)
    expect(QUALITY_PRESETS.small.videoBitrate).toBeLessThan(QUALITY_PRESETS.maximum.videoBitrate)
    expect(QUALITY_PRESETS.recommended.audioBitrate).toBe(192_000)
  })

  it('offers the project size and lower even sizes only', () => {
    const choices = resolutionChoices('16:9')
    expect(choices[0]).toEqual({ width: 1920, height: 1080, label: '1920 × 1080' })
    expect(choices.some((choice) => choice.width > 1920)).toBe(false)
    expect(choices.every((choice) => choice.width % 2 === 0 && choice.height % 2 === 0)).toBe(true)
  })

  it('blocks export until encoders and media are verified', async () => {
    const document = createEmptyProject('Cut')
    const settings = defaultExportSettings('16:9', 1_000)
    expect(
      preflightExport({
        settings,
        videoEncoderReady: null,
        audioEncoderReady: null,
        missingMedia: [],
        mediaChecked: false,
      }).ready,
    ).toBe(false)

    expect(
      preflightExport({
        settings,
        videoEncoderReady: true,
        audioEncoderReady: true,
        missingMedia: ['interview.mp4'],
        mediaChecked: true,
      }).issues.some((issue) => issue.message.includes('Missing media')),
    ).toBe(true)

    const unsupported = await inspectExportReadiness({
      document,
      settings: { ...settings, rangeEndMs: 1_000 },
      probe: probe(false, true),
      mediaAvailable: async () => true,
    })
    expect(unsupported.ready).toBe(false)
    expect(unsupported.issues.some((issue) => /H\.264/.test(issue.message))).toBe(true)
  })

  it('estimates video from bitrate and wav from pcm size', () => {
    const video = defaultExportSettings('16:9', 8_000)
    expect(estimateOutputBytes({ ...video, rangeEndMs: 8_000 })).toBe(
      ((8_000_000 + 192_000) * 8) / 8,
    )
    const audio = { ...video, mode: 'audio' as const, rangeEndMs: 1_000 }
    expect(estimateOutputBytes(audio)).toBe(Math.round(48_000) * 4 + 44)
  })
})
