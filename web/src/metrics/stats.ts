// Bandwidth accounting for one encoder: bytes per second bucket, running totals, and "% saved" versus a baseline.
// Pure (no DOM), so it is unit-tested in tests/stats.test.ts.

export class ByteStats {
  private buckets = new Map<number, number>() // whole second index -> bytes
  total = 0
  chunks = 0
  private first = Infinity
  private last = -Infinity

  /** Record one encoded chunk of `bytes` at time `tSec` (seconds, any monotonic origin). */
  add(tSec: number, bytes: number): void {
    if (!Number.isFinite(tSec) || !(bytes >= 0)) return
    const s = Math.floor(tSec)
    this.buckets.set(s, (this.buckets.get(s) ?? 0) + bytes)
    this.total += bytes
    this.chunks++
    this.first = Math.min(this.first, tSec)
    this.last = Math.max(this.last, tSec)
  }

  /** kbps of the most recent *complete* second before `nowSec` (0 if none yet). */
  lastSecondKbps(nowSec: number): number {
    return ((this.buckets.get(Math.floor(nowSec) - 1) ?? 0) * 8) / 1000
  }

  /** Average kbps over the recorded span (at least 1 s, so a short run is not inflated). */
  averageKbps(): number {
    if (this.chunks === 0) return 0
    const span = Math.max(1, this.last - this.first)
    return (this.total * 8) / 1000 / span
  }
}

/** Percentage of bytes saved by `bytes` relative to `baselineBytes` (negative if it is bigger). 0 when there is no baseline. */
export function percentSaved(baselineBytes: number, bytes: number): number {
  if (!(baselineBytes > 0)) return 0
  return (1 - bytes / baselineBytes) * 100
}
