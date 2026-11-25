// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from 'react';
import StrategyConfigPage from './pages/StrategyConfigPage';
import AppSwitcher from './components/AppSwitcher';
import { API } from './services/base';
import { tr } from './i18n';

// Save-strategy console, styled as a panel of the Energy-Saving Agent big screen.
// The energy-saving assistant page lives in ../../energy-saving-assistant (moved out of this app).

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pad = (n: number) => String(n).padStart(2, '0');

function formatClock(d: Date): string {
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  return `${date} ${time} ${tr(WEEKDAYS[d.getDay()])}`;
}

export default function App(): JSX.Element {
  const [backendUp, setBackendUp] = useState<boolean | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let alive = true;
    const check = () =>
      fetch(`${API}/health`)
        .then((r) => alive && setBackendUp(r.ok))
        .catch(() => alive && setBackendUp(false));
    check();
    const t = setInterval(check, 15000);
    const clock = setInterval(() => setNow(new Date()), 1000);
    return () => {
      alive = false;
      clearInterval(t);
      clearInterval(clock);
    };
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <div className={`system-pill ${backendUp === null ? '' : backendUp ? 'up' : 'down'}`}>
            <span className="pulse" aria-hidden="true" />
            {backendUp === null ? tr('Connecting…') : backendUp ? tr('System online') : tr('Backend offline')}
          </div>
          <h1 className="screen-title">{tr('Energy-Saving UC')}</h1>
          <time className="clock" dateTime={now.toISOString()}>{formatClock(now)}</time>
        </div>
      </header>
      <StrategyConfigPage />
      <AppSwitcher />
    </div>
  );
}
