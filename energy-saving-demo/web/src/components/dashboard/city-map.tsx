// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

import { useMemo } from 'react'

// If a picture of the city is put at src/assets/city-map.jpg (or .png, .webp) it becomes the background at build time.
const PHOTO = Object.values(import.meta.glob<string>('../../assets/city-map.{jpg,jpeg,png,webp}', { eager: true, query: '?url', import: 'default' }))[0]

/** Small deterministic generator so the city is the same on every load. */
function rng(seed: number) {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

const HALF = 34 // blocks from the centre to the edge of the lattice
const S = 13 // lattice step in pixels
const ROAD = 7 // every 7th line is an avenue
const RING = [17, 21] // the ring road lies between these radii (lattice units)
const CORE = 8 // quiet open middle, as in the reference

/** Isometric position of lattice point (i, j), with the origin at the middle of the map. */
const iso = (i: number, j: number) => ({ x: (i - j) * S, y: ((i + j) * S) / 2 })
const pts = (...p: [number, number][]) => `M${p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L')}Z`

/**
 * 2.6 Central map: a blue night-time 3D bird's-eye city. If src/assets/city-map.jpg exists it is used; otherwise an
 * isometric city is generated: dense blocks that rise towards the middle, a glowing ring road, avenues and a river.
 * Visual background only, as the design says.
 */
export function CityMapBackground() {
  const scene = useMemo(() => {
    if (PHOTO) return null // the picture replaces the generated city, so skip building it
    const r = rng(2026)
    const boxes: { x: number; y: number; h: number; lit: boolean }[] = []
    for (let i = -HALF; i < HALF; i++) {
      for (let j = -HALF; j < HALF; j++) {
        const d = Math.hypot(i + 0.5, j + 0.5)
        const river = Math.abs(i - j * 0.6 + 11) < 1.6 && d > CORE
        const onRoad = ((i % ROAD) + ROAD) % ROAD === 0 || ((j % ROAD) + ROAD) % ROAD === 0
        const onRing = d > RING[0] && d < RING[1]
        if (river || onRoad || onRing || d < CORE || d > HALF - 1 || r() > 0.93) continue
        const near = Math.max(0, 1 - d / HALF)
        const h = 3 + r() * (6 + 30 * near ** 1.5) + (r() > 0.95 ? 18 * (0.4 + near) : 0)
        const p = iso(i + 0.5, j + 0.5)
        boxes.push({ x: p.x, y: p.y, h, lit: r() > 0.985 })
      }
    }
    boxes.sort((p, q) => p.y - q.y)
    // One path per colour keeps the page light: thousands of faces, three elements.
    const w = S * 0.42
    const t = w / 2
    let left = ''
    let right = ''
    let top = ''
    for (const b of boxes) {
      const { x, y, h } = b
      top += pts([x, y - h - t], [x + w, y - h], [x, y - h + t], [x - w, y - h])
      left += pts([x - w, y - h], [x, y - h + t], [x, y + t], [x - w, y])
      right += pts([x, y - h + t], [x + w, y - h], [x + w, y], [x, y + t])
    }
    let roads = ''
    for (let k = -HALF; k <= HALF; k += ROAD) {
      const a = iso(k, -HALF)
      const b = iso(k, HALF)
      const c = iso(-HALF, k)
      const d = iso(HALF, k)
      roads += `M${a.x},${a.y}L${b.x},${b.y}M${c.x},${c.y}L${d.x},${d.y}`
    }
    return { boxes, left, right, top, roads }
  }, [])
  const ring = (rad: number) => ({ rx: rad * S * Math.SQRT2, ry: (rad * S * Math.SQRT2) / 2 })
  return (
    <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden bg-[radial-gradient(ellipse_at_50%_45%,#0d4fb5_0%,#082a6b_38%,#040f2c_80%)]" aria-hidden="true">
      {scene && <svg viewBox="-520 -300 1040 640" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 size-full">
        <defs>
          <radialGradient id="glow" r="0.5">
            <stop offset="0" stopColor="#4fd8ff" stopOpacity=".9" />
            <stop offset="1" stopColor="#4fd8ff" stopOpacity="0" />
          </radialGradient>
          <filter id="soft">
            <feGaussianBlur stdDeviation="1.6" />
          </filter>
        </defs>
        <g filter="url(#soft)" fill="none" stroke="#2f9bff">
          <path d={scene.roads} strokeWidth="1.6" opacity=".5" />
          <ellipse cx="0" cy="0" {...ring((RING[0] + RING[1]) / 2)} stroke="#6fd8ff" strokeWidth="4.5" opacity=".85" />
          <ellipse cx="0" cy="0" {...ring(RING[1] + 0.5)} strokeWidth="1.8" opacity=".6" />
          <ellipse cx="0" cy="0" {...ring(RING[0] - 0.5)} strokeWidth="1.8" opacity=".6" />
          <ellipse cx="0" cy="0" {...ring(CORE)} stroke="#6fd8ff" strokeWidth="2.4" opacity=".7" />
        </g>
        <path d={scene.left} fill="#1448a8" />
        <path d={scene.right} fill="#0b2f78" />
        <path d={scene.top} fill="#52adff" opacity=".92" />
        {scene.boxes.map((b, k) =>
          b.lit ? (
            <g key={k} className="site-glow" style={{ animationDelay: `${(k % 9) * 0.4}s` }}>
              <circle cx={b.x} cy={b.y - b.h} r="11" fill="url(#glow)" />
              <circle cx={b.x} cy={b.y - b.h} r="1.8" fill="#4fd8ff" />
            </g>
          ) : null,
        )}
      </svg>}
      {PHOTO && <img src={PHOTO} alt="" decoding="async" fetchPriority="high" className="absolute inset-0 size-full object-cover" />}
      <div className="absolute inset-0 bg-gradient-to-b from-[#040f2c]/50 via-transparent to-[#040f2c]/70" />
    </div>
  )
}
