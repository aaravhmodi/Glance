// WebGL2 foveation: full quality near the gaze point, Gaussian falloff, heavily downscaled + blurred periphery.
// The periphery is sampled from a high mip level (box-downscaled by up to 2^3.5, then trilinear-interpolated)
// with a small tap cross for extra smoothness. Output is a canvas; `frame(ts)` wraps it in a VideoFrame for WebCodecs.
// Note: WebCodecs QP is per frame, not per region, so quality differences come only from this pre-filter.
import { FALLOFF, MAX_LOD } from './fovea'

const VS = `#version 300 es
in vec2 p; out vec2 uv;
void main(){ uv = p*0.5+0.5; gl_Position = vec4(p,0.,1.); }`

const FS = `#version 300 es
precision highp float;
uniform sampler2D tex; uniform vec2 gaze; uniform float radius; uniform vec2 size; uniform float reveal;
in vec2 uv; out vec4 o;
void main(){
  vec2 t = vec2(uv.x, 1.0-uv.y);                  // top-left origin, like the 2D view (no UNPACK_FLIP_Y)
  vec2 px = t*size;
  float d = distance(px, gaze);
  float k = max(d-radius, 0.0)/(radius*${FALLOFF.toFixed(3)});
  float q = d <= radius ? 1.0 : exp(-k*k);
  float lod = ${MAX_LOD.toFixed(2)}*(1.0-q);
  vec2 texel = exp2(lod)/size;
  vec3 c = textureLod(tex, t, lod).rgb*0.4;
  c += textureLod(tex, t+vec2(texel.x,0.), lod).rgb*0.15;
  c += textureLod(tex, t-vec2(texel.x,0.), lod).rgb*0.15;
  c += textureLod(tex, t+vec2(0.,texel.y), lod).rgb*0.15;
  c += textureLod(tex, t-vec2(0.,texel.y), lod).rgb*0.15;
  if (reveal > 0.5) c = mix(c, vec3(q, 0.15, 1.0-q), 0.35);   // quality map overlay (red = sharp, blue = coarse)
  o = vec4(c,1.);
}`

export class Foveator {
  readonly canvas: HTMLCanvasElement
  private gl: WebGL2RenderingContext
  private u: Record<string, WebGLUniformLocation | null> = {}
  reveal = false
  readonly width: number
  readonly height: number

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    this.canvas = document.createElement('canvas')
    this.canvas.width = width
    this.canvas.height = height
    const gl = this.canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false })
    if (!gl) throw new Error('WebGL2 not available')
    this.gl = gl
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s))
      return s
    }
    const prog = gl.createProgram()!
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS))
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS))
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(prog))
    gl.useProgram(prog)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(prog, 'p')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    for (const n of ['tex', 'gaze', 'radius', 'size', 'reveal']) this.u[n] = gl.getUniformLocation(prog, n)
    const t = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.uniform1i(this.u.tex, 0)
    gl.uniform2f(this.u.size, width, height)
    gl.viewport(0, 0, width, height)
  }

  /** Render `src` (width x height) foveated at gaze (px, top-left origin) with fovea radius `radius` (px). */
  render(src: TexImageSource, gazeX: number, gazeY: number, radius: number): void {
    const gl = this.gl
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, src)
    gl.generateMipmap(gl.TEXTURE_2D)
    gl.uniform2f(this.u.gaze, gazeX, gazeY)
    gl.uniform1f(this.u.radius, Math.max(1, radius))
    gl.uniform1f(this.u.reveal, this.reveal ? 1 : 0)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  /** Snapshot of the last render for the encoder. Caller must close() it. */
  frame(timestampUs: number): VideoFrame {
    return new VideoFrame(this.canvas, { timestamp: timestampUs })
  }
}
