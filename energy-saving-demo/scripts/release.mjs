// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

// Build the offline package for a customer machine (Linux, no internet, no Docker, nothing installed on it).
//   npm run release            ->  release/energy-saving-agent-<version>.tar.gz
// Run it on a machine with internet (Windows is fine): it builds both apps, puts the production packages of the server
// (pure JavaScript, no native modules) and the Node.js runtime for Linux inside the package. Nothing is downloaded or
// installed on the customer machine: unpack, ./start.sh. NODE_ARCH=arm64 builds it for an ARM machine
// (default x64); NODE_MAJOR sets the Node.js version line (default 22, the newest long-term release of it).
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const version = JSON.parse(readFileSync(join(root, 'server', 'package.json'), 'utf8')).version
const name = `energy-saving-agent-${version}`
const out = join(root, 'release')
const stage = join(out, name)
// The commands are built by this build script from fixed words and the version in server/package.json: nothing comes from outside.
const run = (cmd, cwd = root) => {
  console.log(`> ${cmd}`)
  // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
  execSync(cmd, { cwd, stdio: 'inherit' })
}

console.log(`== building ${name}`)
// Old build output (files of renamed or deleted code) must not reach the package.
for (const d of ['server/dist', 'server/public']) rmSync(join(root, d), { recursive: true, force: true })
run('npm run build')

rmSync(stage, { recursive: true, force: true })
mkdirSync(stage, { recursive: true })
const copy = (from, to = from) => cpSync(join(root, from), join(stage, to), { recursive: true })
// server/vendor holds the SheetJS package (0.20.3) that server/package.json refers to; it is needed by npm ci below only.
for (const p of ['server/dist', 'server/public', 'server/vendor', 'server/package.json', 'server/package-lock.json']) copy(p)
copy('sample/price_data.xlsx')
copy('config/app.env.example')
copy('config/llm.config.json')
copy('README.md')
// The Chinese README is README.zh-CN.md in the development repository and README_zh.md (the OpenAN name) in the release one.
for (const f of ['README_zh.md', 'README.zh-CN.md']) if (existsSync(join(root, f))) copy(f)
copy('bin')
// The shell scripts must keep Unix line ends, even when this runs on Windows. In the package they start the Node.js
// runtime that comes with it (runtime/node), not whatever the machine has.
for (const f of ['start.sh']) {
  const text = readFileSync(join(root, f), 'utf8').replace(/\r\n/g, '\n')
  if (!text.includes('exec node ')) throw new Error(`${f} does not start node as expected`)
  writeFileSync(join(stage, f), text.replace('exec node ', 'exec "$(dirname "$0")/runtime/node" '), { mode: 0o755 })
}

// The Node.js runtime for Linux, from nodejs.org, checked against the published SHA-256 sum. Only the program and its
// licence go in (about 40 MB); the download is kept in release/cache for the next build.
const arch = process.env.NODE_ARCH ?? 'x64'
const major = process.env.NODE_MAJOR ?? '22'
console.log(`== Node.js ${major} runtime for linux-${arch}`)
const index = await (await fetch('https://nodejs.org/dist/index.json')).json()
const nodeVersion = index.find((x) => x.version.startsWith(`v${major}.`) && x.lts)?.version
if (!nodeVersion) throw new Error(`no long-term Node.js ${major} release found`)
const nodeFile = `node-${nodeVersion}-linux-${arch}.tar.gz`
const cache = join(out, 'cache')
mkdirSync(cache, { recursive: true })
const archive = join(cache, nodeFile)
if (!existsSync(archive)) {
  console.log(`downloading ${nodeFile}`)
  const res = await fetch(`https://nodejs.org/dist/${nodeVersion}/${nodeFile}`)
  if (!res.ok) throw new Error(`download failed: ${res.status}`)
  writeFileSync(archive, Buffer.from(await res.arrayBuffer()))
}
const sums = await (await fetch(`https://nodejs.org/dist/${nodeVersion}/SHASUMS256.txt`)).text()
const want = sums.split('\n').find((l) => l.endsWith(` ${nodeFile}`))?.split(/\s+/)[0]
const got = createHash('sha256').update(readFileSync(archive)).digest('hex')
if (!want || want !== got) {
  rmSync(archive, { force: true })
  throw new Error(`the checksum of ${nodeFile} does not match the published one`)
}
mkdirSync(join(stage, 'runtime'), { recursive: true })
const folder = nodeFile.replace('.tar.gz', '')
run(`tar -xzf "${nodeFile}" --strip-components=2 -C "../${name}/runtime" ${folder}/bin/node`, cache)
run(`tar -xzf "${nodeFile}" -O ${folder}/LICENSE > "../${name}/runtime/LICENSE-node.txt"`, cache)
chmodSync(join(stage, 'runtime', 'node'), 0o755)
console.log(`Node.js ${nodeVersion} (${arch}) checked: ${got.slice(0, 16)}…`)

console.log('== production packages of the server')
run('npm ci --omit=dev --no-audit --no-fund', join(stage, 'server'))
rmSync(join(stage, 'server', 'vendor'), { recursive: true, force: true })

// The one database file, with all tables and the defaults but no prices, is in the package before the first start.
run('node bin/ctl.mjs init --empty', stage)
for (const f of readdirSync(join(stage, 'data'))) if (f !== 'energy.db') rmSync(join(stage, 'data', f))
// init writes a record with the path of the build machine into logs/server.log: the package starts with an empty logs folder.
for (const f of readdirSync(join(stage, 'logs'))) rmSync(join(stage, 'logs', f), { recursive: true, force: true })

// Nothing may be fetched from the internet when the pages open (fonts, styles, images): the customer network has no
// internet. Names that are only text (xmlns, license comments, example addresses in strings) are not loads.
const external = []
const scan = (d) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e)
    if (statSync(p).isDirectory()) scan(p)
    else if (/\.(html|css)$/.test(e)) {
      const text = readFileSync(p, 'utf8')
      for (const m of text.matchAll(/(?:src|href)=["']https?:\/\/[^"']+|url\(\s*["']?https?:\/\/[^)]+|@import[^;]*https?:\/\/[^;]+/g)) external.push(`${p}: ${m[0]}`)
    }
  }
}
scan(join(stage, 'server', 'public'))
if (external.length) {
  console.error('The pages load something from the internet; bundle it instead:\n' + external.join('\n'))
  process.exit(1)
}

// A native module (.node) is built for one OS: it would not load on the Linux machine.
const native = []
const walk = (d) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e)
    if (statSync(p).isDirectory()) walk(p)
    else if (p.endsWith('.node')) native.push(p)
  }
}
walk(join(stage, 'server', 'node_modules'))
if (native.length) {
  console.error('Native modules found; they would not load on another OS:\n' + native.join('\n'))
  process.exit(1)
}

console.log('== packing')
const tarball = join(out, `${name}.tar.gz`)
rmSync(tarball, { force: true })
// Windows files carry no executable flag: the runtime and start.sh get it explicitly, so nobody has to run chmod.
const exe = ['runtime/node', 'start.sh'].map((f) => `${name}/${f}`)
rmSync(join(out, `${name}.tar`), { force: true })
// No user or group name of the build machine in the archive.
const owner = '--owner=0 --group=0 --numeric-owner'
run(`tar -cf "${name}.tar" ${owner} ${exe.map((f) => `--exclude="${f}"`).join(' ')} "${name}"`, out)
run(`tar -rf "${name}.tar" ${owner} --mode=0755 ${exe.map((f) => `"${f}"`).join(' ')}`, out)
run(`gzip -f "${name}.tar"`, out)
if (!existsSync(tarball)) throw new Error('the archive was not made')
console.log(`\nDone: ${tarball} (${(statSync(tarball).size / 1e6).toFixed(1)} MB)`)
console.log('On the customer machine: tar -xzf the file, cd into the folder, ./start.sh KEY=value ..., ./start.sh')
