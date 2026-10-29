import { useState } from 'react';
import { KeyRoundIcon } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Empty, ErrorNote, Field, Section, when } from '../ui';
import { useCopy } from '../copy';
import { useMintToken, useRevokeToken, useTokens, type SdkLike } from '../api';
import { parseCapabilities, tokenStatus, type TokenStatus } from '../tokens-format';

const CAPABILITIES = ['read', 'write', 'verdict', 'sota'] as const;
const DAYS = [1, 7, 30, 90, 365] as const;
/** 默认不带 sota：晋升指针是最小权限里的例外，必须显式勾选。 */
const DEFAULT_CAPABILITIES = ['read', 'write', 'verdict'];

const STATUS_CLASS: Record<TokenStatus, string> = {
  live: 'pill-live',
  revoked: 'pill-rejected',
  expired: 'pill-proposed',
};

export function TokensPanel({ sdk, slug }: { sdk: SdkLike | null; slug: string }) {
  const t = useCopy();
  const tokens = useTokens(sdk, slug);
  const mint = useMintToken(sdk, slug);
  const revoke = useRevokeToken(sdk, slug);
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [form, setForm] = useState<{ label: string; capabilities: string[]; days: number }>({
    label: '机器同步凭据',
    capabilities: [...DEFAULT_CAPABILITIES],
    days: 90,
  });

  const toggleCapability = (capability: string) =>
    setForm((prev) => ({
      ...prev,
      capabilities: prev.capabilities.includes(capability)
        ? prev.capabilities.filter((value) => value !== capability)
        : [...prev.capabilities, capability],
    }));

  const submit = () => {
    mint.mutate(
      { label: form.label.trim() || '机器同步凭据', capabilities: form.capabilities, expires_in_days: form.days },
      {
        onSuccess: (data) => {
          setSecret(data.token);
          setCopied(false);
          setOpen(false);
          tokens.refetch();
        },
      },
    );
  };

  const copy = async () => {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const now = Math.floor(Date.now() / 1000);
  const list = tokens.data?.tokens ?? [];

  return (
    <Section
      title={t('label.tokens')}
      description={t('hint.tokens')}
      action={
        <Button size="sm" onClick={() => setOpen((value) => !value)}>
          <KeyRoundIcon />
          {t('action.mintToken')}
        </Button>
      }
    >
      <ErrorNote error={tokens.error ?? mint.error ?? revoke.error} />

      {secret ? (
        <div className="mb-3 rounded-lg border border-border p-3">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-xs font-medium">{t('label.newToken')}</span>
            <Button size="sm" variant="outline" onClick={() => copy()}>
              {copied ? t('action.copied') : t('action.copy')}
            </Button>
          </div>
          <pre className="block">{secret}</pre>
        </div>
      ) : null}

      {open ? (
        <div className="mb-3 grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2">
          <Field label={t('label.name')}>
            <Input value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} />
          </Field>
          <Field label={t('label.expiresInDays')}>
            <div className="flex flex-wrap gap-1">
              {DAYS.map((days) => (
                <Button key={days} size="sm" variant={form.days === days ? 'default' : 'outline'} onClick={() => setForm({ ...form, days })}>
                  {days}
                </Button>
              ))}
            </div>
          </Field>
          <div className="sm:col-span-2">
            <Field label={t('label.capabilities')}>
              <div className="flex flex-wrap gap-1">
                {CAPABILITIES.map((capability) => (
                  <Button
                    key={capability}
                    size="sm"
                    variant={form.capabilities.includes(capability) ? 'default' : 'outline'}
                    onClick={() => toggleCapability(capability)}
                  >
                    {capability}
                  </Button>
                ))}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{t('hint.tokenCapabilities')}</p>
            </Field>
          </div>
          <div className="flex items-center gap-2 sm:col-span-2">
            <Button size="sm" disabled={mint.isPending || form.capabilities.length === 0} onClick={submit}>
              {t('action.mintToken')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              {t('action.cancel')}
            </Button>
          </div>
        </div>
      ) : null}

      {tokens.data && list.length === 0 ? (
        <Empty>{t('empty.tokens')}</Empty>
      ) : list.length > 0 ? (
        <table className="plain">
          <thead>
            <tr>
              <th>{t('label.name')}</th>
              <th>{t('label.capabilities')}</th>
              <th>{t('label.created')}</th>
              <th>{t('label.expires')}</th>
              <th>{t('label.state')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((token) => {
              const status = tokenStatus(token, now);
              const capabilities = parseCapabilities(token.capabilities);
              return (
                <tr key={token.id}>
                  <td>{token.label}</td>
                  <td>
                    <span className="flex flex-wrap gap-1">
                      {capabilities.length === 0 ? '—' : capabilities.map((capability) => (
                        <span key={capability} className="pill pill-proposed font-mono">
                          {capability}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className="text-xs text-muted-foreground">{when(token.created_at)}</td>
                  <td className="text-xs text-muted-foreground">{when(token.expires_at)}</td>
                  <td>
                    <span className={`pill ${STATUS_CLASS[status]}`}>
                      {status === 'live' ? t('label.live') : status === 'revoked' ? t('label.revoked') : t('label.expired')}
                    </span>
                  </td>
                  <td>
                    {token.revoked_at ? (
                      <span className="block text-right text-xs text-muted-foreground">{when(token.revoked_at)}</span>
                    ) : confirmId === token.id ? (
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={revoke.isPending}
                          onClick={() =>
                            revoke.mutate(token.id, {
                              onSuccess: () => {
                                setConfirmId(null);
                                tokens.refetch();
                              },
                            })
                          }
                        >
                          {t('action.confirmRevoke')}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirmId(null)}>
                          {t('action.cancel')}
                        </Button>
                      </div>
                    ) : (
                      <div className="flex justify-end">
                        <Button size="sm" variant="outline" onClick={() => setConfirmId(token.id)}>
                          {t('action.revoke')}
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
    </Section>
  );
}
