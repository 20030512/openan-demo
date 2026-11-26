// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from 'react'
import { BookOpen, Check, EyeOff, Zap, FlaskConical, LayoutDashboard, UserRound, type LucideIcon } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { T, t, useLang, type Lang } from '@/lib/i18n'
import type { Route } from './top-header'

const PAGES: { route: Route; href: string; label: string; icon: LucideIcon }[] = [
  { route: 'dashboard', href: '#/', label: t('Dashboard'), icon: LayoutDashboard },
  { route: 'data', href: '#/data', label: t('Test data'), icon: FlaskConical },
  { route: 'design', href: '#/design', label: t('Design'), icon: BookOpen },
]

/**
 * The two apps of the server, each under its own path; the avatar menu of both lists them, and a click is a full page load.
 */
const APPS = [
  { href: '/dashboard/', label: t('Energy-Saving UC'), hint: t('Dashboard, task dispatch, test data'), current: true },
  { href: '/strategy/', label: t('Save Strategy'), hint: t('Charge/discharge plan, Deployment export'), current: false },
]

const KEY = 'avatar-hidden'
/** Alt+M hides and shows the avatar button (M for menu). */
export const SHORTCUT = 'Alt+M'

function usePersistedHidden() {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(KEY) === '1'
    } catch {
      return false
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(KEY, hidden ? '1' : '0')
    } catch {
      /* storage can be blocked; the choice then only lasts for this visit */
    }
  }, [hidden])
  return [hidden, setHidden] as const
}

/**
 * Footer, centred under the title: one round avatar button. It opens a menu upward with the other pages
 * (test data, design) and the language choice (English or Chinese).
 */
export function FooterMenu({ route }: { route: Route }) {
  const { lang, setLang } = useLang()
  const [hidden, setHidden] = usePersistedHidden()
  const [notice, setNotice] = useState(false)

  // Alt+M hides and shows the button from anywhere, also while typing (Alt+letter types nothing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === 'KeyM' && !e.isComposing) {
        e.preventDefault()
        setHidden((h) => !h)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setHidden])

  // After hiding, say once how to bring it back; the message goes away by itself.
  useEffect(() => {
    if (!hidden) return setNotice(false)
    setNotice(true)
    const timer = setTimeout(() => setNotice(false), 4000)
    return () => clearTimeout(timer)
  }, [hidden])

  if (hidden) {
    return (
      <footer className="flex h-5 shrink-0 items-center justify-center" role="status" aria-live="polite">
        {notice && (
          <span className="rounded-full bg-black/60 px-3 py-0.5 text-[11px] text-cyan-100/80">
            <T>Avatar button hidden.</T> <kbd className="font-mono">{SHORTCUT}</kbd> <T>shows it again.</T>
          </span>
        )}
      </footer>
    )
  }
  return (
    <footer className="flex shrink-0 justify-center pt-1">
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Menu"
          className="grid size-11 place-items-center rounded-full border border-cyan-300/50 bg-gradient-to-b from-[#1f5fd6] to-[#0b2a6b] text-cyan-50 shadow-[0_0_18px_rgba(60,150,255,.55)] outline-none transition hover:shadow-[0_0_26px_rgba(90,180,255,.8)] focus-visible:ring-2 focus-visible:ring-primary data-[state=open]:ring-2 data-[state=open]:ring-cyan-200"
        >
          <UserRound className="size-5" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="center">
          <DropdownMenuLabel><T>Pages</T></DropdownMenuLabel>
          {PAGES.map(({ route: r, href, label, icon: Icon }) => (
            <DropdownMenuItem key={r} asChild current={route === r}>
              <a href={href} className="flex w-full items-center gap-2.5" aria-current={route === r ? 'page' : undefined}>
                <Icon className="size-4 text-cyan-200" aria-hidden="true" />
                <T>{label}</T>
                {route === r && <Check className="ml-auto size-4" aria-hidden="true" />}
              </a>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuLabel><T>Apps</T></DropdownMenuLabel>
          {APPS.map((a) => (
            <DropdownMenuItem key={a.href} asChild current={a.current}>
              <a href={a.href} className="flex w-full items-center gap-2.5" aria-current={a.current ? 'page' : undefined}>
                <Zap className="size-4 text-cyan-200" aria-hidden="true" />
                <span className="flex flex-col leading-tight">
                  <T>{a.label}</T>
                  <small className="text-[11px] font-normal text-muted-foreground"><T>{a.hint}</T></small>
                </span>
                {a.current && <Check className="ml-auto size-4" aria-hidden="true" />}
              </a>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setHidden(true)}>
            <span className="flex w-full items-center gap-2.5">
              <EyeOff className="size-4 text-cyan-200" aria-hidden="true" />
              <T>Hide avatar button</T>
              <kbd className="ml-auto font-mono text-[11px] text-muted-foreground">{SHORTCUT}</kbd>
            </span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel><T>Language</T></DropdownMenuLabel>
          <DropdownMenuRadioGroup value={lang} onValueChange={(v) => setLang(v as Lang)}>
            <DropdownMenuRadioItem value="en">English</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="zh" lang="zh-CN">中文</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </footer>
  )
}
