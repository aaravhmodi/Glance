/** One gaze estimate in screen pixels (coordinates of the app's 1280x720 view). */
export interface GazeSample {
  x: number
  y: number
  /** Uncertainty radius in px (1 sigma). */
  sigma: number
  /** performance.now() clock, ms. */
  timestamp: number
  /** 0..1; 0 = no face / no estimate. */
  confidence: number
}

export interface GazeSource {
  readonly name: 'mouse' | 'eyes'
  /** Latest sample, or null if none yet. */
  read(): GazeSample | null
}
