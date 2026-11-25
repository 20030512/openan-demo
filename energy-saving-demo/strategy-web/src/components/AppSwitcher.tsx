// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState } from 'react';
import { lang, setLang, tr } from '../i18n';

/*
 * The round avatar button at the bottom centre: the same one the Energy-Saving Agent has. It opens a menu upward with
 * the apps that share this domain, so the user moves between them with one click. Alt+M hides and shows the button;
 * the choice is kept in the browser under the same key in both apps (same domain), so it is the same in both.
 */

const KEY = 'avatar-hidden';
const SHORTCUT = 'Alt+M';

/** The apps on this domain. Each lives under its own path and has its own server and database. */
const APPS = [
  { href: '/dashboard/', label: 'Energy-Saving UC', hint: 'Dashboard, task dispatch, test data', current: false },
  { href: '/strategy/', label: 'Save Strategy', hint: 'Charge/discharge plan, Deployment export', current: true },
];

function readHidden(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export default function AppSwitcher(): JSX.Element | null {
  const [hidden, setHidden] = useState(readHidden);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, hidden ? '1' : '0');
    } catch {
      /* storage can be blocked; the choice then only lasts for this visit */
    }
    if (!hidden) return setNotice(false);
    setOpen(false);
    setNotice(true);
    const timer = setTimeout(() => setNotice(false), 4000);
    return () => clearTimeout(timer);
  }, [hidden]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === 'KeyM' && !e.isComposing) {
        e.preventDefault();
        setHidden((h) => !h);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, []);

  if (hidden) {
    return notice ? (
      <div className="appsw-note" role="status" aria-live="polite">
        {tr('Avatar button hidden.')} <kbd>{SHORTCUT}</kbd> {tr('shows it again.')}
      </div>
    ) : null;
  }

  return (
    <div className="appsw" ref={box}>
      {open && (
        <div className="appsw-menu" role="menu" aria-label={tr('Apps')}>
          <div className="appsw-label">{tr('Apps')}</div>
          {APPS.map((a) => (
            <a
              key={a.href}
              href={a.href}
              role="menuitem"
              className={`appsw-item${a.current ? ' current' : ''}`}
              aria-current={a.current ? 'page' : undefined}
            >
              <span>
                <b>{tr(a.label)}</b>
                <small>{tr(a.hint)}</small>
              </span>
              {a.current && <span aria-hidden="true">✓</span>}
            </a>
          ))}
          <div className="appsw-sep" />
          <div className="appsw-label">{tr('Language')}</div>
          {(['en', 'zh'] as const).map((l) => (
            <button key={l} type="button" role="menuitemradio" aria-checked={lang === l} className={`appsw-item${lang === l ? ' current' : ''}`} onClick={() => lang !== l && setLang(l)}>
              <span>
                <b>{l === 'en' ? 'English' : '中文'}</b>
              </span>
              {lang === l && <span aria-hidden="true">✓</span>}
            </button>
          ))}
          <div className="appsw-sep" />
          <button type="button" role="menuitem" className="appsw-item" onClick={() => setHidden(true)}>
            <span>
              <b>{tr('Hide avatar button')}</b>
            </span>
            <kbd>{SHORTCUT}</kbd>
          </button>
        </div>
      )}
      <button
        type="button"
        className="appsw-btn"
        aria-label={tr('Menu')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" />
        </svg>
      </button>
    </div>
  );
}
