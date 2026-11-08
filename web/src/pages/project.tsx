import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PlayIcon, SnowflakeIcon } from 'lucide-react';
import { useAuthMini } from 'auth-mini-react-components';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Empty, ErrorNote, Field, Section, StatePill, when } from '../ui';
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

/** 目录的状态筛选：先给最常见的前三个，其余按 run 生命周期补齐。 */
const STATE_FILTERS = ['all', 'frozen', 'rejected', 'proposed', 'dispatched', 'running', 'lost'] as const;
type StateFilter = (typeof STATE_FILTERS)[number];

/** 目录的一行只放摘要：完整的思路与结果在 run 详情里，这里靠 CSS 截到两行。 */
function excerpt(md: string | null, fallback: string, limit = 200): string {
  if (!md) return fallback;
  const text = md
    .replace(/[#*`>|~_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return fallback;
  // 目录一屏可能有几十行，正文只留够填满两行的量：DOM 里不放整篇 README。
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

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
  const [stateFilter, setStateFilter] = useState<StateFilter>('all');
  const [opening, setOpening] = useState(false);
  const [idea, setIdea] = useState('');
  const [note, setNote] = useState('');

  if (!slug) return null;
  const project = detail.data?.project;
  const runs = detail.data?.runs ?? [];
  const snapshots = detail.data?.snapshots ?? [];
  const frozen = runs.filter((run) => run.state === 'frozen');
  const visibleRuns = stateFilter === 'all' ? runs : runs.filter((run) => run.state === stateFilter);
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

  const submitRun = () => {
    createRun.mutate(
      { note, idea_md: idea.trim() },
      {
        onSuccess: () => {
          setOpening(false);
          setIdea('');
          setNote('');
          detail.refetch();
        },
      },
    );
  };

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
          <Button size="sm" variant={opening ? 'outline' : 'default'} onClick={() => setOpening((value) => !value)}>
            <PlayIcon />
            {t('action.newRun')}
          </Button>
        </div>
      </header>

      <ErrorNote error={detail.error ?? createRun.error ?? freeze.error} />

      {opening ? (
        <Section title={t('action.newRun')} description={t('desc.newRun')}>
          <div className="flex flex-col gap-3">
            <Field label={t('label.ideaRequired')}>
              <Textarea
                className="min-h-24"
                value={idea}
                placeholder={t('placeholder.idea')}
                onChange={(event) => setIdea(event.target.value)}
              />
            </Field>
            <Field label={t('label.note')}>
              <Input value={note} placeholder={t('placeholder.note')} onChange={(event) => setNote(event.target.value)} />
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" disabled={!idea.trim() || createRun.isPending} onClick={submitRun}>
                {t('action.submit')}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setOpening(false)}>
                {t('action.cancel')}
              </Button>
              <span className="text-xs text-muted-foreground">{t('hint.ideaRequired')}</span>
            </div>
          </div>
        </Section>
      ) : null}

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
          <Section title={t('label.directory')} description={t('desc.directory')}>
            <div className="mb-3 flex flex-wrap gap-2">
              {STATE_FILTERS.map((value) => (
                <Button
                  key={value}
                  size="sm"
                  variant={stateFilter === value ? 'default' : 'outline'}
                  onClick={() => setStateFilter(value)}
                >
                  {value === 'all' ? t('label.all') : value}
                </Button>
              ))}
            </div>
            {/* 目录是六列并排的表格：语句列按比例分剩下的宽度，其余列固定，
                整张表停在 72rem 以内——宽屏下不该把字拉成一条条长河。 */}
            <div className="overflow-x-auto">
              <table className="plain w-full min-w-[44rem] max-w-[72rem] table-fixed">
                <colgroup>
                  <col style={{ width: '6.5rem' }} />
                  <col style={{ width: '6.5rem' }} />
                  <col />
                  <col />
                  <col style={{ width: '7rem' }} />
                  <col style={{ width: '4rem' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>lab</th>
                    <th>{t('label.state')}</th>
                    <th>{t('label.idea')}</th>
                    <th>{t('label.result')}</th>
                    <th className="truncate" title={primary ? primary.label : t('label.metrics')}>
                      {primary ? primary.label : t('label.metrics')}
                    </th>
                    <th>{t('label.gates')}</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRuns.map((run) => (
                    <tr key={run.id}>
                      <td className="font-mono whitespace-nowrap">
                        <Link to={`/runs/${run.id}`} className="text-primary underline-offset-4 hover:underline">
                          {run.lab}
                        </Link>
                      </td>
                      <td>
                        <StatePill state={run.state} />
                      </td>
                      <td className="text-xs text-muted-foreground">
                        <p className="line-clamp-2 break-words">{excerpt(run.idea_md, t('label.ideaEmpty'))}</p>
                      </td>
                      <td className="text-xs text-muted-foreground">
                        <p className="line-clamp-2 break-words">{excerpt(run.report_md, t('label.none'))}</p>
                      </td>
                      <td className="font-mono text-xs">
                        {primary && typeof run.metrics?.[primary.key] === 'number'
                          ? formatMetricValue(run.metrics[primary.key] as number, primary.unit)
                          : '—'}
                      </td>
                      <td className="text-xs">
                        {run.gates.length === 0 ? '—' : `${run.gates.filter((gate) => gate.pass).length}/${run.gates.length}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {visibleRuns.length === 0 ? <p className="mt-3 text-xs text-muted-foreground">{t('label.none')}</p> : null}
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
                <th>lab</th>
                <th>reason</th>
                <th>at</th>
              </tr>
            </thead>
            <tbody>
              {detail.data.sota_events.map((event) => (
                <tr key={event.id}>
                  <td>{event.action}</td>
                  <td className="font-mono text-xs whitespace-nowrap">
                    {event.lab ? (
                      <Link to={`/runs/${event.run_id}`} className="text-primary underline-offset-4 hover:underline">
                        {event.lab}
                      </Link>
                    ) : (
                      event.run_id
                    )}
                  </td>
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
  t: (key: 'label.directory' | 'label.leaderboard' | 'label.metricsTab' | 'label.datasetTab' | 'label.snapshots' | 'label.tokens') => string,
) {
  if (tab === 'metrics') return t('label.metricsTab');
  if (tab === 'dataset') return t('label.datasetTab');
  if (tab === 'leaderboard') return t('label.leaderboard');
  if (tab === 'snapshots') return t('label.snapshots');
  if (tab === 'tokens') return t('label.tokens');
  return t('label.directory');
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="card flex flex-col gap-1 p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={mono ? 'font-mono text-sm' : 'text-sm'}>{value}</span>
    </div>
  );
}
