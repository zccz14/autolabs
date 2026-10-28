import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuthMini } from 'auth-mini-react-components';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Empty, ErrorNote, Field, Section, StatePill, when } from '../ui';
import { useCopy } from '../copy';
import { useDispatchRun, usePromoteSota, useRun, useVerdict, type SdkLike } from '../api';

const SAMPLE_VERDICT = JSON.stringify(
  {
    gates: [
      { rule_id: 'no-future-leak', pass: true, evidence: 'causal-execution-audit: 全部门槛只用到入场时可知字段' },
      { rule_id: 'min-sample', pass: true, evidence: 'out-of-sample 交易 1493 笔' },
      { rule_id: 'canonical-byte-equal', pass: true, evidence: 'run_optimized 与 run_conceptual 的 canonical.txt 逐字节一致' },
    ],
    metrics: { cumulative_return: 0.3092, sharpe: 0.9, max_drawdown: -0.1775, trades: 1493 },
    report_md: '## 结论\n\n因果口径下收益转正，但频率跌破硬约束，不能进入 SOTA。',
  },
  null,
  2,
);

export function RunPage() {
  const t = useCopy();
  const { runId } = useParams<{ runId: string }>();
  const { sdk } = useAuthMini();
  const typed = sdk as unknown as SdkLike | null;
  const query = useRun(typed, runId);
  const dispatch = useDispatchRun(typed);
  const verdict = useVerdict(typed);
  const promote = usePromoteSota(typed, '');
  const [threadId, setThreadId] = useState('');
  const [payload, setPayload] = useState(SAMPLE_VERDICT);
  const [reason, setReason] = useState('全量样本外通过门禁，风险调整优于当前 SOTA');

  const run = query.data?.run;
  if (!run) {
    return (
      <div className="flex flex-col gap-3">
        <ErrorNote error={query.error} />
        {!query.error ? <Empty>加载中…</Empty> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link to="/" className="kicker">
            AutoLabs
          </Link>
          <h1 className="font-mono text-xl font-semibold">{run.lab}</h1>
          <p className="font-mono text-xs text-muted-foreground">{run.external_ref}</p>
        </div>
        <div className="flex items-center gap-2">
          <StatePill state={run.state} />
          <Button variant="outline" size="sm" onClick={() => query.refetch()}>
            {t('action.refresh')}
          </Button>
        </div>
      </header>

      <ErrorNote error={dispatch.error ?? verdict.error ?? promote.error} />

      <div className="grid gap-3 sm:grid-cols-3">
        <Section title="Cybion Thread" description="执行体在用户自己的机器上，这里只存 id。">
          <p className="mb-2 font-mono text-xs text-muted-foreground">{run.cybion_thread_id ?? '—'}</p>
          <div className="flex gap-2">
            <Input value={threadId} onChange={(event) => setThreadId(event.target.value)} placeholder="thr_…" />
            <Button
              size="sm"
              disabled={!threadId || dispatch.isPending}
              onClick={() => dispatch.mutate({ runId: run.id, threadId }, { onSuccess: () => query.refetch() })}
            >
              {t('action.dispatch')}
            </Button>
          </div>
        </Section>
        <Section title="快照">
          <p className="font-mono text-xs">in {run.input_snapshot_id}</p>
          <p className="font-mono text-xs text-muted-foreground">out {run.output_snapshot_id ?? '—'}</p>
          <p className="mt-2 text-xs text-muted-foreground">created {when(run.created_at)}</p>
        </Section>
        <Section title="结算">
          <p className="text-xs">{run.settled_at ? when(run.settled_at) : '未结算'}</p>
          <div className="mt-2 flex gap-2">
            <Input value={reason} onChange={(event) => setReason(event.target.value)} />
            <Button
              size="sm"
              variant="outline"
              disabled={run.state !== 'frozen' || promote.isPending}
              onClick={() => promote.mutate({ runId: run.id, reason }, { onSuccess: () => query.refetch() })}
            >
              {t('action.promote')}
            </Button>
          </div>
        </Section>
      </div>

      <Section title={t('label.gates')} description="门禁由平台记录与判定，全过才 frozen。">
        {run.gates.length === 0 ? (
          <Empty>{t('label.none')}</Empty>
        ) : (
          <table className="plain">
            <thead>
              <tr>
                <th>rule</th>
                <th>pass</th>
                <th>evidence</th>
              </tr>
            </thead>
            <tbody>
              {run.gates.map((gate) => (
                <tr key={gate.rule_id}>
                  <td className="font-mono text-xs">{gate.rule_id}</td>
                  <td>{gate.pass ? '✅' : '❌'}</td>
                  <td className="text-xs text-muted-foreground">{gate.evidence ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <div className="grid gap-3 lg:grid-cols-2">
        <Section title={t('action.verdict')} description="把这一步当作 curl 的替身：正式流程由机器上报。">
          <Field label="payload (JSON)">
            <textarea
              className="min-h-56 w-full rounded-lg border border-border bg-transparent p-2 font-mono text-xs outline-none focus-visible:border-ring"
              value={payload}
              onChange={(event) => setPayload(event.target.value)}
            />
          </Field>
          <div className="mt-2">
            <Button
              size="sm"
              disabled={verdict.isPending}
              onClick={() => {
                try {
                  verdict.mutate({ runId: run.id, payload: JSON.parse(payload) }, { onSuccess: () => query.refetch() });
                } catch {
                  /* 非法 JSON 由 textarea 自己承担代价 */
                }
              }}
            >
              {t('action.verdict')}
            </Button>
          </div>
        </Section>

        <Section title={t('label.metrics')}>
          <pre className="block">{run.metrics ? JSON.stringify(run.metrics, null, 2) : '—'}</pre>
          <h3 className="mt-3 mb-1 text-xs font-semibold">{t('label.report')}</h3>
          <pre className="block">{run.report_md ?? '—'}</pre>
        </Section>
      </div>
    </div>
  );
}
