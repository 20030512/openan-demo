// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { fill, LangProvider, T, useTr, type Lang } from '../src/lib/i18n'

const render = (lang: Lang, node: React.ReactNode) => renderToStaticMarkup(<LangProvider initial={lang}>{node}</LangProvider>)

function Plain({ s }: { s: string }) {
  return <>{useTr()(s)}</>
}

describe('language choice', () => {
  it('en shows English only', () => {
    const html = render('en', <T>Dashboard</T>)
    expect(html).toContain('Dashboard')
    expect(html).not.toContain('总览')
  })
  it('zh shows Chinese only', () => {
    const html = render('zh', <T>Dashboard</T>)
    expect(html).toContain('总览')
    expect(html).not.toContain('Dashboard')
    expect(html).toContain('lang="zh-CN"')
  })
  it('a text with no Chinese entry stays English in both languages', () => {
    for (const lang of ['en', 'zh'] as const) {
      expect(render(lang, <T>Some text nobody translated</T>)).toContain('Some text nobody translated')
    }
  })
  it('fills placeholders in both languages', () => {
    expect(render('en', <T s="{region} region" v={{ region: 'REGION-A' }} />)).toContain('REGION-A region')
    expect(render('zh', <T s="{region} region" v={{ region: 'REGION-A' }} />)).toContain('REGION-A')
  })
  it('leaves an unknown placeholder alone', () => {
    expect(fill('Hello {name} and {other}', { name: 'A' })).toBe('Hello A and {other}')
    expect(fill('no placeholders')).toBe('no placeholders')
  })
  it('useTr gives a plain string for places that cannot hold markup, such as chart axes', () => {
    expect(render('en', <Plain s="Price (CNY)" />)).toBe('Price (CNY)')
    expect(render('zh', <Plain s="Price (CNY)" />)).toBe('电价（元）')
  })
})
