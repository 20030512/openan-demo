// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from 'react'
import { AgentDialog } from '@/components/dashboard/agent-dialog'
import { CityMapBackground } from '@/components/dashboard/city-map'
import { ArchitecturePanel, AutonomousSavingPanel } from '@/components/dashboard/ecosystem-panels'
import { EnergySummaryPanel } from '@/components/dashboard/side-panels'
import { FooterMenu } from '@/components/dashboard/footer-menu'
import { TopHeader, type Route } from '@/components/dashboard/top-header'
import { LangProvider } from '@/lib/i18n'
import { DesignPage } from '@/pages/design'
import { TestDataPage } from '@/pages/test-data'

const routeOf = (hash: string): Route => {
  if (hash.startsWith('#/data')) return 'data'
  if (hash.startsWith('#/design')) return 'design'
  return 'dashboard'
}

/**
 * The page is drawn for a reference screen of 1440 x 800 and, from 1024 px wide on, scaled by the ratio of the real
 * screen to it: on a huge screen every frame, text and chart is as many times bigger, on a small one smaller, and
 * the layout (the proportions between the frames) stays the same. Phones (under 1024 px) keep the stacked layout.
 * The factor is also put in --ui-zoom for pop-ups, which are drawn outside this box.
 */
const REF_W = 1440
const REF_H = 800
// The smallest page that still shows every chart and frame properly: 1280 x 720 real pixels (the reference scaled by 8/9).
// On a smaller window the page stops shrinking and scrolls instead of squeezing the charts.
const MIN_SCALE = 8 / 9
const MAX_SCALE = 3

const scaleFor = (w: number, h: number) => (w < 1024 ? 1 : Math.round(Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min(w / REF_W, h / REF_H))) * 1000) / 1000)

function useViewport() {
  const read = () => ({ w: window.innerWidth, h: window.innerHeight })
  const [size, setSize] = useState(read)
  useEffect(() => {
    const onResize = () => setSize(read())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const scale = scaleFor(size.w, size.h)
  useEffect(() => {
    document.documentElement.style.setProperty('--ui-zoom', String(scale))
  }, [scale])
  return { ...size, scale, big: size.w >= 1024 }
}

const useRoute = () => {
  const [route, setRoute] = useState(() => routeOf(window.location.hash))
  useEffect(() => {
    const onChange = () => {
      setRoute(routeOf(window.location.hash))
      window.scrollTo({ top: 0 })
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

/**
 * UC2 layout (design doc 2.1): title bar on top, then three columns. Left: statistics over the task dialog.
 * Centre: city map. Right: the three-tier architecture over the five stages of autonomous energy saving. On a desktop screen the three columns fill the window
 * exactly, so nothing needs scrolling; on a phone they stack.
 */
function Dashboard() {
  return (
    <div className="grid gap-5 lg:h-full lg:grid-cols-[minmax(340px,1fr)_minmax(0,1.05fr)_minmax(340px,1fr)] lg:grid-rows-[minmax(0,1fr)]">
      <div className="flex min-h-0 flex-col gap-5">
        <EnergySummaryPanel className="lg:flex-1" />
        <AgentDialog className="h-[560px] lg:h-auto lg:flex-1" />
      </div>
      <div className="hidden lg:block" aria-hidden="true" />
      <div className="flex min-h-0 flex-col gap-5">
        <ArchitecturePanel className="lg:flex-1" />
        <AutonomousSavingPanel className="lg:flex-1" />
      </div>
    </div>
  )
}

export default function App() {
  const route = useRoute()
  const { w, h, scale, big } = useViewport()
  // From 1024 px wide: a box of the screen size divided by the scale, scaled back up to fill the screen.
  const box = big
    ? ({ position: 'fixed', inset: 0, overflow: 'auto' } as const)
    : undefined
  // The page itself is never smaller than the reference size (in its own units), so a small window scrolls.
  const pageW = Math.max(w / scale, REF_W)
  const pageH = Math.max(h / scale, REF_H)
  const page = big ? ({ width: pageW, height: pageH, transform: `scale(${scale})`, transformOrigin: '0 0' } as const) : undefined
  // The scrollable area is the size the scaled page really has (a transform does not change the layout size).
  const sizer = big ? ({ width: pageW * scale, height: pageH * scale, overflow: 'hidden' } as const) : undefined
  return (
    <LangProvider>
      <div style={box}>
      <div style={sizer}>
      <div style={page}>
      <div className={`relative mx-auto flex flex-col px-3 pb-1 sm:px-5 ${big ? 'h-full overflow-hidden' : 'min-h-dvh'}`}>
        <CityMapBackground />
        <TopHeader />
        <main className="min-h-0 flex-1">
          {route === 'dashboard' && <Dashboard />}
          {route === 'data' && <TestDataPage />}
          {route === 'design' && (
            <div className="lg:h-full lg:overflow-y-auto">
              <DesignPage />
            </div>
          )}
        </main>
        <FooterMenu route={route} />
      </div>
      </div>
      </div>
      </div>
    </LangProvider>
  )
}
