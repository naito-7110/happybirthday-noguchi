#!/usr/bin/env node

import { spawn, type ChildProcess } from 'node:child_process'
import { writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// ============ ANSI ============
const ESC = '\x1b['
const RESET = ESC + '0m'
const BOLD = ESC + '1m'
const HIDE_CURSOR = ESC + '?25l'
const SHOW_CURSOR = ESC + '?25h'
const CLEAR_SCREEN = ESC + '2J' + ESC + 'H'
const HOME = ESC + 'H'

const C = {
  red: ESC + '31m',
  yellow: ESC + '33m',
  cyan: ESC + '36m',
  bRed: ESC + '91m',
  bGreen: ESC + '92m',
  bYellow: ESC + '93m',
  bBlue: ESC + '94m',
  bMagenta: ESC + '95m',
  bCyan: ESC + '96m',
  bWhite: ESC + '97m',
  dim: ESC + '90m',
}
const PALETTE = [C.bRed, C.bYellow, C.bGreen, C.bCyan, C.bMagenta, C.bBlue]

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// ============ Audio: WAV generation + cross-platform playback ============
const SAMPLE_RATE = 22050

const F = {
  C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46,
  G5: 783.99, A5: 880.0, B5: 987.77,
  C6: 1046.5, D6: 1174.66, E6: 1318.51, F6: 1396.91, G6: 1567.98,
  R: 0,
}
type Note = [number, number]

// Happy Birthday To You (key of C, with last "to you" cadence)
const SONG: Note[] = [
  [F.G5, 0.75], [F.G5, 0.25], [F.A5, 1], [F.G5, 1], [F.C6, 1], [F.B5, 2],
  [F.G5, 0.75], [F.G5, 0.25], [F.A5, 1], [F.G5, 1], [F.D6, 1], [F.C6, 2],
  [F.G5, 0.75], [F.G5, 0.25], [F.G6, 1], [F.E6, 1], [F.C6, 1], [F.B5, 1], [F.A5, 2],
  [F.F6, 0.75], [F.F6, 0.25], [F.E6, 1], [F.C6, 1], [F.D6, 1], [F.C6, 2],
]
const BPM = 110
const SEC_PER_BEAT = 60 / BPM

function generateWav(notes: Note[]): Buffer {
  const samples: number[] = []
  for (const [freq, beats] of notes) {
    const dur = beats * SEC_PER_BEAT
    const n = Math.max(1, Math.floor(dur * SAMPLE_RATE))
    const attack = Math.max(1, Math.floor(n * 0.04))
    const release = Math.max(1, Math.floor(n * 0.15))
    for (let i = 0; i < n; i++) {
      let amp = 0.45
      if (i < attack) amp *= i / attack
      else if (i > n - release) amp *= (n - i) / release
      let v = 0
      if (freq > 0) {
        const t = i / SAMPLE_RATE
        v = Math.sin(2 * Math.PI * freq * t) * 0.75
          + Math.sin(4 * Math.PI * freq * t) * 0.2
          + Math.sin(6 * Math.PI * freq * t) * 0.05
        v *= amp
      }
      samples.push(Math.max(-32767, Math.min(32767, Math.floor(v * 32767))))
    }
    const gap = Math.floor(SAMPLE_RATE * 0.025)
    for (let i = 0; i < gap; i++) samples.push(0)
  }

  const buf = Buffer.alloc(44 + samples.length * 2)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + samples.length * 2, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(SAMPLE_RATE, 24)
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(samples.length * 2, 40)
  for (let i = 0; i < samples.length; i++) {
    buf.writeInt16LE(samples[i], 44 + i * 2)
  }
  return buf
}

function startAudio(path: string): { stop: () => void } {
  let child: ChildProcess | undefined
  const onErr = () => {} // silently ignore — animation continues either way
  try {
    if (process.platform === 'darwin') {
      child = spawn('afplay', [path], { stdio: 'ignore' })
    } else if (process.platform === 'win32') {
      child = spawn(
        'powershell',
        ['-NoProfile', '-Command', `(New-Object Media.SoundPlayer '${path}').PlaySync()`],
        { stdio: 'ignore' },
      )
    } else {
      const candidates: Array<[string, string[]]> = [
        ['paplay', [path]],
        ['aplay', ['-q', path]],
        ['play', ['-q', path]],
      ]
      for (const [cmd, args] of candidates) {
        try {
          child = spawn(cmd, args, { stdio: 'ignore' })
          break
        } catch {}
      }
    }
    child?.on('error', onErr)
  } catch {}
  return {
    stop: () => {
      try { child?.kill() } catch {}
    },
  }
}

// ============ Wide-char (CJK / emoji) aware canvas ============
function isWide(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0
  if (code < 0x1100) return false
  return (
    (code >= 0x1100 && code <= 0x115F) ||
    (code >= 0x2E80 && code <= 0x9FFF) ||
    (code >= 0xA000 && code <= 0xA4CF) ||
    (code >= 0xAC00 && code <= 0xD7A3) ||
    (code >= 0xF900 && code <= 0xFAFF) ||
    (code >= 0xFE30 && code <= 0xFE4F) ||
    (code >= 0xFF00 && code <= 0xFF60) ||
    (code >= 0xFFE0 && code <= 0xFFE6) ||
    (code >= 0x1F300 && code <= 0x1FAFF) // emoji block
  )
}

type Cell = { ch: string; color: string }

class Canvas {
  cells: Cell[][]
  constructor(public w: number, public h: number) {
    this.cells = Array.from({ length: h }, () =>
      Array.from({ length: w }, () => ({ ch: ' ', color: '' })),
    )
  }
  clear() {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        this.cells[y][x].ch = ' '
        this.cells[y][x].color = ''
      }
    }
  }
  put(x: number, y: number, ch: string, color = '') {
    if (y < 0 || y >= this.h || x < 0 || x >= this.w) return
    this.cells[y][x] = { ch, color }
  }
  text(x: number, y: number, s: string, color = '') {
    let cx = x
    for (const ch of s) {
      if (cx >= this.w) break
      if (isWide(ch)) {
        if (cx + 1 >= this.w) break
        this.put(cx, y, ch, color)
        this.put(cx + 1, y, '', color) // marker: consumed by previous wide cell
        cx += 2
      } else {
        this.put(cx, y, ch, color)
        cx += 1
      }
    }
  }
  textWidth(s: string): number {
    let w = 0
    for (const ch of s) w += isWide(ch) ? 2 : 1
    return w
  }
  render(): string {
    let out = HOME
    for (let y = 0; y < this.h; y++) {
      let line = ''
      let cur = ''
      for (let x = 0; x < this.w; x++) {
        const c = this.cells[y][x]
        if (c.ch === '') continue
        if (c.color !== cur) {
          if (cur) line += RESET
          if (c.color) line += c.color
          cur = c.color
        }
        line += c.ch
      }
      if (cur) line += RESET
      out += line + ESC + 'K'
      if (y < this.h - 1) out += '\n'
    }
    return out
  }
}

// ============ Font ============
const FONT: Record<string, string[]> = {
  H: ['##  ##', '##  ##', '######', '##  ##', '##  ##'],
  A: [' #### ', '##  ##', '######', '##  ##', '##  ##'],
  P: ['##### ', '##  ##', '##### ', '##    ', '##    '],
  Y: ['##  ##', '##  ##', ' #### ', '  ##  ', '  ##  '],
  B: ['##### ', '##  ##', '##### ', '##  ##', '##### '],
  I: ['######', '  ##  ', '  ##  ', '  ##  ', '######'],
  R: ['##### ', '##  ##', '##### ', '## ## ', '##  ##'],
  T: ['######', '  ##  ', '  ##  ', '  ##  ', '  ##  '],
  D: ['##### ', '##  ##', '##  ##', '##  ##', '##### '],
  ' ': ['      ', '      ', '      ', '      ', '      '],
}
function bigText(s: string): string[] {
  const lines = ['', '', '', '', '']
  for (const ch of s.toUpperCase()) {
    const g = FONT[ch] ?? FONT[' ']
    for (let i = 0; i < 5; i++) lines[i] += g[i] + ' '
  }
  return lines
}

// ============ Scenes ============
type Spark = { x: number; y: number; vx: number; vy: number; age: number; color: string; ch: string }
type Rocket = { x: number; y: number; tx: number; ty: number; color: string }

function drawBurst(canvas: Canvas, cx: number, cy: number, r: number, color: string) {
  const pts =
    r === 0 ? [[0, 0]]
    : r === 1 ? [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]
    : r === 2 ? [[-2, 0], [2, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]
    : r === 3 ? [[-3, 0], [3, 0], [0, -2], [0, 2], [-2, -1], [2, -1], [-2, 1], [2, 1], [-1, -2], [1, -2], [-1, 2], [1, 2]]
    : [[-4, 0], [4, 0], [0, -2], [0, 2], [-3, -1], [3, -1], [-3, 1], [3, 1], [-2, -2], [2, -2], [-2, 2], [2, 2]]
  for (const [dx, dy] of pts) {
    canvas.put(cx + dx, cy + dy, r >= 3 ? '.' : '*', color)
  }
}

async function sceneFireworks(canvas: Canvas, duration: number) {
  const end = Date.now() + duration
  const rockets: Rocket[] = []
  const bursts: Array<{ x: number; y: number; age: number; color: string }> = []
  let nextSpawn = 0
  while (Date.now() < end) {
    canvas.clear()
    if (Date.now() > nextSpawn) {
      const tx = Math.floor(canvas.w * (0.2 + Math.random() * 0.6))
      const ty = Math.floor(canvas.h * (0.2 + Math.random() * 0.4))
      rockets.push({
        x: tx,
        y: canvas.h - 1,
        tx,
        ty,
        color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
      })
      nextSpawn = Date.now() + 350
    }
    for (const r of rockets) {
      r.y -= 2
      canvas.put(r.x, r.y, '|', r.color)
      canvas.put(r.x, r.y + 1, '.', C.dim)
      if (r.y <= r.ty) {
        bursts.push({ x: r.x, y: r.y, age: 0, color: r.color })
      }
    }
    for (let i = rockets.length - 1; i >= 0; i--) {
      if (rockets[i].y <= rockets[i].ty) rockets.splice(i, 1)
    }
    for (const b of bursts) drawBurst(canvas, b.x, b.y, b.age, b.color)
    for (const b of bursts) b.age++
    while (bursts.length && bursts[0].age > 4) bursts.shift()
    process.stdout.write(canvas.render())
    await sleep(70)
  }
}

function paintRainbow(canvas: Canvas, x: number, y: number, line: string, offset: number) {
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === ' ') continue
    canvas.put(x + i, y, ch, PALETTE[(i + offset) % PALETTE.length])
  }
}

async function sceneTitle(canvas: Canvas, duration: number) {
  const happy = bigText('HAPPY')
  const birthday = bigText('BIRTHDAY')
  const happyX = Math.floor((canvas.w - happy[0].length) / 2)
  const birthX = Math.floor((canvas.w - birthday[0].length) / 2)
  const startY = Math.max(1, Math.floor((canvas.h - 13) / 2))

  const end = Date.now() + duration
  let frame = 0
  while (Date.now() < end) {
    canvas.clear()
    // ambient sparkles in background
    for (let i = 0; i < 10; i++) {
      const x = (i * 7 + frame * 3) % canvas.w
      const y = (i * 3 + frame) % canvas.h
      canvas.put(x, y, '.', C.dim)
    }
    const reveal = Math.min(11, Math.floor(frame / 2))
    for (let i = 0; i < 5 && i < reveal; i++) {
      paintRainbow(canvas, happyX, startY + i, happy[i], frame + i)
    }
    for (let i = 0; i < 5 && i + 6 < reveal; i++) {
      paintRainbow(canvas, birthX, startY + 6 + i, birthday[i], frame + i + 3)
    }
    if (reveal >= 11) {
      const tag = '~ for Noguchi ~'
      const tx = Math.floor((canvas.w - tag.length) / 2)
      canvas.text(tx, startY + 12, tag, BOLD + C.bYellow)
    }
    process.stdout.write(canvas.render())
    await sleep(90)
    frame++
  }
}

async function sceneCard(canvas: Canvas, lines: string[], duration: number) {
  const innerW = Math.max(...lines.map((l) => canvas.textWidth(l)), 30)
  const boxW = Math.min(innerW + 6, canvas.w - 2)
  const boxH = lines.length + 6
  const boxX = Math.floor((canvas.w - boxW) / 2)
  const boxY = Math.max(1, Math.floor((canvas.h - boxH) / 2))

  const drawBox = () => {
    canvas.put(boxX, boxY, '+', C.bMagenta)
    canvas.put(boxX + boxW - 1, boxY, '+', C.bMagenta)
    canvas.put(boxX, boxY + boxH - 1, '+', C.bMagenta)
    canvas.put(boxX + boxW - 1, boxY + boxH - 1, '+', C.bMagenta)
    for (let x = boxX + 1; x < boxX + boxW - 1; x++) {
      canvas.put(x, boxY, '-', C.bMagenta)
      canvas.put(x, boxY + boxH - 1, '-', C.bMagenta)
    }
    for (let y = boxY + 1; y < boxY + boxH - 1; y++) {
      canvas.put(boxX, y, '|', C.bMagenta)
      canvas.put(boxX + boxW - 1, y, '|', C.bMagenta)
    }
    canvas.text(boxX + 2, boxY, ' To: Noguchi ', BOLD + C.bCyan)
    canvas.text(boxX + boxW - 8, boxY + boxH - 1, ' <3 ', C.bRed)
  }

  // Per-codepoint typing
  type Pos = { line: number; idx: number; ch: string }
  const seq: Pos[] = []
  for (let li = 0; li < lines.length; li++) {
    const arr = [...lines[li]]
    for (let i = 0; i < arr.length; i++) seq.push({ line: li, idx: i, ch: arr[i] })
    seq.push({ line: li, idx: -1, ch: '\n' })
  }
  const perCh = Math.max(35, duration / Math.max(seq.length, 1))

  let typed = 0
  while (typed <= seq.length) {
    canvas.clear()
    drawBox()
    // draw lines up to typed
    let consumed = 0
    for (let li = 0; li < lines.length; li++) {
      const arr = [...lines[li]]
      const lineLen = arr.length + 1
      const taken = Math.max(0, Math.min(arr.length, typed - consumed))
      const partial = arr.slice(0, taken).join('')
      canvas.text(boxX + 3, boxY + 2 + li, partial, C.bWhite)
      // cursor on the active line
      if (typed - consumed >= 0 && typed - consumed < arr.length) {
        const partialW = canvas.textWidth(partial)
        canvas.put(boxX + 3 + partialW, boxY + 2 + li, '_', C.bYellow)
      }
      consumed += lineLen
    }
    process.stdout.write(canvas.render())
    await sleep(perCh)
    typed++
  }
  // Hold last frame briefly
  await sleep(600)
}

async function sceneFinale(canvas: Canvas, duration: number) {
  const end = Date.now() + duration
  let frame = 0
  const msg = 'Happy Birthday, Noguchi !!'
  const msgX = Math.floor((canvas.w - msg.length) / 2)
  const msgY = Math.floor(canvas.h / 2)
  while (Date.now() < end) {
    canvas.clear()
    for (let i = 0; i < 10; i++) {
      const x = Math.floor(Math.random() * (canvas.w - 6)) + 3
      const y = Math.floor(Math.random() * (canvas.h - 4)) + 2
      const r = (frame + i) % 4 + 1
      const color = PALETTE[(frame + i) % PALETTE.length]
      drawBurst(canvas, x, y, r, color)
    }
    // central banner stays put
    for (let x = msgX - 2; x < msgX + msg.length + 2; x++) {
      canvas.put(x, msgY - 1, ' ', '')
      canvas.put(x, msgY, ' ', '')
      canvas.put(x, msgY + 1, ' ', '')
    }
    canvas.text(msgX, msgY, msg, BOLD + C.bMagenta)
    process.stdout.write(canvas.render())
    await sleep(110)
    frame++
  }
}

// ============ Main ============
const MESSAGE_LINES = [
  '',
  'ノグさん！！',
  '誕生日プレゼント遅れてすまん。。。',
  'ラスト20代楽しんでいこうぜ！！',
  '',
  'アマギフのシリアルとか載せようと',
  '思ったけどOSSだからやめとくわ！！',
  '',
  'いつでも飯でも奢ります 👍',
  '',
]

async function main() {
  process.stdout.write(HIDE_CURSOR + CLEAR_SCREEN)
  const restore = () => {
    process.stdout.write(SHOW_CURSOR + RESET + '\n')
  }
  process.on('SIGINT', () => {
    restore()
    process.exit(130)
  })

  const wavPath = join(tmpdir(), `happybirthday-noguchi-${process.pid}.wav`)
  let audioStarted = false
  let audio: { stop: () => void } = { stop: () => {} }
  try {
    writeFileSync(wavPath, generateWav(SONG))
    audio = startAudio(wavPath)
    audioStarted = true
  } catch {}

  const W = Math.max(60, Math.min(process.stdout.columns || 80, 100))
  const H = Math.max(20, Math.min(process.stdout.rows || 24, 30))
  const canvas = new Canvas(W, H)

  try {
    await sceneFireworks(canvas, 2200)
    await sceneTitle(canvas, 4000)
    await sceneCard(canvas, MESSAGE_LINES, 9000)
    await sceneFinale(canvas, 2800)
  } finally {
    audio.stop()
    if (audioStarted) {
      try { unlinkSync(wavPath) } catch {}
    }
    restore()
  }
}

main().catch((e) => {
  process.stdout.write(SHOW_CURSOR + RESET + '\n')
  console.error(e)
  process.exit(1)
})
