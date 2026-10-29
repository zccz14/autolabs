/**
 * 从 Q-Labs 的两种「机器可核对」来源里取指标：
 *
 *   1. labs/labN/outputs/metrics.csv —— lab 自己脚本跑出来的口径（首选）
 *   2. 根 README 的 SOTA Leaderboard 表 —— 人工维护，但每一列都有明确定义
 *
 * 故意不解析 README 散文：那些句子里经常同时出现别的 lab 的数字
 * （“相比 lab3 的 63261 笔，lab4 降到 1395 笔”），猜错一个数就是往
 * 榜单上写假数。没有这两种来源的 lab，就是「没汇报指标」。
 */

export const METRIC_KEYS = [
  'cumulative_return',
  'annualized_return',
  'max_drawdown',
  'sharpe',
  'trades',
  'avg_daily_trades',
];

function numberOrNull(text) {
  if (text === undefined || text === null) return null;
  const cleaned = String(text).replace(/[`,\s]/g, '');
  if (cleaned === '' || cleaned === '—' || cleaned === '-') return null;
  const value = Number(cleaned.replace(/%$/, ''));
  return Number.isFinite(value) ? value : null;
}

/** metrics.csv：一行一条策略，第一行就是默认结果；收益列已经是小数（1.16 = 116%）。 */
export function parseMetricsCsv(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length < 2) return null;
  const columns = lines[0].split(',').map((column) => column.trim());
  const cells = lines[1].split(',').map((cell) => cell.trim());
  const pick = (name) => {
    const index = columns.indexOf(name);
    return index < 0 ? null : numberOrNull(cells[index]);
  };
  const metrics = {
    cumulative_return: pick('total_return'),
    annualized_return: pick('annual_return'),
    max_drawdown: pick('max_drawdown'),
    sharpe: pick('daily_sharpe'),
    trades: pick('trades'),
    avg_daily_trades: pick('avg_daily_trades'),
  };
  return METRIC_KEYS.every((key) => metrics[key] !== null) ? metrics : null;
}

function splitRow(line) {
  return line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

/** 根 README 的 SOTA Leaderboard：`| 排名 | Lab | … | 交易数 | 样本外日均交易 | 累计收益 | 年化收益 | 最大回撤 | 日收益夏普 | … |` */
export function parseLeaderboard(text) {
  const lines = text.split(/\r?\n/);
  const headerLine = lines.find((line) => line.startsWith('|') && line.includes('Lab') && line.includes('累计收益'));
  if (!headerLine) return new Map();
  const header = splitRow(headerLine);
  const index = {
    lab: header.findIndex((cell) => cell === 'Lab'),
    trades: header.indexOf('交易数'),
    avg: header.indexOf('样本外日均交易'),
    cumulative: header.indexOf('累计收益'),
    annualized: header.indexOf('年化收益'),
    drawdown: header.indexOf('最大回撤'),
    sharpe: header.indexOf('日收益夏普'),
  };
  if (index.lab < 0 || index.cumulative < 0) return new Map();
  const table = new Map();
  for (const line of lines) {
    if (!line.startsWith('|') || line === headerLine) continue;
    const cells = splitRow(line);
    const match = /`?lab(\d+)`?/.exec(cells[index.lab] ?? '');
    if (!match) continue;
    const percent = (cell) => numberOrNull(String(cell ?? '').replace(/%$/, '')) / 100;
    const metrics = {
      trades: numberOrNull(cells[index.trades]),
      avg_daily_trades: numberOrNull(cells[index.avg]),
      cumulative_return: percent(cells[index.cumulative]),
      annualized_return: percent(cells[index.annualized]),
      max_drawdown: percent(cells[index.drawdown]),
      sharpe: numberOrNull(cells[index.sharpe]),
    };
    if (METRIC_KEYS.every((key) => metrics[key] !== null)) table.set(Number(match[1]), metrics);
  }
  return table;
}

/**
 * 根 README 榜单的「排名」列：写数字才算进了排名。
 * 写成「排除」「重评估」这类标注的，说明它不是一个能独立汇报指标的实验——
 * 中途的重评估、继承未来信息的结果都归这一类，只能算 rejected。
 */
export function parseLeaderboardStatus(text) {
  const lines = text.split(/\r?\n/);
  const headerLine = lines.find((line) => line.startsWith('|') && line.includes('Lab') && line.includes('累计收益'));
  if (!headerLine) return new Map();
  const header = splitRow(headerLine);
  const labIndex = header.findIndex((cell) => cell === 'Lab');
  const rankIndex = header.indexOf('排名');
  const noteIndex = header.indexOf('评价');
  if (labIndex < 0 || rankIndex < 0) return new Map();
  const table = new Map();
  for (const line of lines) {
    if (!line.startsWith('|') || line === headerLine) continue;
    const cells = splitRow(line);
    const match = /`?lab(\d+)`?/.exec(cells[labIndex] ?? '');
    if (!match) continue;
    const status = (cells[rankIndex] ?? '').trim();
    if (!status) continue;
    table.set(Number(match[1]), {
      status,
      ranked: /^\d+$/.test(status),
      note: noteIndex >= 0 ? (cells[noteIndex] ?? '').trim() : '',
    });
  }
  return table;
}

/** 指标只有一个来源优先级：lab 自己的 metrics.csv 优先于人工维护的榜单行。 */
export function resolveLabMetrics({ labNo, metricsCsvText, leaderboard }) {
  if (metricsCsvText) {
    const parsed = parseMetricsCsv(metricsCsvText);
    if (parsed) return { metrics: parsed, source: 'labs/labN/outputs/metrics.csv' };
  }
  const row = leaderboard?.get(labNo);
  if (row) return { metrics: row, source: '根 README SOTA Leaderboard' };
  return { metrics: null, source: null };
}
