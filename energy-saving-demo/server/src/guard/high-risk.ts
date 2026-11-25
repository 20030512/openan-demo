// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Input guard against the customer's high-risk and sensitive commands (附件2：梳理常见设备系统的高危及敏感操作指令) and
 * against injection through text: a sentence for the dialog (it goes to the LLM and, as parameters, to the Network Agent),
 * a name, a setting, or a cell of an uploaded Excel/CSV file. Text that holds such a command, a shell construct or an
 * Excel formula is refused as a whole; it is never passed on, cleaned or run.
 *
 * Common words that are also commands (cat, more, find, copy, enable ...) count only where they stand as a command: at the
 * start of the text or after a shell separator, followed by an option, a path or a file name. So "query more prices" passes
 * and "cat /etc/hosts" does not.
 */

/** [what it is, pattern]. Case is ignored. */
const ALWAYS: [string, RegExp][] = [
  // system: shutdown and restart, wiping disks, rights
  ['shutdown or restart', /\b(shutdown|halt|poweroff|reboot)\b|\binit\s+[06]\b/i],
  ['deleting files', /\brm\s+(-[a-z]*\s*)*[-/~.*]|\brm\s+-[a-z]+/i],
  ['wiping a disk', /\bdd\s+if=|\bmkfs(\.\w+)?\b|>\s*\/dev\/(sd|hd|vd|nvme|null|zero)/i],
  ['changing rights', /\b(chmod|chown|chgrp|umask|setfacl)\b/i],
  ['switching to an admin account', /\bsudo\b|\bsu(\s+-|\s+root\b|\s*$)|\bsu\s+-\s*\w*|\bsudo\s+-i\b/i],
  // copying, downloading, remote access
  ['copying or downloading files', /\b(wget|scp|rsync|rcp|sftp|lftp|sz|rz)\b|\bcurl\s+(-\w|https?:)/i],
  ['remote login', /\b(ssh|telnet|ftp)\s+[\w@.-]+/i],
  // accounts, firewall, routes
  ['system files', /\/etc\/(passwd|shadow|sudoers|group|pam\.d)|\/var\/(log|adm)\b|\.bash_history|\b(utmp|wtmp|btmp|lastlog|auth\.log)\b/i],
  ['users and groups', /\b(useradd|adduser|userdel|deluser|usermod|groupadd|groupdel|groupmod|mkuser|rmuser|chuser|chsec|chage|passwd|mkgroup|rmgroup|chgroup)\b/i],
  ['firewall or routes', /\b(iptables|ip6tables|firewall-cmd|nft|ufw)\b|\broute\s+(add|del)\b|\bip\s+route\s+\S/i],
  // logs and history
  ['switching off logs or history', /\bhistory\s+-[cd]\b|\bHISTSIZE\s*=|\bset\s+\+o\s+history\b|\b(syslog|rsyslog|journald)\b.*\bstop\b|\butmpdump\b|\bfwtmp\b/i],
  ['stopping a service', /\b(systemctl|service)\s+\S*\s*(stop|disable|restart|mask|kill)\b|\b(systemctl|service)\s+(stop|disable|restart|mask|kill)\b/i],
  // databases
  ['database tools', /\b(mysqldump|mysqladmin|pg_dump|pg_dumpall|pg_restore|pg_ctl|sqlcmd|mongoimport|mongoexport|mongodump|db2move|expdp|impdp|lsnrctl|gs_ctl|gs_dump|sqlite3)\b|\b(mysql|psql|gsql|kdb|chinadb|sqlplus)\s+-/i],
  ['database statements', /\b(drop|truncate|alter)\s+(table|database|schema|index|user|view)\b|\bdelete\s+from\b|\binsert\s+into\b|\bupdate\s+\w+\s+set\b|\bgrant\s+\w+(\s*,\s*\w+)*\s+(on|to)\b|\bcreate\s+(table|user|database|schema)\b|\bselect\s+(\*|[\w.,\s()]+\s+from\s+\w+\s*(where\b|;|$))|\bshutdown\s+immediate\b|\bunion\s+select\b/i],
  // clusters
  ['cluster commands', /\bhdfs\s+dfs\b|\bhadoop\s+fs\b|\b(stop-dfs|stop-yarn|stop-all|start-dfs)\.sh\b|\bdfsadmin\b|\bcluster-(add|remove|stop)\b/i],
  // network devices
  ['network device configuration', /\bwrite\s+erase\b|\berase\s+startup-config\b|\bconfigure\s+terminal\b|\bconf\s+t\b|\bsystem-view\b|\bclear\s+ip\s+route\b|\bno\s+hardware\b|\bcopy\s+tftp:|\bstart\s+shell\b|\bprivilege\s+level\b|\bset\s+system\s+login\b|\bvlan\s+database\b|\bswitchport\s+mode\b|\bip\s+name-server\b|\baccess-list\b|\bsys_troubleshooter\b|\blocal-user\s+\S+\s+privilege\b|\busername\s+\S+\s+(password|privilege|secret)\b/i],
  // network-device commands that are also English words: only as a command line of their own
  ['network device commands', /^\s*(enable(\s+(secret|password|\d+)\b.*)?|reload(\s+(in|at|cancel|\d+)\b.*)?|logging(\s+(\d{1,3}(\.\d{1,3}){3}|host|buffered|console|trap|monitor|on|off)\b.*)?)\s*$/i],
  // shell constructs: running something inside text
  ['a shell construct', /`|\$\(|\$\{|\|\s*(sh|bash|zsh|ksh|python\d?|perl|node)\b|&&|\|\||;\s*(sh|bash)\b|<\(|>\s*\/|\bexec\s*\(|\beval\s*\(/i],
  // Excel/CSV formula injection (DDE): =cmd|' /c ...'!A1, =HYPERLINK(...), =WEBSERVICE(...)
  ['an Excel command', /\bcmd\s*\||\|\s*'?\s*\/c\b|\bmsexcel\s*\||\b(DDE|DDEAUTO|HYPERLINK|WEBSERVICE|IMPORTXML|IMPORTDATA)\s*\(/i],
]

/** Commands with no other meaning: in command position (start of the text, or after ; & | or a newline) with any argument. */
const COMMAND_WORDS = /(^|[;&|\n\r])\s*(grep|egrep|fgrep|zgrep|zcat|awk|gawk|touch|mkdir|rmdir|mv|cp|vi|vim|nano|sed|alias|nohup|crontab|pkill|killall|rm|rcp|chattr|tee|xargs|base64|nc|ncat|socat)\s+\S/i
/** Words that are also English (cat, more, find, copy ...): a command only with an option, a path or a file name after them. */
const AS_COMMAND = /(^|[;&|\n\r])\s*(cat|less|more|cut|find|copy|tail|head|echo|source|configure|kill|bash|sh|type|del|move|xcopy|robocopy)\s+(-|\/|~|\.{1,2}[/\\]|\*|["']|[a-z]:\\|\\\\|[\w-]+\.[a-z]{1,5}\b|\S+\s*>)/i
const ECHO_TO_FILE = /\becho\b[^\n]*>\s*\S/i

/** A cell or text that a spreadsheet would run as a formula. A plain number such as -0.5 or +3 is not one. */
export function looksLikeFormula(text: string): boolean {
  const t = text.trimStart()
  if (!/^[=+\-@\t\r]/.test(text) && !/^[=+\-@]/.test(t)) return false
  return !/^[+-]?\d+(\.\d+)?%?$/.test(t)
}

/** What high-risk thing the text holds, or null. */
export function findHighRisk(text: string): string | null {
  for (const [what, re] of ALWAYS) if (re.test(text)) return what
  if (COMMAND_WORDS.test(text) || AS_COMMAND.test(text) || ECHO_TO_FILE.test(text)) return 'a shell command'
  return null
}

export class HighRiskInputError extends Error {}

/** Throws when the text holds a high-risk command or (formula=true) starts like a spreadsheet formula. */
export function assertSafeText(text: string, where: string, formula = true): void {
  const found = findHighRisk(text)
  if (found) throw new HighRiskInputError(`Refused: ${where} contains ${found}, which is not allowed.`)
  if (formula && looksLikeFormula(text)) throw new HighRiskInputError(`Refused: ${where} starts like a spreadsheet formula (= + - @), which is not allowed.`)
}

/** Every string inside a JSON body or query (keys too), with its path for the message. */
export function assertSafeValue(value: unknown, where = 'the input', depth = 0): void {
  if (depth > 20) throw new HighRiskInputError(`Refused: ${where} is nested too deeply.`)
  if (typeof value === 'string') return assertSafeText(value, where)
  if (Array.isArray(value)) return value.forEach((v, i) => assertSafeValue(v, `${where}[${i}]`, depth + 1))
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      assertSafeText(k, `${where} (a field name)`)
      assertSafeValue(v, `${where}.${k}`, depth + 1)
    }
  }
}

/** An uploaded workbook read with ExcelJS: no formula cells, no high-risk text in any cell of any sheet. */
export function assertSafeExcelJs(wb: { worksheets: { name: string; eachRow: (cb: (row: { eachCell: (cb: (cell: { address: string; formula?: unknown; text?: string; value: unknown }) => void) => void }) => void) => void }[] }): void {
  for (const ws of wb.worksheets) {
    ws.eachRow((row) =>
      row.eachCell((cell) => {
        const where = `cell ${ws.name}!${cell.address} of the file`
        if (cell.formula || (cell.value && typeof cell.value === 'object' && 'formula' in (cell.value as object))) {
          throw new HighRiskInputError(`Refused: ${where} holds a formula; upload values only.`)
        }
        if (typeof cell.value === 'string') assertSafeText(cell.value, where)
        else if (cell.text) assertSafeText(cell.text, where, false)
      }),
    )
  }
}

/** An uploaded workbook or CSV read with SheetJS: no formula cells, no high-risk text in any cell of any sheet. */
export function assertSafeSheetJs(wb: { SheetNames: string[]; Sheets: Record<string, Record<string, unknown>> }): void {
  for (const name of wb.SheetNames) {
    for (const [address, cell] of Object.entries(wb.Sheets[name] ?? {})) {
      if (address.startsWith('!') || !cell || typeof cell !== 'object') continue
      const c = cell as { f?: unknown; t?: string; v?: unknown }
      const where = `cell ${name}!${address} of the file`
      if (c.f) throw new HighRiskInputError(`Refused: ${where} holds a formula; upload values only.`)
      if (typeof c.v === 'string') assertSafeText(c.v, where)
    }
  }
}
