import type { ReactNode } from 'react';

export function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="card p-4">
      <header className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

const STATE_CLASS: Record<string, string> = {
  frozen: 'pill-frozen',
  rejected: 'pill-rejected',
  running: 'pill-live',
  dispatched: 'pill-live',
  evaluating: 'pill-live',
  proposed: 'pill-proposed',
  lost: 'pill-rejected',
};

export function StatePill({ state }: { state: string }) {
  return <span className={`pill ${STATE_CLASS[state] ?? 'pill-proposed'}`}>{state}</span>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">{children}</p>;
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  return <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{message}</p>;
}

export function when(seconds: number | null | undefined): string {
  if (!seconds) return '—';
  return new Date(seconds * 1000).toLocaleString();
}
