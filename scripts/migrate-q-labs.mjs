#!/usr/bin/env node
/**
 * 把 Q-Labs 仓库里已完成的 lab 历史迁进 AutoLabs。
 *
 * 每个 lab 落成一个快照 + 一个 run：快照只收实验定义（源码、README）与体积可控的
 * 结论表（outputs 下的小 CSV/TXT/JSON），不收 Q-Labs 里 1 GB 级的预测中间件与图；
 * 那些是运行产物，留在原仓库即可。
 *
 *   node scripts/migrate-q-labs.mjs --source ~/Projects/Q-Labs                 # 干跑，只报数
 *   node scripts/migrate-q-labs.mjs --source ~/Projects/Q-Labs --apply \
 *        --api https://autolabs.ntnl.io --token alb_xxx_yyy                   # 真跑
 *   node scripts/migrate-q-labs.mjs --emit-bootstrap --owner <uid>            # 生成建项目 SQL
 *
 * 设计与取舍见 docs/q-labs-migration.md。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseLeaderboard, resolveLabMetrics } from './lib/q-labs-metrics.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_OUTPUT_FILES = 40;
const OUTPUT_EXT = new Set(['.csv', '.txt', '.json', '.md']);

function parseArgs(argv) {
  const args = { source: path.join(process.env.HOME ?? '', 'Projects/Q-Labs'), slug: 'q-labs', apply: false, metrics: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--apply') args.apply = true;
    else if (token === '--metrics') args.metrics = true;
    else if (token === '--emit-bootstrap') args.bootstrap = true;
    else if (token.startsWith('--')) {
      const key = token.slice(2);
      args[key] = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/** 实验编号只认 lab<N>；cs_lab / fmab_lab 是另外两条研究线，不进这个项目的序列。 */
function discoverLabs(sourceDir) {
  const labsDir = path.join(sourceDir, 'labs');
  const labs = [];
  for (const entry of fs.readdirSync(labsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const match = /^lab(\d+)$/.exec(entry.name);
    if (!match) continue;
    const dir = path.join(labsDir, entry.name);
    const readme = path.join(dir, 'README.md');
    if (!fs.existsSync(readme)) continue;
    labs.push({ no: Number(match[1]), name: entry.name, dir, readme });
  }
  return labs.sort((a, b) => a.no - b.no);
}

/** 一个 lab 要进快照的文件：根目录源码 + README + outputs 里的小结论表。 */
function selectFiles(lab) {
  const files = [];
  for (const entry of fs.readdirSync(lab.dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!/\.(py|md)$/i.test(entry.name)) continue;
    files.push({ path: entry.name, abs: path.join(lab.dir, entry.name) });
  }
  const outputsDir = path.join(lab.dir, 'outputs');
  if (fs.existsSync(outputsDir)) {
    for (const relative of walk(outputsDir)) {
      const abs = path.join(outputsDir, relative);
      const stat = fs.statSync(abs);
      if (stat.size > MAX_OUTPUT_BYTES) continue;
      if (!OUTPUT_EXT.has(path.extname(relative).toLowerCase())) continue;
      files.push({ path: `outputs/${relative}`, abs, size: stat.size });
    }
  }
  // outputs 按体积从小到大取，保证同一份快照里有界；源码与 README 全量保留。
  const sources = files.filter((file) => !file.path.startsWith('outputs/'));
  const outputs = files
    .filter((file) => file.path.startsWith('outputs/'))
    .sort((a, b) => a.size - b.size)
    .slice(0, MAX_OUTPUT_FILES);
  return [...sources, ...outputs].map((file) => {
    const buffer = fs.readFileSync(file.abs);
    return { path: file.path, buffer, sha256: sha256(buffer), size: buffer.byteLength };
  });
}

function walk(dir, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name), relative));
    else if (entry.isFile()) out.push(relative);
  }
  return out;
}

/** README 是否声明该 lab 已冻结/完成：迁移时用它决定门禁证据写什么。 */
function freezeEvidence(readme) {
  const frozen = /冻结/.test(readme) && /(已冻结|完成全量|已完成全量|已冻结)/.test(readme);
  const completed = /(已完成全量|全量默认复现|全量默认运行)/.test(readme);
  return {
    pass: frozen || completed,
    text: frozen ? 'README 声明该 lab 已冻结' : completed ? 'README 声明已完成全量默认运行' : 'README 未声明冻结或完成',
  };
}

/** 指标只从可核对的来源取：lab 自己的 metrics.csv，或根 README 的 SOTA 榜单行。 */
function metricsForLab(lab, sourceDir, leaderboard) {
  const csvPath = path.join(lab.dir, 'outputs', 'metrics.csv');
  const metricsCsvText = fs.existsSync(csvPath) ? fs.readFileSync(csvPath, 'utf8') : null;
  return resolveLabMetrics({ labNo: lab.no, metricsCsvText, leaderboard });
}

async function request(api, token, method, route, body) {
  const response = await fetch(`${api}${route}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = payload?.message ?? response.statusText;
    throw new Error(`${method} ${route} → ${response.status} ${message}`);
  }
  return payload;
}

async function requestRaw(api, token, method, route, body) {
  const response = await fetch(`${api}${route}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' },
    body,
  });
  if (response.ok) return null;
  const text = await response.text();
  throw new Error(`${method} ${route} → ${response.status} ${text.slice(0, 200)}`);
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** 建项目必须人类会话，运维侧直接用同一套 schema 落库；指标模板从 src/metrics.ts 抄同一份。 */
function readMetricTemplate() {
  const source = fs.readFileSync(path.join(ROOT, 'src/metrics.ts'), 'utf8');
  const start = source.indexOf('export const METRIC_TEMPLATE');
  const eq = source.indexOf('=', start);
  const end = source.indexOf('\n];', eq);
  const literal = source.slice(eq + 1, end + 2).replace(/^\s*:[^=]*=/, '');
  return Function(`return ${literal}`)();
}

function bootstrapSql({ owner, slug, name, description, tokenId, secretSha256, now }) {
  const projectId = `prj_${crypto.randomBytes(16).toString('hex').slice(0, 24)}`;
  const lines = [
    '-- 由 scripts/migrate-q-labs.mjs --emit-bootstrap 生成；建项目需要人类会话，运维走 SQL 落库。',
    `INSERT INTO users (id, created_at) SELECT ${sqlString(owner)}, ${now} WHERE NOT EXISTS (SELECT 1 FROM users WHERE id = ${sqlString(owner)});`,
    `INSERT INTO projects (id, slug, name, description, owner_user_id, visibility, lab_seq, created_at)
       VALUES (${sqlString(projectId)}, ${sqlString(slug)}, ${sqlString(name)}, ${sqlString(description)}, ${sqlString(owner)}, 'private', 0, ${now});`,
    `INSERT INTO project_members (project_id, user_id, role, created_at) VALUES (${sqlString(projectId)}, ${sqlString(owner)}, 'owner', ${now});`,
    `INSERT INTO events (id, project_id, kind, payload, actor_user_id, created_at)
       VALUES (${sqlString(`evt_${crypto.randomBytes(12).toString('hex')}`)}, ${sqlString(projectId)}, 'project.created', ${sqlString(JSON.stringify({ slug, imported: true }))}, ${sqlString(owner)}, ${now});`,
    `INSERT INTO project_tokens (id, project_id, label, secret_sha256, capabilities, created_by, created_at, expires_at)
       VALUES (${sqlString(tokenId)}, ${sqlString(projectId)}, 'q-labs 迁移', ${sqlString(secretSha256)}, 'read,write,verdict,sota', ${sqlString(owner)}, ${now}, ${now + 7 * 24 * 3600});`,
  ];
  for (const metric of readMetricTemplate()) {
    lines.push(
      `INSERT INTO project_metrics (id, project_id, key, version, label, unit, direction, definition_md, is_primary, sort_order, created_by, created_at)
       VALUES (${sqlString(`met_${crypto.randomBytes(12).toString('hex')}`)}, ${sqlString(projectId)}, ${sqlString(metric.key)}, 1, ${sqlString(metric.label)}, ${sqlString(metric.unit)}, ${sqlString(metric.direction)}, ${sqlString(metric.definition_md)}, ${metric.is_primary ? 1 : 0}, ${metric.sort_order}, ${sqlString(owner)}, ${now});`,
    );
  }
  return { projectId, sql: `${lines.join('\n')}\n` };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const now = Math.floor(Date.now() / 1000);

  if (args.bootstrap) {
    if (!args.owner) throw new Error('--emit-bootstrap 需要 --owner <auth mini uid>');
    const tokenId = `tok_${crypto.randomBytes(12).toString('hex')}`;
    const secret = crypto.randomBytes(24).toString('hex');
    const secretSha256 = sha256(`${tokenId}:${secret}`);
    const { projectId, sql } = bootstrapSql({
      owner: args.owner,
      slug: args.slug,
      name: args.name ?? 'Q-Labs',
      description: args.description ?? '股指期货日内策略研究：83 个 lab 的历史迁移，指标取自各自的 outputs/metrics.csv 或根 README 榜单。',
      tokenId,
      secretSha256,
      now,
    });
    const out = args.out ?? path.join('/tmp', 'q-labs-bootstrap.sql');
    fs.writeFileSync(out, sql);
    console.log(`项目 id: ${projectId}`);
    console.log(`SQL 已写入 ${out}`);
    console.log(`迁移令牌（只显示这一次）：alb_${tokenId}_${secret}`);
    return;
  }

  const labs = discoverLabs(args.source);
  const leaderboardPath = path.join(args.source, 'README.md');
  const leaderboard = fs.existsSync(leaderboardPath) ? parseLeaderboard(fs.readFileSync(leaderboardPath, 'utf8')) : new Map();
  const plan = labs.map((lab) => {
    const files = selectFiles(lab);
    const readme = fs.readFileSync(lab.readme, 'utf8');
    return { lab, files, readme, freeze: freezeEvidence(readme), ...metricsForLab(lab, args.source, leaderboard) };
  });
  const totalBytes = plan.reduce((sum, item) => sum + item.files.reduce((s, file) => s + file.size, 0), 0);
  const totalFiles = plan.reduce((sum, item) => sum + item.files.length, 0);
  const metricsCount = plan.filter((item) => item.metrics).length;
  const fromCsv = plan.filter((item) => item.source?.includes('metrics.csv')).length;
  const fromTable = plan.filter((item) => item.source?.includes('Leaderboard'));

  console.log(`Q-Labs：${plan.length} 个编号 lab（lab1-lab${plan[plan.length - 1]?.lab.no ?? 0}）`);
  console.log(`快照内容：${totalFiles} 个文件 / ${(totalBytes / 1024 / 1024).toFixed(2)} MiB（源码 + README + outputs ≤${MAX_OUTPUT_BYTES / 1024} KiB 的结论表）`);
  console.log(`单 lab 最大：${Math.max(...plan.map((item) => item.files.reduce((s, f) => s + f.size, 0))) / 1024 | 0} KiB`);
  console.log(`README 声明冻结/完成：${plan.filter((item) => item.freeze.pass).length} / ${plan.length}`);
  console.log(`能报全 6 个指标：${metricsCount} / ${plan.length}（metrics.csv ${fromCsv} 条 + 榜单行 ${fromTable.length} 条）`);
  console.log(`缺指标（不会通过）：${plan.length - metricsCount} 条 → ${plan.filter((item) => !item.metrics).map((item) => `lab${item.lab.no}`).join(', ')}`);
  const passCount = plan.filter((item) => item.freeze.pass && item.metrics).length;
  console.log(`按门禁预计 frozen：${passCount} / ${plan.length}（README 未声明冻结 ${plan.filter((item) => !item.freeze.pass).length} 条）`);

  if (!args.apply) {
    const preview = plan.slice(0, 5).map((item) => `  lab-${String(item.lab.no).padStart(4, '0')}  ${item.files.length} 文件  ${(item.files.reduce((s, f) => s + f.size, 0) / 1024).toFixed(0)} KiB  ${item.freeze.pass ? 'frozen' : 'rejected'}  ${item.metrics ? '指标 6/6' : '指标缺失'}`);
    console.log('干跑，前 5 条：\n' + preview.join('\n'));
    console.log('加 --apply --api <url> --token <alb_…> 才会真正上传。');
    return;
  }

  if (!args.api || !args.token) throw new Error('--apply 需要 --api 与 --token');
  const project = await request(args.api, args.token, 'GET', `/api/v1/projects/${args.slug}`);
  const existing = new Map(project.runs.map((run) => [run.lab_no, run]));
  console.log(`项目 ${args.slug}：已有 ${existing.size} 个 run，lab_seq=${project.project.lab_seq}`);
  // 迁移按 lab1..labN 顺序落库，已有编号必须是连续前缀，否则中途断档会把编号对错。
  for (const labNo of existing.keys()) {
    if (!plan.some((item) => item.lab.no === labNo)) throw new Error(`项目里已有 lab-${labNo}，与 Q-Labs 编号对不上`);
  }
  const missingBelowMax = plan.filter((item) => item.lab.no <= Math.max(0, ...existing.keys()) && !existing.has(item.lab.no));
  if (missingBelowMax.length > 0) throw new Error(`已有 run 不是连续前缀，缺 lab-${missingBelowMax.map((i) => i.lab.no).join(', lab-')}`);

  let imported = 0;
  for (const item of plan) {
    if (existing.has(item.lab.no)) continue;
    const label = `lab-${String(item.lab.no).padStart(4, '0')}`;
    for (const file of item.files) {
      await requestRaw(args.api, args.token, 'PUT', `/api/v1/projects/${args.slug}/blobs/${file.sha256}`, file.buffer);
    }
    const files = Object.fromEntries(item.files.map((file) => [file.path, file.sha256]));
    const snapshotSize = item.files.reduce((sum, file) => sum + file.size, 0);
    await request(args.api, args.token, 'POST', `/api/v1/projects/${args.slug}/snapshots`, {
      message: `import Q-Labs labs/${item.lab.name}（${item.files.length} 文件，${(snapshotSize / 1024).toFixed(0)} KiB）`,
      files,
    });
    const created = await request(args.api, args.token, 'POST', `/api/v1/projects/${args.slug}/runs`, {
      note: `历史迁移自 Q-Labs labs/${item.lab.name}；未在 AutoLabs 重新回测。`,
    });
    const verdict = {
      gates: [
        {
          rule_id: 'imported-history',
          pass: item.freeze.pass,
          evidence: `${item.freeze.text}（Q-Labs labs/${item.lab.name}/README.md）`,
        },
      ],
      report_md: item.readme,
    };
    if (item.metrics) verdict.metrics = item.metrics;
    await request(args.api, args.token, 'POST', `/api/v1/runs/${created.run.id}/verdict`, verdict);
    imported += 1;
    console.log(
      `  ${label} ← ${item.lab.name}：${item.files.length} 文件 / ${(snapshotSize / 1024).toFixed(0)} KiB → ${
        item.freeze.pass && item.metrics ? 'frozen' : 'rejected'
      }（${item.metrics ? '指标 6/6' : '缺指标'}）`,
    );
    if (args.limit && imported >= Number(args.limit)) break;
  }
  const after = await request(args.api, args.token, 'GET', `/api/v1/projects/${args.slug}`);
  console.log(`本轮导入 ${imported} 个 lab；项目现在 ${after.runs.length} 个 run，lab_seq=${after.project.lab_seq}`);
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exit(1);
});
