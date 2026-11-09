import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useAuthMini } from 'auth-mini-react-components';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Empty, ErrorNote, Field, Section, StatePill, when } from '../ui';
import { useCopy } from '../copy';
import { useDispatchRun, useImplemented, usePromoteSota, useRun, type SdkLike } from '../api';
import { Markdown } from '../markdown';

// 真实门禁只有两条：no-future-leak 与 canonical-byte-equal。
// 指标不在这里：那是评估器算出来的，执行体只报「实现完成 + 自己跑过哪些检查」。
const SAMPLE_IMPLEMENTED = JSON.stringify(
  {
    gates: [
      { rule_id: 'no-future-leak', pass: true, evidence: 'causal-execution-audit: 全部门槛只用到入场时可知字段' },
      { rule_id: 'canonical-byte-equal', pass: true, evidence: 'run_optimized 与 run_conceptual 的 canonical.txt 逐字节一致' },
    ],
    report_md: '## 结论\n\n实验实现完成、冒烟通过。指标等评估器在设备上算出来。',
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
  const verdict = useImplemented(typed);
  const promote = usePromoteSota(typed, '');
  const location = useLocation();
  // 开 run 时如果没发出去，错误跟着导航一起过来；刷新之后仍然可以点「发出」重试。
  const arrivedError = (location.state as { dispatchError?: string } | null)?.dispatchError ?? null;
  const [localError, setLocalError] = useState<string | null>(arrivedError);
  const [payload, setPayload] = useState(SAMPLE_IMPLEMENTED);
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

      <ErrorNote error={localError ?? dispatch.error ?? verdict.error ?? promote.error} />

      <div className="grid gap-3 sm:grid-cols-3">
        <Section
          title="Cybion Thread"
          description="开一轮实验时 AutoLabs 自己建 Thread、发第一条输入；这里只存 id。没发出去就留在 proposed，点「发出」重试，已建过的 Thread 会复用。"
        >
          <p className="mb-2 break-all font-mono text-xs text-muted-foreground">{run.cybion_thread_id ?? '—'}</p>
          <Button
            size="sm"
            disabled={run.state !== 'proposed' || dispatch.isPending}
            onClick={() =>
              dispatch.mutate(
                { runId: run.id },
                {
                  onSuccess: (result) => {
                    setLocalError(result.dispatch.ok ? null : result.dispatch.error ?? '发出失败');
                    query.refetch();
                  },
                },
              )
            }
          >
            {run.state === 'proposed' ? t('action.dispatch') : '已发出'}
          </Button>
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

      <Section title={t('label.evaluation')} description={t('eval.hint')}>
        <div className="flex flex-col gap-1 text-xs">
          <p>
            {run.state === 'evaluating' ? t('eval.waiting') : run.metrics ? t('eval.done') : t('eval.none')}
          </p>
          {run.eval?.error ? <p className="text-destructive">{run.eval.error}</p> : null}
          {run.eval?.device_address ? (
            <p className="font-mono text-[0.7rem] text-muted-foreground">
              {run.eval.device_address} · {t('eval.attempts')} {run.eval.attempts}
            </p>
          ) : null}
        </div>
      </Section>

      <div className="grid gap-3 lg:grid-cols-2">
        <Section title={t('action.implemented')} description="把这一步当作 curl 的替身：正式流程由机器上报。上报里带 metrics 会被拒。">
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
              {t('action.implemented')}
            </Button>
          </div>
        </Section>

        <Section title={t('label.metrics')}>
          <pre className="block">{run.metrics ? JSON.stringify(run.metrics, null, 2) : '—'}</pre>
        </Section>
      </div>

      <Section title={t('label.ideaAndReport')} description="地图上的两列叙事：先看它想验证什么，再看它得到了什么。">
        {/* 叙事是散文，不是表格：一行别拉到 1300px，读起来会丢行。 */}
        <div className="max-w-4xl">
        <h3 className="mb-1 text-xs font-semibold">{t('label.idea')}</h3>
        {run.idea_md ? <Markdown>{run.idea_md}</Markdown> : <p className="text-xs text-muted-foreground">{t('label.ideaEmpty')}</p>}
        <h3 className="mt-4 mb-1 text-xs font-semibold">{t('label.report')}</h3>
        {run.report_md ? <Markdown>{run.report_md}</Markdown> : <p className="text-xs text-muted-foreground">{t('label.none')}</p>}
        </div>
      </Section>
    </div>
  );
}
