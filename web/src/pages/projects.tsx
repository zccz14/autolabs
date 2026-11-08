import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PlusIcon } from 'lucide-react';
import { useAuthMini } from 'auth-mini-react-components';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Empty, ErrorNote, Field, Section } from '../ui';
import { useCopy } from '../copy';
import { useCreateProject, useProjects, type SdkLike } from '../api';

export function ProjectsPage() {
  const t = useCopy();
  const { sdk } = useAuthMini();
  const typed = sdk as unknown as SdkLike | null;
  const projects = useProjects(typed);
  const create = useCreateProject(typed);
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'public-read'>('private');

  const submit = () => {
    create.mutate(
      { slug, name: name || slug, description, visibility },
      {
        onSuccess: () => {
          setOpen(false);
          setSlug('');
          setName('');
          setDescription('');
          projects.refetch();
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-end justify-between gap-3">
        <div>
          <p className="kicker">AutoLabs</p>
          <h1 className="text-xl font-semibold">{t('nav.projects')}</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => projects.refetch()}>
            {t('action.refresh')}
          </Button>
          <Button size="sm" onClick={() => setOpen((value) => !value)}>
            <PlusIcon />
            {t('action.create')}
          </Button>
        </div>
      </header>

      <ErrorNote error={projects.error ?? create.error} />

      {open ? (
        <Section title={t('action.create')}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('label.slug')}>
              <Input value={slug} onChange={(event) => setSlug(event.target.value.toLowerCase())} placeholder="q-labs" />
            </Field>
            <Field label={t('label.name')}>
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="股指期货实验" />
            </Field>
            <div className="sm:col-span-2">
              <Field label={t('label.description')}>
                <Input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="一句话说明这个项目在赌什么" />
              </Field>
            </div>
            <Field label={t('label.visibility')}>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={visibility === 'private' ? 'default' : 'outline'}
                  onClick={() => setVisibility('private')}
                >
                  {t('label.private')}
                </Button>
                <Button
                  size="sm"
                  variant={visibility === 'public-read' ? 'default' : 'outline'}
                  onClick={() => setVisibility('public-read')}
                >
                  {t('label.publicRead')}
                </Button>
              </div>
            </Field>
          </div>
          <div className="mt-3 flex gap-2">
            <Button size="sm" disabled={!slug || create.isPending} onClick={submit}>
              {t('action.submit')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              {t('action.cancel')}
            </Button>
          </div>
        </Section>
      ) : null}

      {projects.data && projects.data.projects.length === 0 ? <Empty>{t('empty.projects')}</Empty> : null}

      <div className="grid-cards">
        {(projects.data?.projects ?? []).map((project) => (
          <Link key={project.id} to={`/p/${project.slug}`} className="card flex flex-col gap-2 p-4 transition-colors hover:border-primary">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-sm font-semibold">{project.slug}</span>
              <span className="pill">{project.visibility === 'private' ? t('label.private') : t('label.publicRead')}</span>
            </div>
            <span className="text-sm">{project.name}</span>
            {project.description ? <span className="text-xs text-muted-foreground">{project.description}</span> : null}
            <div className="mt-1 flex gap-3 text-xs text-muted-foreground">
              <span>
                {t('label.labs')} {project.lab_seq}
              </span>
              <span>
                {t('label.nextLab')} <span className="font-mono">{project.next_lab}</span>
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
