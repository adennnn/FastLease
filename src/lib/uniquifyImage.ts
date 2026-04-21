import sharp from 'sharp'

// Deterministic PRNG (mulberry32) — same seed → same variant, different seeds → different pixels.
type Rng = () => number
function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = (rng: Rng, min: number, max: number) => min + rng() * (max - min)

/**
 * Bust perceptual-hash duplicate detection (Meta, etc.) with small, visually
 * neutral transforms. Strips EXIF metadata, applies a tiny rotate + inner
 * crop + brightness/saturation/hue shift, and re-encodes JPEG at a random
 * quality level. The result is visually identical to a human but pixel-unique.
 *
 * Seeding is deterministic so retries can reproduce the same output, but
 * different seeds across posts/accounts produce different pixels.
 */
export async function uniquifyImage(input: Buffer, seed: number): Promise<Buffer> {
  const rng = mulberry32(seed || 1)

  const rotateDeg = rand(rng, -0.8, 0.8)            // barely visible tilt
  const cropPct = rand(rng, 0.96, 0.99)             // keep 96–99% of frame
  const brightness = rand(rng, 0.97, 1.03)          // ±3 %
  const saturation = rand(rng, 0.94, 1.06)          // ±6 %
  const hueDeg = Math.round(rand(rng, -4, 4))       // ±4°
  const quality = Math.round(rand(rng, 82, 94))     // varied JPEG quality

  try {
    // Rotate with a white background so rotated edges don't crop into black.
    const rotated = await sharp(input)
      .rotate(rotateDeg, { background: { r: 255, g: 255, b: 255, alpha: 1 } })
      .toBuffer()

    const meta = await sharp(rotated).metadata()
    const rw = meta.width || 0
    const rh = meta.height || 0
    if (!rw || !rh) return input

    const cropW = Math.max(1, Math.floor(rw * cropPct))
    const cropH = Math.max(1, Math.floor(rh * cropPct))
    const left = Math.floor(rand(rng, 0, rw - cropW + 1))
    const top = Math.floor(rand(rng, 0, rh - cropH + 1))

    return await sharp(rotated)
      .extract({ left, top, width: cropW, height: cropH })
      .modulate({ brightness, saturation, hue: hueDeg })
      .jpeg({ quality, mozjpeg: true })
      // No .withMetadata() call → sharp strips EXIF/GPS/device info by default.
      .toBuffer()
  } catch {
    // If the image is unreadable for any reason, fall back to the original so
    // the post still has photos (better a plain photo than none).
    return input
  }
}
