// Драйвер дифференциальной проверки: один и тот же случай через разные реализации EVM.
// Нормализуем результат к единому виду: код/газ/возврат/ошибка.
import { spawnSync } from 'node:child_process';
// stdout/stderr дочернего процесса пишем в файлы, а не в пайп: evm.exe под пайпом без консоли зависал.
import fs from 'node:fs';
import path from 'node:path';

const root = import.meta.dirname;
const tmp = path.join(root, 'tmp');
const resDir = path.join(root, 'results');
fs.mkdirSync(tmp, { recursive: true });
fs.mkdirSync(resDir, { recursive: true });

const progressFile = path.join(root, 'harness-log.txt');
const progress = (s) => fs.appendFileSync(progressFile, s + '\n', 'utf8');
fs.writeFileSync(progressFile, 'старт драйвера\n', 'utf8');
process.on('uncaughtException', (e) => {
  progress('НЕОБРАБОТАННАЯ ОШИБКА: ' + (e && e.stack ? e.stack : String(e)));
  process.exit(1);
});
process.on('unhandledRejection', (e) => {
  progress('НЕОБРАБОТАННЫЙ ОТКАЗ: ' + (e && e.stack ? e.stack : String(e)));
  process.exit(1);
});

function findExe(dir, name) {
  if (!fs.existsSync(dir)) return null;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      const hit = findExe(p, name);
      if (hit) return hit;
    } else if (e.name.toLowerCase() === name) return p;
  }
  return null;
}

const exes = {
  geth: findExe(path.join(root, 'geth'), 'evm.exe'),
  revme: path.join(root, 'tools', 'bin', 'revme.exe'),
};

const cases = JSON.parse(fs.readFileSync(path.join(root, 'cases.json'), 'utf8')).cases;
progress('случаев загружено: ' + cases.length);
progress('бинарники: ' + JSON.stringify(exes));
const raw = [];
const results = [];

// --- разбор JSON-объектов из смешанного вывода (трасса + итоговые строки) ---
function jsonObjects(text) {
  const found = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith('{') && t.endsWith('}')) {
      try {
        found.push(JSON.parse(t));
      } catch {
        /* многострочный JSON разберём отдельно */
      }
    }
  }
  if (!found.length) {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        found.push(JSON.parse(m[0]));
      } catch {
        /* не вышло */
      }
    }
  }
  return found;
}

function hexToInt(v) {
  if (v === undefined || v === null || v === '') return null;
  try {
    return Number(BigInt(String(v)));
  } catch {
    return null;
  }
}

let execCounter = 0;

function exec(exe, args, tag) {
  if (!tag) tag = 'run-' + ++execCounter;
  const outFile = path.join(tmp, tag + '.out.txt');
  const errFile = path.join(tmp, tag + '.err.txt');
  const outFd = fs.openSync(outFile, 'w');
  const errFd = fs.openSync(errFile, 'w');
  try {
    const r = spawnSync(exe, args, { stdio: ['ignore', outFd, errFd], timeout: 30000, windowsHide: true });
    const out = fs.readFileSync(outFile, 'utf8');
    const err = fs.readFileSync(errFile, 'utf8');
    return {
      exit: r.status === null ? -1 : r.status,
      out,
      err,
      timedOut: r.error ? String(r.error.code || r.error.message) : null,
    };
  } finally {
    fs.closeSync(outFd);
    fs.closeSync(errFd);
  }
}

function runGeth(c) {
  const f = path.join(tmp, c.id + '.hex');
  fs.writeFileSync(f, '0x' + c.code + '\n', 'utf8');
  const args = ['run', '--codefile', f, '--gas', String(c.gasLimit), '--json'];
  if (c.data) args.push('--input', '0x' + c.data);
  const { exit, out, err } = exec(exes.geth, args);
  const objs = jsonObjects(out + '\n' + err);
  const last = objs[objs.length - 1] || null;
  const norm = { impl: 'geth', caseId: c.id, exit, steps: objs.filter((o) => o.op !== undefined).length };
  if (last && last.error) {
    norm.status = /revert/i.test(last.error) ? 'revert' : 'error';
    norm.errorKind = last.error;
    if (last.output !== undefined) norm.output = String(last.output).replace(/^0x/, '');
    const g = hexToInt(last.gas);
    const cost = hexToInt(last.gasCost) || 0;
    if (last.gasUsed !== undefined) norm.gasUsed = hexToInt(last.gasUsed);
    else if (g !== null) {
      norm.gasUsed = Math.max(0, c.gasLimit - (g - cost));
      norm.gasUsedEstimated = true;
    }
  } else if (last && last.output !== undefined) {
    norm.status = 'success';
    norm.output = String(last.output).replace(/^0x/, '');
    norm.gasUsed = hexToInt(last.gasUsed);
  } else {
    norm.status = 'unknown';
    norm.errorKind = 'итоговая строка не распознана';
  }
  const bare = out.match(/^\s*0x[0-9a-fA-F]*\s*$/m);
  if (bare && norm.output === undefined) norm.output = bare[0].trim().slice(2);
  return { norm, args, stdout: out, stderr: err };
}

function runRevme(c) {
  // у revme байткод позиционный, лимит газа — --gas-limit, плюс --json для машинного вывода
  const args = ['evm', '0x' + c.code, '--gas-limit', String(c.gasLimit), '--json'];
  if (c.data) args.push('--input', '0x' + c.data);
  const { exit, out, err } = exec(exes.revme, args);
  const norm = { impl: 'revme', caseId: c.id, exit };

  // ответ revme: { "result": { "Success|Revert|Halt|…": { reason, gas{…}, logs, output } }, "elapsed": … }
  let j = null;
  try {
    j = JSON.parse(out.trim());
  } catch {
    j = jsonObjects(out + '\n' + err).pop() || null;
  }
  const res = j && j.result ? j.result : null;
  if (!res) {
    norm.status = 'unknown';
    norm.errorKind = 'ответ не разобран как JSON';
    return { norm, args, stdout: out, stderr: err };
  }

  const variant = Object.keys(res)[0];
  const inner = res[variant] || {};
  const gas = inner.gas || {};

  if (variant === 'Success') norm.status = 'success';
  else if (variant === 'Revert') norm.status = 'revert';
  else {
    norm.status = 'error';
    norm.errorKind = inner.reason || variant;
  }

  // Газ: revme отдаёт полный газ транзакции, geth в режиме run — только исполнение.
  // Приводим к сопоставимому виду, вычитая floor_gas (внутренний газ, 21000).
  if (gas.gas_spent !== undefined) {
    norm.gasUsedRaw = gas.gas_spent;
    if (gas.floor_gas !== undefined) {
      norm.gasUsed = Math.max(0, gas.gas_spent - gas.floor_gas);
      norm.gasBaseline = 'вычтено ' + gas.floor_gas + ' (внутренний газ транзакции)';
    } else {
      norm.gasUsed = gas.gas_spent;
    }
  }

  // output бывает строкой ("0x…") или объектом {"Call": "0x…"} / {"Create": "0x…"}
  const o = inner.output;
  if (typeof o === 'string') norm.output = o.replace(/^0x/, '');
  else if (o && typeof o === 'object') {
    const k = Object.keys(o)[0];
    if (k) norm.output = String(o[k]).replace(/^0x/, '');
  }
  if (Array.isArray(inner.logs)) norm.logCount = inner.logs.length;

  return { norm, args, stdout: out, stderr: err };
}

const runners = { geth: runGeth, revme: runRevme };

for (const impl of ['geth', 'revme']) {
  if (!exes[impl] || !fs.existsSync(exes[impl])) {
    raw.push('=== реализация ' + impl + ': бинарник не найден, пропуск');
    continue;
  }
  for (const c of cases) {
    progress('запускаю ' + impl + ' / ' + c.id);
    const r = runners[impl](c);
    progress('  готово: ' + JSON.stringify(r.norm));
    raw.push('=== ' + impl + ' / ' + c.id + ' :: ' + r.args.join(' '));
    raw.push('[код выхода ' + r.norm.exit + ']');
    raw.push('-- stdout:\n' + r.stdout);
    if (r.stderr) raw.push('-- stderr:\n' + r.stderr);
    raw.push('-- нормализовано: ' + JSON.stringify(r.norm));
    raw.push('');
    results.push({ case: c, norm: r.norm });
  }
}

fs.writeFileSync(path.join(root, 'raw.log'), raw.join('\n'), 'utf8');
fs.writeFileSync(path.join(resDir, 'results.json'), JSON.stringify(results, null, 2), 'utf8');
console.log('raw.log готов');

// --- сводная таблица ---
const byImpl = (impl, id) => results.find((r) => r.norm.impl === impl && r.norm.caseId === id);
const lines = [];
lines.push('# Результаты дифференциального прогона');
lines.push('');
lines.push('Реализации: geth `evm.exe` 1.17.10 (Go, официальный инструмент) и revme 43.0.3 (Rust, revm).');
lines.push('');
lines.push('| случай | geth: код | geth: газ | geth: возврат | revme: код | revme: газ | revme: возврат | вердикт |');
lines.push('|---|---|---|---|---|---|---|---|');
let same = 0;
let diff = 0;
for (const c of cases) {
  const g = byImpl('geth', c.id);
  const v = byImpl('revme', c.id);
  const gs = g ? g.norm.status : '—';
  const vs = v ? v.norm.status : '—';
  const go = g && g.norm.output ? g.norm.output : '';
  const vo = v && v.norm.output ? v.norm.output : '';
  let verdict;
  if (!g || !v) verdict = 'нет второй реализации';
  else if (gs !== vs) verdict = 'РАСХОЖДЕНИЕ состояния';
  else if (go !== vo) verdict = 'РАСХОЖДЕНИЕ возврата';
  else if (gs === 'success' && g.norm.gasUsed !== v.norm.gasUsed) verdict = 'расхождение газа (исполнение)';
  else verdict = 'совпало';
  if (verdict === 'совпало') same++;
  else diff++;
  const gas = (x) => (x && x.norm.gasUsed !== null && x.norm.gasUsed !== undefined ? x.norm.gasUsed : '—');
  lines.push(
    `| ${c.id} | ${gs} | ${gas(g)} | ${go || '—'} | ${vs} | ${gas(v)} | ${vo || '—'} | ${verdict} |`
  );
}
lines.push('');
lines.push(`Итого: совпало ${same}, требует разбора ${diff} (из ${cases.length} случаев).`);
fs.writeFileSync(path.join(resDir, 'results.md'), lines.join('\n') + '\n', 'utf8');
console.log('results/results.md готов');
