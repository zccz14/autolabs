import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { KeyRoundIcon, PlayIcon, SnowflakeIcon } from 'lucide-react';
import { useAuthMini } from 'auth-mini-react-components';
import { Button } from '../components/ui/button';
import { Empty, ErrorNote, Section, StatePill, when } from '../ui';
import { useCopy } from '../copy';
import { DatasetPanel } from './dataset-panel';
import { TokensPanel } from './tokens-panel';
import { MetricsPanel } from './metrics-panel';
import {
  downloadSnapshot,
  useCreateRun,
  useFreezeSnapshot,
  useMetrics,
  useProject,
  type SdkLike,
} from '../api';
import { formatMetricValue } from '../metrics-format';

type Tab = 'runs' | 'leaderboard' | 'metrics' | 'dataset' | 'snapshots' | 'tokens';

export function ProjectPage() {
  const t = useCopy();
  const { slug } = useParams<{ slug: string }>();
  const { sdk } = useAuthMini();
  const typed = sdk as unknown as SdkLike | null;
  const detail = useProject(typed, slug);
  const createRun = useCreateRun(typed, slug ?? '');
  const freeze = useFreezeSnapshot(typed);
  const metricDefs = useMetrics(typed, slug);
  const [tab, setTab] = useState<Tab>('runs');

  if (!slug) return null;
  const project = detail.data?.project;
  const runs = detail.data?.runs ?? [];
  const snapshots = detail.data?.snapshots ?? [];
  const frozen = runs.filter((run) => run.state === 'frozen');
  const definitions = [...(metricDefs.data?.metrics ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  const primary = definitions.find((metric) => metric.is_primary);
  // 榜单按主指标排序：数字缺失的沉底，方向按口径来（回撤这种越低越好）。
  const ranked = [...frozen].sort((left, right) => {
    const read = (run: (typeof frozen)[number]) => {
      const value = primary ? run.metrics?.[primary.key] : undefined;
      return typeof value === 'number' ? value : null;
    };
    const a = read(left);
    const b = read(right);
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return primary?.direction === 'lower-better' ? a - b : b - a;
  });
  const sotaLab = runs.find((run) => run.id === project?.sota_run_id)?.lab ?? t('label.none');

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="kicker">{project?.visibility === 'public-read' ? t('label.publicRead') : t('label.private')}</p>
          <h1 className="font-mono text-xl font-semibold">{slug}</h1>
          <p className="text-sm text-muted-foreground">{project?.name}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => detail.refetch()}>
            {t('action.refresh')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setTab('tokens')}>
            <KeyRoundIcon />
            {t('label.tokens')}
          </Button>
          <Button size="sm" disabled={createRun.isPending} onClick={() => createRun.mutate('', { onSuccess: () => detail.refetch() })}>
            <PlayIcon />
            {t('action.newRun')}
          </Button>
        </div>
      </header>

      <ErrorNote error={detail.error ?? createRun.error ?? freeze.error} />

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label={t('label.labs')} value={String(project?.lab_seq ?? 0)} />
        <Stat label={t('label.nextLab')} value={project?.next_lab ?? '—'} mono />
        <Stat label={t('label.sota')} value={sotaLab} mono />
        <Stat label={t('label.snapshots')} value={String(project?.snapshot_count ?? snapshots.length)} />
      </div>

      <nav className="flex gap-2">
        {(['runs', 'leaderboard', 'metrics', 'dataset', 'snapshots', 'tokens'] as Tab[]).map((value) => (
          <Button key={value} size="sm" variant={tab === value ? 'default' : 'outline'} onClick={() => setTab(value)}>
            {labelForTab(value, t)}
          </Button>
        ))}
      </nav>

      {tab === 'runs' ? (
        runs.length === 0 ? (
          <Empty>{t('empty.runs')}</Empty>
        ) : (
          <Section title={t('label.runs')}>
            <table className="plain">
              <thead>
                <tr>
                  <th>lab</th>
                  <th>{t('label.state')}</th>
                  <th>{t('label.gates')}</th>
                  <th>external_ref</th>
                  <th>created</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td className="font-mono">
                      <Link to={`/runs/${run.id}`} className="text-primary underline-offset-4 hover:underline">
                        {run.lab}
                      </Link>
                    </td>
                    <td>
                      <StatePill state={run.state} />
                    </td>
                    <td>
                      {run.gates.length === 0 ? '—' : `${run.gates.filter((gate) => gate.pass).length}/${run.gates.length}`}
                    </td>
                    <td className="font-mono text-xs text-muted-foreground">{run.external_ref}</td>
                    <td className="text-xs text-muted-foreground">{when(run.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )
      ) : null}

      {tab === 'leaderboard' ? (
        <Section title={t('label.leaderboard')} description="只有冻结且门禁全过的 run 才有资格上榜。">
          {frozen.length === 0 ? (
            <Empty>{t('label.none')}</Empty>
          ) : (
            <table className="plain">
              <thead>
                <tr>
                  <th>lab</th>
                  {definitions.length === 0 ? <th>{t('label.metrics')}</th> : null}
                  {definitions.map((metric) => (
                    <th key={metric.key}>
                      {metric.label}
                      {metric.required ? <span className="ml-1 text-destructive">*</span> : null}
                    </th>
                  ))}
                  <th>settled</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((run) => (
                  <tr key={run.id}>
                    <td className="font-mono">
                      {run.lab} {run.id === project?.sota_run_id ? <span className="pill pill-frozen">SOTA</span> : null}
                    </td>
                    {definitions.length === 0 ? (
                      <td className="font-mono text-xs">{run.metrics ? JSON.stringify(run.metrics) : '—'}</td>
                    ) : null}
                    {definitions.map((metric) => {
                      const value = run.metrics?.[metric.key];
                      return (
                        <td key={metric.key} className="font-mono text-xs">
                          {typeof value === 'number' ? formatMetricValue(value, metric.unit) : '—'}
                        </td>
                      );
                    })}
                    <td className="text-xs text-muted-foreground">{when(run.settled_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-xs text-muted-foreground">带 * 的是必报指标：缺任何一个，run 都不会通过。</p>
        </Section>
      ) : null}

      {tab === 'metrics' ? <MetricsPanel sdk={typed} slug={slug} onChanged={() => detail.refetch()} /> : null}

      {tab === 'dataset' ? <DatasetPanel sdk={typed} slug={slug} onChanged={() => detail.refetch()} /> : null}

      {tab === 'tokens' ? <TokensPanel sdk={typed} slug={slug} /> : null}

      {tab === 'snapshots' ? (
        snapshots.length === 0 ? (
          <Empty>{t('empty.snapshots')}</Empty>
        ) : (
          <Section title={t('label.snapshots')}>
            <table className="plain">
              <thead>
                <tr>
                  <th>id</th>
                  <th>message</th>
                  <th>tree</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {snapshots.map((snapshot) => (
                  <tr key={snapshot.id}>
                    <td className="font-mono text-xs">{snapshot.id}</td>
                    <td>
                      {snapshot.message}
                      {snapshot.frozen ? <span className="pill pill-frozen ml-2">frozen</span> : null}
                    </td>
                    <td className="font-mono text-xs text-muted-foreground">{snapshot.tree_sha.slice(0, 12)}</td>
                    <td>
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          title={t('action.download')}
                          onClick={() => typed && downloadSnapshot(typed, slug, snapshot.id).catch(() => undefined)}
                        >
                          ↓
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          title={t('action.freeze')}
                          disabled={snapshot.frozen}
                          onClick={() => freeze.mutate(snapshot.id, { onSuccess: () => detail.refetch() })}
                        >
                          <SnowflakeIcon />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )
      ) : null}

      {detail.data && detail.data.sota_events.length > 0 ? (
        <Section title="SOTA 账本" description="谁把谁挤下去、为什么——不是一个被覆盖的段落。">
          <table className="plain">
            <thead>
              <tr>
                <th>action</th>
                <th>run</th>
                <th>reason</th>
                <th>at</th>
              </tr>
            </thead>
            <tbody>
              {detail.data.sota_events.map((event) => (
                <tr key={event.id}>
                  <td>{event.action}</td>
                  <td className="font-mono text-xs">{event.run_id}</td>
                  <td>{event.reason}</td>
                  <td className="text-xs text-muted-foreground">{when(event.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      ) : null}
    </div>
  );
}

function labelForTab(
  tab: Tab,
  t: (key: 'label.runs' | 'label.leaderboard' | 'label.metricsTab' | 'label.datasetTab' | 'label.snapshots' | 'label.tokens') => string,
) {
  if (tab === 'metrics') return t('label.metricsTab');
  if (tab === 'dataset') return t('label.datasetTab');
  if (tab === 'leaderboard') return t('label.leaderboard');
  if (tab === 'snapshots') return t('label.snapshots');
  if (tab === 'tokens') return t('label.tokens');
  return t('label.runs');
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="card flex flex-col gap-1 p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={mono ? 'font-mono text-sm' : 'text-sm'}>{value}</span>
    </div>
  );
}
