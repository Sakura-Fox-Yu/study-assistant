/**
 * 验证 main.js 的「外部源码目录解析」逻辑（不启动 GUI）。
 *
 * 做法：把 main.js 里与「目录解析」相关的纯函数源码抽出来，
 * 注入桩常量后在独立作用域里执行并断言。避免 vm + electron 桩的复杂度。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const SRC = path.join(__dirname, 'main.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  [OK] ' + name); }
  else { fail++; console.log('  [FAIL] ' + name + (extra ? '  -> ' + extra : '')); }
}

// ---- 从 main.js 抽取代码 ----
const full = fs.readFileSync(SRC, 'utf8');

function extractSection(startMarker, endMarker, label) {
  const s = full.indexOf(startMarker);
  if (s < 0) throw new Error('找不到起始标记: ' + label);
  const e = full.indexOf(endMarker, s);
  if (e < 0) throw new Error('找不到结束标记: ' + label);
  return full.slice(s, e + endMarker.length);
}

// 抽取：isValidSource 整个函数
function extractFunction(name) {
  const re = new RegExp('function\\s+' + name + '\\s*\\(');
  const m = re.exec(full);
  if (!m) throw new Error('找不到函数: ' + name);
  let i = full.indexOf('{', m.index);
  let depth = 0;
  for (let j = i; j < full.length; j++) {
    if (full[j] === '{') depth++;
    else if (full[j] === '}') { depth--; if (depth === 0) return full.slice(m.index, j + 1); }
  }
  throw new Error('函数未闭合: ' + name);
}

const srcIsValid = extractFunction('isValidSource');
const srcResolve = extractFunction('resolveSourceDir');

// DEFAULT_SOURCE 常量
const mDef = /const\s+DEFAULT_SOURCE\s*=\s*'((?:[^'\\]|\\.)*)'/.exec(full);
if (!mDef) throw new Error('找不到 DEFAULT_SOURCE');
const defaultSourceLiteral = "'" + mDef[1] + "'";

// ---- 在独立作用域里组装并执行 ----
const harness = `
const path = require('path');
const fs = require('fs');
const __DEFAULT_SOURCE = ${defaultSourceLiteral};
let __configured = __CFG__;
let __exeDir = __EXEDIR__;
let __dirname_ = __DIRNAME__;

function readConfiguredSource() { return __configured; }
function app_getPath(k) { return k === 'exe' ? path.join(__exeDir, 'app.exe') : ''; }

${srcIsValid}

const DEFAULT_SOURCE = __DEFAULT_SOURCE;

${srcResolve.replace(/app\.getPath\('exe'\)/g, "app_getPath('exe')").replace(/\b__dirname\b/g, '__dirname_')}

return ({ isValidSource, resolveSourceDir, DEFAULT_SOURCE });
`;

function build(cfg, exeDir, dirnameVal) {
  const code = harness
    .replace('__CFG__', JSON.stringify(cfg))
    .replace('__EXEDIR__', JSON.stringify(exeDir))
    .replace('__DIRNAME__', JSON.stringify(dirnameVal));
  const fn = new Function('require', code);
  return fn(require);   // 代码末尾 return 了 api 对象
}

// 变体：允许覆盖 DEFAULT_SOURCE 常量
function buildWithDefaultSource(defaultSrc, cfg, exeDir, dirnameVal) {
  const code = harness
    .replace('__CFG__', JSON.stringify(cfg))
    .replace('__EXEDIR__', JSON.stringify(exeDir))
    .replace('__DIRNAME__', JSON.stringify(dirnameVal))
    .replace('const __DEFAULT_SOURCE = ' + defaultSourceLiteral + ';',
             'const __DEFAULT_SOURCE = ' + JSON.stringify(defaultSrc) + ';');
  const fn = new Function('require', code);
  return fn(require);
}

const PROJECT = path.resolve(__dirname);
const FAKE_EXE_DIR = 'C:\\Users\\win\\AppData\\Local\\Programs\\zhuyin-focus';
const FAKE_ASAR = FAKE_EXE_DIR + '\\resources\\app.asar';

console.log('=== main.js 外部源码目录解析 测试 ===\n');
console.log('main.js       :', SRC);
console.log('项目实际路径  :', PROJECT);
console.log();

// --- 1. isValidSource 边界 ---
console.log('[1] isValidSource 边界检查');
{
  const api = build(null, FAKE_EXE_DIR, FAKE_ASAR);
  ok('有效目录（本项目）', api.isValidSource(PROJECT) === true);
  ok('不存在的目录', api.isValidSource('Z:\\nope\\nope') === false);
  ok('空字符串 -> false（关键：不能退化成 cwd）', api.isValidSource('') === false);
  ok('纯空白 -> false', api.isValidSource('   ') === false);
  ok('null -> false', api.isValidSource(null) === false);
  ok('undefined -> false', api.isValidSource(undefined) === false);
  ok('相对路径 . -> false', api.isValidSource('.') === false);
  ok('非字符串 123 -> false', api.isValidSource(123) === false);
}

// --- 2. resolveSourceDir 顺序 ---
console.log('\n[2] resolveSourceDir 解析顺序');
{
  // 打包后场景：无配置、__dirname 是 asar
  const api = build(null, FAKE_EXE_DIR, FAKE_ASAR);
  const r = api.resolveSourceDir();
  ok('打包后：命中 DEFAULT_SOURCE（本机开发目录）',
     r === path.resolve(api.DEFAULT_SOURCE), '实际=' + r);
  ok('绝不返回 app.asar 路径', !r || !r.includes('app.asar'));
}
{
  // 配置优先于 DEFAULT_SOURCE
  const api = build(PROJECT, FAKE_EXE_DIR, FAKE_ASAR);
  const r = api.resolveSourceDir();
  ok('配置目录优先命中', r === PROJECT, '实际=' + r);
}
{
  // 配置无效 -> 回退到 DEFAULT_SOURCE
  const api = build('Z:\\不存在的目录', FAKE_EXE_DIR, FAKE_ASAR);
  const r = api.resolveSourceDir();
  ok('配置无效时回退到 DEFAULT_SOURCE',
     r === path.resolve(api.DEFAULT_SOURCE), '实际=' + r);
}
{
  // 全部落空：把 DEFAULT_SOURCE 也替换成一个不存在的路径，
  // exe 旁无 source/，__dirname 是 asar -> 应返回 null（回退打包内）
  const api = buildWithDefaultSource('Z:\\完全不存在\\源码', null, 'Z:\\fake-exe-dir', FAKE_ASAR);
  const r = api.resolveSourceDir();
  ok('全部候选都落空 -> 返回 null（回退打包内）',
     r === null, '实际=' + r);
}
{
  // 开发模式：__dirname = 项目根（非 asar）
  const api = build(null, FAKE_EXE_DIR, PROJECT);
  const r = api.resolveSourceDir();
  ok('开发模式：__dirname 命中项目根', r === PROJECT, '实际=' + r);
}

console.log('\n=== 结果: ' + pass + ' 通过, ' + fail + ' 失败 ===');
process.exit(fail ? 1 : 0);
