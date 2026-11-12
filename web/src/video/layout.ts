// Pure helpers for the video sources (unit-tested).
export interface SourceInfo { id: string; label: string; kind: 'clip' | 'webcam' | 'synthetic' }

/** Largest rectangle with the source aspect ratio that fits (letterbox) in dw x dh, centred. */
export function fitRect(sw: number, sh: number, dw: number, dh: number): { x: number; y: number; w: number; h: number } {
  if (!(sw > 0) || !(sh > 0)) return { x: 0, y: 0, w: dw, h: dh }
  const k = Math.min(dw / sw, dh / sh)
  const w = sw * k, h = sh * k
  return { x: (dw - w) / 2, y: (dh - h) / 2, w, h }
}

/** Key '1'..'9' -> the n-th option (clips first, then webcam); undefined otherwise. */
export function sourceForKey(key: string, options: SourceInfo[]): SourceInfo | undefined {
  if (!/^[1-9]$/.test(key)) return undefined
  return options[Number(key) - 1]
}
