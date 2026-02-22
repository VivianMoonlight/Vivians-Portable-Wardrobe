function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function normalizeHue(h) {
  if (!Number.isFinite(h)) return 0
  const normalized = h % 360
  return normalized < 0 ? normalized + 360 : normalized
}

function parsePercent(v) {
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  if (!trimmed) return null
  if (trimmed.endsWith('%')) {
    const n = Number.parseFloat(trimmed.slice(0, -1))
    return Number.isFinite(n) ? n : null
  }
  const n = Number.parseFloat(trimmed)
  return Number.isFinite(n) ? n : null
}

function parseHexColor(input) {
  const str = String(input || '').trim()
  if (!str.startsWith('#')) return null
  const hex = str.slice(1)

  if (hex.length === 3 || hex.length === 4) {
    const chars = hex.split('')
    const r = Number.parseInt(chars[0] + chars[0], 16)
    const g = Number.parseInt(chars[1] + chars[1], 16)
    const b = Number.parseInt(chars[2] + chars[2], 16)
    if ([r, g, b].every(Number.isFinite)) return { r, g, b }
    return null
  }

  if (hex.length === 6 || hex.length === 8) {
    const r = Number.parseInt(hex.slice(0, 2), 16)
    const g = Number.parseInt(hex.slice(2, 4), 16)
    const b = Number.parseInt(hex.slice(4, 6), 16)
    if ([r, g, b].every(Number.isFinite)) return { r, g, b }
    return null
  }

  return null
}

function parseRgbColor(input) {
  const str = String(input || '').trim()
  const match = str.match(/^rgba?\((.+)\)$/i)
  if (!match) return null

  const parts = match[1].split(',').map(p => p.trim())
  if (parts.length < 3) return null

  const vals = parts.slice(0, 3).map((v) => {
    if (v.endsWith('%')) {
      const n = Number.parseFloat(v.slice(0, -1))
      if (!Number.isFinite(n)) return null
      return clamp(Math.round((n / 100) * 255), 0, 255)
    }
    const n = Number.parseFloat(v)
    if (!Number.isFinite(n)) return null
    return clamp(Math.round(n), 0, 255)
  })

  if (vals.some(v => v === null)) return null
  return { r: vals[0], g: vals[1], b: vals[2] }
}

function hlsToRgb(h, l, s) {
  const hh = normalizeHue(h) / 360
  const ll = clamp(l, 0, 100) / 100
  const ss = clamp(s, 0, 100) / 100

  if (ss === 0) {
    const v = Math.round(ll * 255)
    return { r: v, g: v, b: v }
  }

  const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss
  const p = 2 * ll - q

  const hueToRgb = (pp, qq, tt) => {
    let t = tt
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return pp + (qq - pp) * 6 * t
    if (t < 1 / 2) return qq
    if (t < 2 / 3) return pp + (qq - pp) * (2 / 3 - t) * 6
    return pp
  }

  return {
    r: Math.round(hueToRgb(p, q, hh + 1 / 3) * 255),
    g: Math.round(hueToRgb(p, q, hh) * 255),
    b: Math.round(hueToRgb(p, q, hh - 1 / 3) * 255)
  }
}

function parseHslColor(input) {
  const str = String(input || '').trim()
  const match = str.match(/^hsla?\((.+)\)$/i)
  if (!match) return null

  const parts = match[1].split(',').map(p => p.trim())
  if (parts.length < 3) return null

  const h = Number.parseFloat(parts[0])
  const l = parsePercent(parts[2])
  const s = parsePercent(parts[1])
  if (!Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(s)) return null

  return hlsToRgb(h, l, s)
}

export function parseColorToRgb(input) {
  if (input === null || input === undefined) return null
  const str = String(input).trim()
  if (!str) return null

  return parseHexColor(str) || parseRgbColor(str) || parseHslColor(str)
}

export function rgbToHls(r, g, b) {
  const rr = clamp(r, 0, 255) / 255
  const gg = clamp(g, 0, 255) / 255
  const bb = clamp(b, 0, 255) / 255

  const max = Math.max(rr, gg, bb)
  const min = Math.min(rr, gg, bb)
  const delta = max - min

  let h = 0
  const l = (max + min) / 2
  let s = 0

  if (delta !== 0) {
    s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min)
    switch (max) {
      case rr:
        h = ((gg - bb) / delta + (gg < bb ? 6 : 0)) * 60
        break
      case gg:
        h = ((bb - rr) / delta + 2) * 60
        break
      default:
        h = ((rr - gg) / delta + 4) * 60
        break
    }
  }

  return {
    h: normalizeHue(h),
    l: l * 100,
    s: s * 100
  }
}

export function hlsToRgbColor(h, l, s) {
  return hlsToRgb(h, l, s)
}

export function rgbToHex({ r, g, b }) {
  const toHex = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

export function normalizeHlsOffset(offset = {}) {
  return {
    h: clamp(Number.parseInt(offset.h ?? 0, 10) || 0, -180, 180),
    l: clamp(Number.parseInt(offset.l ?? 0, 10) || 0, -100, 100),
    s: clamp(Number.parseInt(offset.s ?? 0, 10) || 0, -100, 100)
  }
}

export function applyHlsOffsetToColor(baseColor, offset = {}) {
  const rgb = parseColorToRgb(baseColor)
  if (!rgb) {
    return { ok: false, color: null, reason: 'invalid-base-color' }
  }

  const normalizedOffset = normalizeHlsOffset(offset)
  const hls = rgbToHls(rgb.r, rgb.g, rgb.b)
  const outH = normalizeHue(hls.h + normalizedOffset.h)
  const outL = clamp(hls.l + normalizedOffset.l, 0, 100)
  const outS = clamp(hls.s + normalizedOffset.s, 0, 100)

  const outRgb = hlsToRgb(outH, outL, outS)
  return {
    ok: true,
    color: rgbToHex(outRgb),
    baseHls: hls,
    resolvedHls: { h: outH, l: outL, s: outS },
    offset: normalizedOffset
  }
}

export function getHlsOffsetBetweenColors(baseColor, targetColor) {
  const baseRgb = parseColorToRgb(baseColor)
  const targetRgb = parseColorToRgb(targetColor)
  if (!baseRgb || !targetRgb) {
    return { ok: false, offset: { h: 0, l: 0, s: 0 }, reason: 'invalid-color' }
  }

  const baseHls = rgbToHls(baseRgb.r, baseRgb.g, baseRgb.b)
  const targetHls = rgbToHls(targetRgb.r, targetRgb.g, targetRgb.b)

  let hueDiff = targetHls.h - baseHls.h
  if (hueDiff > 180) hueDiff -= 360
  if (hueDiff < -180) hueDiff += 360

  const offset = normalizeHlsOffset({
    h: Math.round(hueDiff),
    l: Math.round(targetHls.l - baseHls.l),
    s: Math.round(targetHls.s - baseHls.s)
  })

  return {
    ok: true,
    offset,
    baseHls,
    targetHls
  }
}
