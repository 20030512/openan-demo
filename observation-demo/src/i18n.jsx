// i18n.jsx — 中英文切换（占位键 + JSON 词典，便于非开发人员维护翻译）
// 文案单一来源：src/i18n/zh.json（中文基准）/ en.json（英译 + substitutions 标识替换表）。
// 调用方式：T('键')（组件规范用法）；设计层/补丁层等中文原文数据经 REV 反查桥自动定位键。
// 样式分离：默认中文（无类，即现有基线）；英文在 <html> 挂 lang-en 类，覆盖见 i18n.css。
import React, { useEffect, useState } from 'react';
import ZH from './i18n/zh.json';
import EN from './i18n/en.json';
import './i18n.css';

const LS_KEY = 'obs-lang';
const DICTS = { zh: ZH, en: EN };

// zh → key 反查桥（后注册者胜——mini 短译名在 zh.json 中前置，冲突时让位于 UI 主键）
const REV = {};
for (const [k, v] of Object.entries(ZH)) if (typeof v === 'string') REV[v] = k;

let lang = 'zh';
try {
  const v = typeof localStorage !== 'undefined' ? localStorage.getItem(LS_KEY) : null;
  if (v === 'en' || v === 'zh') lang = v;
} catch (e) { /* localStorage 不可用时默认 zh */ }

const applyDoc = () => {
  document.documentElement.classList.toggle('lang-en', lang === 'en');
  document.title = DICTS[lang]['doc.title'];
};
if (typeof document !== 'undefined') applyDoc();

const listeners = new Set();
export const getLang = () => lang;
export const isEn = () => lang === 'en';
export function setLang(l) {
  if ((l !== 'en' && l !== 'zh') || l === lang) return;
  lang = l;
  try { localStorage.setItem(LS_KEY, lang); } catch (e) { /* 忽略持久化失败 */ }
  applyDoc();
  listeners.forEach((fn) => fn(lang));
}

// 动态数字格式（条数 / 分秒时长 / 工时——数据为中文格式串，英文化为 items / m s / min）
const PATTERNS = [
  [/^(\d+)条$/, '$1 items'],
  [/^(\d+)分(\d+)秒$/, '$1m $2s'],
  [/^(.+)｜用时(\d+)分钟$/, '$1｜$2 min'],
];

// 业务标识替换（en.json substitutions：公司/区县/端口/网元/电路/人名——有序，长串在前）
function subEn(s) {
  let v = s;
  for (const [a, b] of EN.substitutions) v = v.split(a).join(b);
  return v;
}

export function T(s) {
  if (s == null || typeof s !== 'string') return s;
  if (lang === 'zh') return ZH[s] != null ? ZH[s] : s;
  let v = EN[s];
  if (v == null) {
    const key = REV[s];
    if (key != null) v = EN[key];
  }
  if (v == null) {
    v = s;
    for (let i = 0; i < PATTERNS.length; i++) {
      const m = s.match(PATTERNS[i][0]);
      if (m) { v = s.replace(PATTERNS[i][0], PATTERNS[i][1]); break; }
    }
  }
  return subEn(v);
}

export function useLang() {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((v) => v + 1);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
  return lang;
}

// 中/EN 切换按钮（画布坐标系内、月亮（白天/黑夜）图标左侧；随整页 rem 缩放）
export function LangToggle() {
  const l = useLang();
  const btn = (cur) => ({
    border: 'none',
    cursor: 'pointer',
    minWidth: '30px',
    height: '18px',
    padding: '0 7px',
    borderRadius: '9px',
    fontSize: '12px',
    lineHeight: '18px',
    fontFamily: "'HarmonyOS Sans SC','Microsoft YaHei',sans-serif",
    background: l === cur ? 'rgba(92,172,255,0.9)' : 'transparent',
    color: l === cur ? '#FFFFFF' : 'rgba(201,201,201,0.9)',
    fontWeight: l === cur ? '600' : '400',
  });
  return (
    <div style={{
      position: 'absolute', left: 1740, top: 13, zIndex: 9999,
      display: 'flex', userSelect: 'none',
      background: 'rgba(9,16,42,0.72)',
      border: '1px solid rgba(92,172,255,0.35)',
      borderRadius: '10px', padding: '1px',
      backdropFilter: 'blur(4px)',
    }}>
      <button style={btn('zh')} onClick={() => setLang('zh')}>中</button>
      <button style={btn('en')} onClick={() => setLang('en')}>EN</button>
    </div>
  );
}
