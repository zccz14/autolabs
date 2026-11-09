import { useState } from 'react';
import { useAuthMini } from 'auth-mini-react-components';
import { CheckIcon, CopyIcon, PlusIcon, RefreshCwIcon, Trash2Icon } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Empty, ErrorNote, Field, Section } from '../ui';
import { useCopy, type CopyKey } from '../copy';
import {
  useCreateIdentity,
  useDeleteDevice,
  useDevices,
  useProbeDevice,
  useRegisterDevice,
  useRotateIdentity,
  type DeviceProbe,
  type DeviceView,
  type SdkLike,
} from '../api';

/**
 * 设备页：用户在这里拿到自己那把地址，把它加进自己机器的 trust，再登记机器。
 *
 * 私钥不在这里出现，也不该在这里出现——它在服务端密封着，只在使用时解开签名。
 * 用户要做的唯一一件事是「把公开地址贴到自己的机器上」，那不是管密钥，
 * 那是给自己机器授权。
 */

function ProbeNote({ probe }: { probe: DeviceProbe | null }) {
  if (!probe) return null;
  return (
    <p
      className={`rounded-lg px-3 py-2 text-xs ${
        probe.ok ? 'bg-muted text-muted-foreground' : 'bg-destructive/10 text-destructive'
      }`}
    >
      {probe.message}
    </p>
  );
}

function stamp(seconds: number | null): string {
  if (!seconds) return '—';
  return new Date(seconds * 1000).toLocaleString();
}

function DeviceRow({
  device,
  onProbe,
  onRemove,
  busy,
  t,
}: {
  device: DeviceView;
  onProbe: () => void;
  onRemove: () => void;
  busy: boolean;
  t: (key: CopyKey) => string;
}) {
  const state =
    device.probe_ok === null
      ? t('devices.neverProbed')
      : device.probe_ok
        ? t('devices.probeOk')
        : t('devices.probeFailed');
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{device.label}</p>
          <p className="truncate font-mono text-xs text-muted-foreground">{device.address}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button variant="outline" size="sm" disabled={busy} onClick={onProbe}>
            <RefreshCwIcon />
            {t('devices.probe')}
          </Button>
          <Button variant="ghost" size="icon-sm" disabled={busy} onClick={onRemove} aria-label={t('devices.remove')}>
            <Trash2Icon />
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className={device.probe_ok ? 'text-foreground' : undefined}>{state}</span>
        {device.platform ? <span>{device.platform}</span> : null}
        <span>
          {t('devices.lastProbe')}：{stamp(device.probe_at)}
        </span>
      </div>
      {device.probe_error ? <p className="text-xs text-destructive">{device.probe_error}</p> : null}
    </li>
  );
}

export function DevicesPage() {
  const t = useCopy();
  const { sdk } = useAuthMini();
  const typed = sdk as unknown as SdkLike | null;
  const devices = useDevices(typed);
  const createIdentity = useCreateIdentity(typed);
  const rotateIdentity = useRotateIdentity(typed);
  const register = useRegisterDevice(typed);
  const probe = useProbeDevice(typed);
  const remove = useDeleteDevice(typed);

  const [addressInput, setAddressInput] = useState('');
  const [labelInput, setLabelInput] = useState('');
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState<DeviceProbe | null>(null);
  const [confirmRotate, setConfirmRotate] = useState(false);

  const identity = devices.data?.identity ?? null;
  const list = devices.data?.devices ?? [];
  const busy = register.isPending || probe.isPending || remove.isPending;

  const copyAddress = async () => {
    if (!identity) return;
    try {
      await navigator.clipboard.writeText(identity.address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const submitDevice = () => {
    setNote(null);
    register.mutate(
      { address: addressInput.trim(), label: labelInput.trim() },
      {
        onSuccess: (result) => {
          setNote(result.probe);
          if (result.probe.ok) {
            setAddressInput('');
            setLabelInput('');
          }
          devices.refetch();
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <header>
        <p className="kicker">AutoLabs</p>
        <h1 className="text-xl font-semibold">{t('nav.devices')}</h1>
      </header>

      <ErrorNote error={devices.error ?? register.error ?? probe.error ?? remove.error ?? createIdentity.error} />

      <Section
        title={t('devices.addressTitle')}
        description={t('devices.addressHint')}
        action={
          identity ? (
            confirmRotate ? (
              <div className="flex gap-1">
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={rotateIdentity.isPending}
                  onClick={() =>
                    rotateIdentity.mutate(undefined, {
                      onSuccess: () => {
                        setConfirmRotate(false);
                        devices.refetch();
                      },
                    })
                  }
                >
                  {t('devices.rotateConfirm')}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmRotate(false)}>
                  {t('action.cancel')}
                </Button>
              </div>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setConfirmRotate(true)}>
                {t('devices.rotate')}
              </Button>
            )
          ) : null
        }
      >
        {identity ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg bg-muted px-2.5 py-1.5 font-mono text-xs">{identity.address}</code>
              <Button variant="outline" size="sm" onClick={copyAddress}>
                {copied ? <CheckIcon /> : <CopyIcon />}
                {copied ? t('devices.copied') : t('devices.copy')}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t('devices.trustStep')}</p>
            {confirmRotate ? <p className="text-xs text-destructive">{t('devices.rotateHint')}</p> : null}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Empty>{t('devices.addressEmpty')}</Empty>
            <div>
              <Button
                size="sm"
                disabled={createIdentity.isPending || !typed}
                onClick={() => createIdentity.mutate(undefined, { onSuccess: () => devices.refetch() })}
              >
                <PlusIcon />
                {t('devices.createAddress')}
              </Button>
            </div>
          </div>
        )}
      </Section>

      <Section title={t('devices.devicesTitle')} description={t('devices.devicesHint')}>
        <div className="flex flex-col gap-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_14rem_auto] sm:items-end">
            <Field label={t('devices.deviceAddress')}>
              <Input
                value={addressInput}
                onChange={(event) => setAddressInput(event.target.value)}
                placeholder={t('devices.addressPlaceholder')}
                className="font-mono text-xs"
              />
            </Field>
            <Field label={t('label.name')}>
              <Input value={labelInput} onChange={(event) => setLabelInput(event.target.value)} placeholder={t('devices.labelPlaceholder')} />
            </Field>
            <Button size="sm" disabled={busy || !identity || addressInput.trim().length === 0} onClick={submitDevice}>
              <PlusIcon />
              {register.isPending ? '…' : t('devices.add')}
            </Button>
          </div>

          <ProbeNote probe={note} />

          {list.length === 0 ? (
            <Empty>{t('devices.empty')}</Empty>
          ) : (
            <ul className="flex flex-col gap-2">
              {list.map((device) => (
                <DeviceRow
                  key={device.id}
                  device={device}
                  busy={busy}
                  t={t}
                  onProbe={() =>
                    probe.mutate(device.id, {
                      onSuccess: (result) => {
                        setNote(result.probe);
                        devices.refetch();
                      },
                    })
                  }
                  onRemove={() =>
                    remove.mutate(device.id, {
                      onSuccess: () => {
                        setNote(null);
                        devices.refetch();
                      },
                    })
                  }
                />
              ))}
            </ul>
          )}
        </div>
      </Section>
    </div>
  );
}
