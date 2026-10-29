import { useState } from 'react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Empty, ErrorNote, Field, Section } from '../ui';
import { useCopy } from '../copy';
import { useMetrics, useRetireMetric, useUpsertMetric, type SdkLike } from '../api';

const UNITS = ['ratio', 'count', 'bps', 'seconds', 'number'];
const DIRECTIONS = ['higher-better', 'lower-better', 'neutral'] as const;

export function MetricsPanel({ sdk, slug, onChanged }: { sdk: SdkLike | null; slug: string; onChanged: () => void }) {
  const t = useCopy();
  const metrics = useMetrics(sdk, slug);
  const upsert = useUpsertMetric(sdk, slug);
  const retire = useRetireMetric(sdk, slug);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    key: '',
    label: '',
    unit: 'ratio',
    direction: 'higher-better' as (typeof DIRECTIONS)[number],
    definition_md: '',
    is_primary: false,
  });

  const submit = () => {
    upsert.mutate(form, {
      onSuccess: () => {
        setOpen(false);
        setForm({ key: '', label: '', unit: 'ratio', direction: 'higher-better', definition_md: '', is_primary: false });
        metrics.refetch();
        onChanged();
      },
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <Section
        title={t('label.metricsTab')}
        description={t('hint.metricVersion')}
        action={
          <Button size="sm" onClick={() => setOpen((value) => !value)}>
            {t('action.addMetric')}
          </Button>
        }
      >
        <ErrorNote error={metrics.error ?? upsert.error ?? retire.error} />

        {open ? (
          <div className="mb-3 grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2">
            <Field label="key">
              <Input
                value={form.key}
                onChange={(event) => setForm({ ...form, key: event.target.value.toLowerCase() })}
                placeholder="cumulative_return"
              />
            </Field>
            <Field label={t('label.name')}>
              <Input value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} placeholder="累计收益率" />
            </Field>
            <Field label={t('label.unit')}>
              <div className="flex flex-wrap gap-1">
                {UNITS.map((unit) => (
                  <Button key={unit} size="sm" variant={form.unit === unit ? 'default' : 'outline'} onClick={() => setForm({ ...form, unit })}>
                    {unit}
                  </Button>
                ))}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{t('hint.metricUnit')}</p>
            </Field>
            <Field label={t('label.direction')}>
              <div className="flex flex-wrap gap-1">
                {DIRECTIONS.map((direction) => (
                  <Button
                    key={direction}
                    size="sm"
                    variant={form.direction === direction ? 'default' : 'outline'}
                    onClick={() => setForm({ ...form, direction })}
                  >
                    {direction}
                  </Button>
                ))}
              </div>
            </Field>
            <div className="sm:col-span-2">
              <Field label={t('label.definition')}>
                <textarea
                  className="min-h-28 w-full rounded-lg border border-border bg-transparent p-2 text-xs outline-none focus-visible:border-ring"
                  value={form.definition_md}
                  onChange={(event) => setForm({ ...form, definition_md: event.target.value })}
                  placeholder="分母是什么、扣了哪些成本、样本外区间、年化因子、不重叠约束…"
                />
              </Field>
            </div>
            <div className="flex items-center gap-2 sm:col-span-2">
              <Button
                size="sm"
                variant={form.is_primary ? 'default' : 'outline'}
                onClick={() => setForm({ ...form, is_primary: !form.is_primary })}
              >
                {t('label.primary')}
              </Button>
              <Button size="sm" disabled={upsert.isPending || !form.key || !form.label} onClick={submit}>
                {t('action.saveMetric')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
                {t('action.cancel')}
              </Button>
            </div>
          </div>
        ) : null}

        {(metrics.data?.metrics ?? []).length === 0 ? (
          <Empty>{t('empty.metrics')}</Empty>
        ) : (
          <table className="plain">
            <thead>
              <tr>
                <th>{t('label.name')}</th>
                <th>key</th>
                <th>{t('label.unit')}</th>
                <th>{t('label.direction')}</th>
                <th>{t('label.version')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(metrics.data?.metrics ?? []).map((metric) => (
                <tr key={metric.key}>
                  <td>
                    {metric.label}
                    {metric.is_primary ? <span className="pill pill-frozen ml-2">{t('label.primary')}</span> : null}
                    <p className="mt-1 max-w-xl text-xs text-muted-foreground">{metric.definition_md}</p>
                  </td>
                  <td className="font-mono text-xs">{metric.key}</td>
                  <td className="text-xs">{metric.unit}</td>
                  <td className="text-xs">{metric.direction}</td>
                  <td className="font-mono text-xs">v{metric.version}</td>
                  <td>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => retire.mutate(metric.key, { onSuccess: () => { metrics.refetch(); onChanged(); } })}
                    >
                      {t('action.retire')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  );
}
