// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ZH } from '@/lib/zh'
import { cn } from '@/lib/utils'

/**
 * English stays in the source and ZH holds the Chinese for each text. The page shows one language at a time,
 * chosen from the menu: English or Chinese. A text with no Chinese entry stays English.
 * web/test/i18n.test.ts lists any text that is missing from ZH.
 */
export type Lang = 'en' | 'zh'
export const LANGS: Lang[] = ['en', 'zh']

interface Ctx {
  lang: Lang
  setLang: (l: Lang) => void
}
const LangContext = createContext<Ctx>({ lang: 'zh', setLang: () => {} })

const KEY = 'lang'
const read = (): Lang => {
  try {
    return localStorage.getItem(KEY) === 'en' ? 'en' : 'zh' // Chinese unless English was chosen
  } catch {
    return 'zh'
  }
}

export function LangProvider({ children, initial }: { children: ReactNode; initial?: Lang }) {
  const [lang, setLang] = useState<Lang>(initial ?? read)
  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
    document.title = lang === 'zh' ? ZH['Energy-Saving UC'] : 'Energy-Saving UC'
    try {
      localStorage.setItem(KEY, lang)
    } catch {
      /* storage can be blocked; the choice then only lasts for this visit */
    }
  }, [lang])
  const value = useMemo(() => ({ lang, setLang }), [lang])
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>
}

export const useLang = () => useContext(LangContext)

/** Marks a string constant as translatable so the coverage test finds it. Returns the string unchanged. */
export const t = (s: string) => s

export const fill = (s: string, v?: Record<string, string | number>) =>
  v ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in v ? String(v[k]) : m)) : s

/** The text in the current language, for places that need a plain string (chart axes, labels). */
export function useTr() {
  const { lang } = useLang()
  return (s: string, v?: Record<string, string | number>) => fill(lang === 'zh' ? (ZH[s] ?? s) : s, v)
}

interface TProps {
  /** English text. */
  children?: string
  /** Same, for texts with {placeholders}; filled from `v` in both languages. */
  s?: string
  v?: Record<string, string | number>
  className?: string
}

export function T({ children, s, v, className }: TProps) {
  const tr = useTr()
  const { lang } = useLang()
  const en = (s ?? children ?? '') as string
  return (
    <span lang={lang === 'zh' ? 'zh-CN' : undefined} className={cn(className)}>
      {tr(en, v)}
    </span>
  )
}
