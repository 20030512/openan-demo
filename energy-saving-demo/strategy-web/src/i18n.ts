// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * English and Chinese for the Save Strategy page. English stays in the source; ZH holds the Chinese for each text. The
 * choice is the one of the dashboard (same browser key "lang", set from the avatar menu of either page); with no choice
 * made yet the page is Chinese. A change reloads the page, so every text is read once per load.
 * A text with no Chinese entry stays English.
 */
export type Lang = 'en' | 'zh';
const KEY = 'lang';

export function getLang(): Lang {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'zh' || v === 'en') return v;
  } catch {
    /* storage blocked: fall through */
  }
  return 'zh'; // Chinese unless English was chosen
}

export function setLang(l: Lang): void {
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* the choice then lasts only until the reload */
  }
  location.reload();
}

export const lang = getLang();

const ZH: Record<string, string> = {
  // top bar
  'Connecting…': '连接中…',
  'System online': '系统在线',
  'Backend offline': '后端离线',
  'Energy-Saving UC': '节电UC',
  Sunday: '星期日',
  Monday: '星期一',
  Tuesday: '星期二',
  Wednesday: '星期三',
  Thursday: '星期四',
  Friday: '星期五',
  Saturday: '星期六',
  Sun: '周日',
  Mon: '周一',
  Tue: '周二',
  Wed: '周三',
  Thu: '周四',
  Fri: '周五',
  Sat: '周六',
  // avatar menu
  'Dashboard, task dispatch, test data': '大屏、任务下发、测试数据',
  'Save Strategy': '节电策略',
  'Charge/discharge plan, Deployment export': '充放电计划、Deployment 导出',
  Apps: '应用',
  Language: '语言',
  'Hide avatar button': '隐藏头像按钮',
  'Avatar button hidden.': '头像按钮已隐藏。',
  'shows it again.': '可再次显示。',
  Menu: '菜单',
  // page
  'Li-ion battery charge/discharge slot plan': '锂电池充放电时段计划',
  'Turn tiered electricity prices into a battery charge/discharge plan and export it to Deployment.': '将分档电价转换为电池充放电计划，并导出到 Deployment。',
  'Export to Deployment': '导出到 Deployment',
  Summary: '汇总',
  'Price batch': '电价批次',
  'No prices imported yet': '尚未导入电价',
  'Days planned': '已规划天数',
  '{n} day(s) single tier — no shifting': '{n} 天只有单一电价档，不错峰',
  'Every day has a plan': '每天都有计划',
  'Valley · peak price': '谷价 · 峰价',
  'CNY/kWh, latest batch': '元/千瓦时，最新批次',
  'Peak–valley spread': '峰谷价差',
  'CNY per kWh shifted': '每转移 1 千瓦时的价差（元）',
  'Battery schedule': '电池时间安排',
  'charge · discharge per day': '每天充电 · 放电',
  'Network elements': '网元',
  '{fixed} fixed · {dynamic} dynamic': '{fixed} 个固定 · {dynamic} 个动态',
  'None added yet': '尚未添加',
  'Daily plan': '每日计划',
  'Price curve with the charge and discharge windows the strategy chose.': '电价曲线，以及策略选定的充电和放电时段。',
  Regenerate: '重新生成',
  'No price data yet': '还没有电价数据',
  'Download the sample price file, adjust the prices and import it on the right — the plan appears here.': '下载示例电价文件，修改电价后在右侧导入，计划会显示在这里。',
  'Download sample price file': '下载示例电价文件',
  Days: '日期',
  'Single price tier — no charging or discharging': '单一电价档：不充电也不放电',
  today: '今天',
  'Single price tier on {day}: no charging or discharging for this day.': '{day} 只有单一电价档：当天不充电也不放电。',
  'Price slots of {day} ({n})': '{day} 的电价时段（{n}）',
  Charge: '充电',
  Discharge: '放电',
  Idle: '空闲',
  'Daily charge and discharge time.': '每天的充电和放电时长。',
  'Charge (standby)': '充电（备电）',
  min: '分钟',
  'Saving…': '保存中…',
  'Save schedule': '保存时间安排',
  'Price data': '电价数据',
  'Slot length, then import the price file.': '先选时段长度，再导入电价文件。',
  'Price slot length': '电价时段长度',
  '15 min': '15 分钟',
  '30 min': '30 分钟',
  '60 min': '60 分钟',
  '{n} price rows per day': '每天 {n} 行电价',
  'Choose a slot length': '请选择时段长度',
  'Drop the price file here': '把电价文件拖到这里',
  ' or click to choose': ' 或点击选择',
  'Sample in the import format, at the slot length above': '导入格式的示例文件，使用上面选择的时段长度',
  'Sample file': '示例文件',
  'Importing…': '导入中…',
  'Import & generate': '导入并生成',
  'Written to the 网元列表 sheet of the export.': '写入导出文件的“网元列表”工作表。',
  'NE name, e.g. ZZ-Site-001': '网元名称，例如 ZZ-Site-001',
  'Save strategy mode': '节电策略模式',
  Fixed: '固定',
  Dynamic: '动态',
  'Stop discharging below': '电量低于此值停止放电',
  'Keep backup for': '备电保持时长',
  'Add network element': '添加网元',
  'No network elements yet.': '还没有网元。',
  'stop < {n}%': '低于 {n}% 停止',
  'backup {n} min': '备电 {n} 分钟',
  Delete: '删除',
  Keep: '保留',
  'Delete {name}': '删除 {name}',
  'Writes the latest strategy batch and the network elements into an Excel workbook.': '把最新一批策略和网元写入 Excel 工作簿。',
  'By weekday': '按星期',
  '错峰调整按天配置 · one sheet per weekday (7 sheets)': '错峰调整按天配置 · 每个星期一个工作表（共 7 个）',
  'Fill the empty sheets with the plan of': '用以下日期的计划填充空工作表',
  '— leave them empty —': '— 保持为空 —',
  Cancel: '取消',
  'Preparing…': '准备中…',
  'Download Excel': '下载 Excel',
  Dismiss: '关闭',
  // messages
  'Could not load the data from the backend ({msg}). Is the server running? Reload the page.': '无法从后端加载数据（{msg}）。服务器是否在运行？请刷新页面。',
  'Schedule saved — regenerate the strategy to apply it.': '时间安排已保存——请重新生成策略使其生效。',
  'Schedule saved.': '时间安排已保存。',
  'Price slots set to {label} ({rows} rows per day). The sample file follows this setting.': '电价时段已设为 {label}（每天 {rows} 行）。示例文件会按此设置生成。',
  '{message} — {count} price rows, batch {batch}.': '{message}——{count} 行电价，批次 {batch}。',
  'Import succeeded, strategy auto-generated': '导入成功，已自动生成策略',
  'Strategy regenerated from batch {batch}.': '已根据批次 {batch} 重新生成策略。',
  ' No charging or discharging on {dates}.': ' {dates} 不充电也不放电。',
  'Network element {name} added.': '网元 {name} 已添加。',
  'Network element {name} deleted.': '网元 {name} 已删除。',
  'Downloaded {file} — {n} sheet(s) filled.': '已下载 {file}——填充了 {n} 个工作表。',
  ' Empty sheets: {list}.': ' 空工作表：{list}。',
  // chart
  'No price data for this day': '当天没有电价数据',
  'Price (CNY/kWh)': '电价（元/千瓦时）',
  'Charge · LOW': '充电 · LOW',
  'Discharge · PEAK': '放电 · PEAK',
  'Idle · FLAT': '空闲 · FLAT',
  '{price} CNY/kWh': '{price} 元/千瓦时',
};

const fill = (s: string, v?: Record<string, string | number>) => (v ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in v ? String(v[k]) : m)) : s);

/** The text in the current language; {name} placeholders are filled from `v`. */
export const tr = (s: string, v?: Record<string, string | number>): string => fill(lang === 'zh' ? (ZH[s] ?? s) : s, v);

/** A message of the server (English): translated when it is one of the known texts. */
export const trMsg = (s: string): string => s.split('; ').map((x) => tr(x)).join('; ');
