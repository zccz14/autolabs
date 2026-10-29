export type LabMetrics = {
  cumulative_return: number;
  annualized_return: number;
  max_drawdown: number;
  sharpe: number;
  trades: number;
  avg_daily_trades: number;
};

export declare const METRIC_KEYS: string[];
export declare function parseMetricsCsv(text: string): LabMetrics | null;
export declare function parseLeaderboard(text: string): Map<number, LabMetrics>;
export declare function resolveLabMetrics(input: {
  labNo: number;
  metricsCsvText?: string | null;
  leaderboard?: Map<number, LabMetrics> | null;
}): { metrics: LabMetrics | null; source: string | null };
