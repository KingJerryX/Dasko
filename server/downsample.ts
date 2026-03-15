/**
 * PCM16 audio downsampler: 24 kHz → 16 kHz.
 *
 * Uses linear interpolation at the 3:2 ratio.
 * Stateless per-chunk — minor boundary discontinuities are
 * inaudible for speech-to-text purposes.
 */

export function downsample24kTo16k(input: Buffer): Buffer {
  const bytesPerSample = 2; // 16-bit PCM
  const inputSamples = Math.floor(input.length / bytesPerSample);
  if (inputSamples === 0) return Buffer.alloc(0);

  const ratio = 24000 / 16000; // 1.5
  const outputSamples = Math.floor(inputSamples / ratio);
  const output = Buffer.alloc(outputSamples * bytesPerSample);

  for (let i = 0; i < outputSamples; i++) {
    const srcPos   = i * ratio;
    const srcFloor = Math.floor(srcPos);
    const frac     = srcPos - srcFloor;

    const s0 = input.readInt16LE(srcFloor * bytesPerSample);
    const s1 = srcFloor + 1 < inputSamples
      ? input.readInt16LE((srcFloor + 1) * bytesPerSample)
      : s0;

    const interpolated = Math.round(s0 + frac * (s1 - s0));
    output.writeInt16LE(
      Math.max(-32768, Math.min(32767, interpolated)),
      i * bytesPerSample,
    );
  }

  return output;
}
