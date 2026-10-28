import { useState } from 'react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Empty, ErrorNote, Field, Section, when } from '../ui';
import { useCopy } from '../copy';
import { useDataset, useFirmamentDatasets, usePinDataset, type SdkLike } from '../api';

function bytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = value / 1024;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[index]}`;
}

export function DatasetPanel({ sdk, slug, onChanged }: { sdk: SdkLike | null; slug: string; onChanged: () => void }) {
  const t = useCopy();
  const dataset = useDataset(sdk, slug);
  const pin = usePinDataset(sdk, slug);
  const catalogue = useFirmamentDatasets(sdk, dataset.data?.firmament_enabled !== false);
  const [datasetId, setDatasetId] = useState('');
  const [note, setNote] = useState('');

  const bind = (id: string) => {
    if (!id) return;
    pin.mutate({ dataset_id: id, note }, {
      onSuccess: () => {
        setDatasetId('');
        setNote('');
        dataset.refetch();
        onChanged();
      },
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <ErrorNote error={dataset.error ?? pin.error ?? (dataset.data?.firmament_enabled === false ? null : catalogue.error)} />

      <Section title={t('label.dataset')} description={t('hint.dataset')}>
        {dataset.data?.current ? (
          <div className="flex flex-col gap-1 rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-semibold">{dataset.data.current.dataset_id}</span>
              <span className="text-sm">{dataset.data.current.name}</span>
              {dataset.data.current.verified ? (
                <span className="pill pill-frozen">verified</span>
              ) : (
                <span className="pill pill-live">unverified</span>
              )}
            </div>
            <p className="font-mono text-xs text-muted-foreground">
              digest {dataset.data.current.digest.slice(0, 16)}… · {dataset.data.current.file_count} files ·{' '}
              {bytes(dataset.data.current.bytes)} · pinned {when(dataset.data.current.pinned_at)}
            </p>
            {dataset.data.current.note ? <p className="text-xs text-muted-foreground">{dataset.data.current.note}</p> : null}
          </div>
        ) : (
          <Empty>{t('label.none')}</Empty>
        )}
      </Section>

      <Section
        title={t('action.bindDataset')}
        description={
          dataset.data?.firmament_enabled === false
            ? '未配置 Firmament 连接：本次绑定只记离线引用（unverified）。'
            : '绑定会读取 Firmament 的 manifest，钉住摘要；同一数据集再绑一次会新增一个 pin。'
        }
      >
        <div className="flex flex-wrap items-end gap-2">
          <Field label="dataset.id">
            <Input value={datasetId} onChange={(event) => setDatasetId(event.target.value.toLowerCase())} placeholder="okx-btc-usdt-perp-1m" />
          </Field>
          <div className="min-w-48 flex-1">
            <Field label="note">
              <Input value={note} onChange={(event) => setNote(event.target.value)} placeholder="为什么用这份数据" />
            </Field>
          </div>
          <Button size="sm" disabled={!datasetId || pin.isPending} onClick={() => bind(datasetId)}>
            {t('action.bindDataset')}
          </Button>
        </div>

        {catalogue.data?.datasets?.length ? (
          <div className="mt-3">
            <p className="mb-1 text-xs text-muted-foreground">Firmament 上的数据集</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {catalogue.data.datasets.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => bind(item.id)}
                  className="rounded-lg border border-border p-2 text-left text-xs hover:border-primary"
                >
                  <span className="font-mono text-sm">{item.id}</span>
                  <span className="ml-2 text-muted-foreground">{item.name}</span>
                  <p className="mt-1 text-muted-foreground">
                    {item.tier} · {item.file_count} files · {bytes(item.bytes)}
                  </p>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </Section>

      {dataset.data?.pins?.length ? (
        <Section title="Pin 历史">
          <table className="plain">
            <thead>
              <tr>
                <th>dataset</th>
                <th>digest</th>
                <th>files</th>
                <th>pinned</th>
              </tr>
            </thead>
            <tbody>
              {dataset.data.pins.map((item) => (
                <tr key={item.id}>
                  <td className="font-mono text-xs">{item.dataset_id}</td>
                  <td className="font-mono text-xs text-muted-foreground">{item.digest.slice(0, 16)}…</td>
                  <td className="text-xs">
                    {item.file_count} · {bytes(item.bytes)}
                  </td>
                  <td className="text-xs text-muted-foreground">{when(item.pinned_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      ) : null}
    </div>
  );
}
