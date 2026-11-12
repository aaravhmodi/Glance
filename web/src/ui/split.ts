// Split-screen layout + labels (pure, unit-tested in tests/split.test.ts). Two 16:9 panels side by side inside the W x H view.
export interface Rect { x: number; y: number; w: number; h: number }

export function splitPanels(W: number, H: number, gap = 8): { left: Rect; right: Rect } {
  const w = Math.floor((W - gap) / 2)
  const h = Math.round((w * 9) / 16)
  const y = Math.round((H - h) / 2)
  return { left: { x: 0, y, w, h }, right: { x: W - w, y, w, h } }
}

export function panelLabel(title: string, kbps: number, bytes: number): string {
  return `${title}: ${kbps.toFixed(0)} kbps (${(bytes / 1000).toFixed(0)} kB total)`
}

export function savedLabel(pct: number): string {
  return `${Math.abs(pct).toFixed(0)}% ${pct >= 0 ? 'bandwidth saved' : 'MORE bandwidth'} vs normal`
}
