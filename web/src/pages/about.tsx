import { useCopy } from '../copy';

export function AboutPage() {
  const t = useCopy();
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <header>
        <p className="kicker">AutoLabs</p>
        <h1 className="text-xl font-semibold">{t('about.title')}</h1>
      </header>
      <section className="card flex flex-col gap-3 p-5 text-sm leading-relaxed text-muted-foreground">
        <p>{t('about.p1')}</p>
        <p>{t('about.p2')}</p>
        <p>{t('about.p3')}</p>
      </section>
    </div>
  );
}
