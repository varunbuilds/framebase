/** 16-bit stereo PCM WAV. Sample values outside [-1, 1] are stored at full scale. */
export function encodeWavPcm(args: {
  left: Float32Array
  right: Float32Array
  sampleRate: number
}): Uint8Array {
  const frames = Math.min(args.left.length, args.right.length)
  const dataBytes = frames * 4
  const buffer = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buffer)
  writeText(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeText(view, 8, 'WAVE')
  writeText(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 2, true)
  view.setUint32(24, args.sampleRate, true)
  view.setUint32(28, args.sampleRate * 4, true)
  view.setUint16(32, 4, true)
  view.setUint16(34, 16, true)
  writeText(view, 36, 'data')
  view.setUint32(40, dataBytes, true)
  let offset = 44
  for (let index = 0; index < frames; index += 1) {
    view.setInt16(offset, floatToInt16(args.left[index] ?? 0), true)
    view.setInt16(offset + 2, floatToInt16(args.right[index] ?? 0), true)
    offset += 4
  }
  return new Uint8Array(buffer)
}

export function readWavPcm(bytes: Uint8Array): {
  sampleRate: number
  channels: number
  frames: number
  left: Float32Array
  right: Float32Array
} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (readText(view, 0, 4) !== 'RIFF' || readText(view, 8, 4) !== 'WAVE') {
    throw new Error('Not a WAV file.')
  }
  const sampleRate = view.getUint32(24, true)
  const channels = view.getUint16(22, true)
  const dataBytes = view.getUint32(40, true)
  const frames = dataBytes / (channels * 2)
  const left = new Float32Array(frames)
  const right = new Float32Array(frames)
  let offset = 44
  for (let index = 0; index < frames; index += 1) {
    left[index] = view.getInt16(offset, true) / 32767
    right[index] = channels > 1 ? view.getInt16(offset + 2, true) / 32767 : left[index]!
    offset += channels * 2
  }
  return { sampleRate, channels, frames, left, right }
}

function floatToInt16(value: number): number {
  const scaled = Math.round(Math.max(-1, Math.min(1, value)) * 32767)
  return Math.max(-32768, Math.min(32767, scaled))
}

function writeText(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index))
  }
}

function readText(view: DataView, offset: number, length: number): string {
  let text = ''
  for (let index = 0; index < length; index += 1) {
    text += String.fromCharCode(view.getUint8(offset + index))
  }
  return text
}
