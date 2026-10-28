import { FlaskConicalIcon, InfoIcon } from 'lucide-react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from '@zccz14/ux';
import { useAuthMini } from 'auth-mini-react-components';
import { FlaskMark } from './mark';
import { useCopy } from './copy';
import { ProjectsPage } from './pages/projects';
import { ProjectPage } from './pages/project';
import { RunPage } from './pages/run';
import { AboutPage } from './pages/about';

export function App() {
  const t = useCopy();
  const { isReady, isAuthenticated, verificationFailure } = useAuthMini();

  if (!isReady) {
    return (
      <main className="flex min-h-svh items-center justify-center p-6 text-sm text-muted-foreground">
        <div className="flex flex-col items-center gap-3">
          <span className="size-6 animate-pulse rounded-full bg-primary/40" />
          <span>{t('hint.login')}</span>
          {verificationFailure ? <span className="text-xs text-destructive">{verificationFailure.reason}</span> : null}
        </div>
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <main className="flex min-h-svh items-center justify-center p-6 text-sm text-muted-foreground">
        <div className="flex flex-col items-center gap-2 text-center">
          <span>{t('hint.login')}</span>
          <span className="max-w-sm text-xs">{t('hint.audience')}</span>
        </div>
      </main>
    );
  }

  return (
    <AppLayout
      logo={<FlaskMark />}
      title="AutoLabs"
      nav={[
        {
          label: t('nav.workbench'),
          items: [
            { to: '/', label: t('nav.projects'), icon: <FlaskConicalIcon /> },
            { to: '/about', label: t('nav.about'), icon: <InfoIcon /> },
          ],
        },
      ]}
    >
      <Routes>
        <Route path="/" element={<ProjectsPage />} />
        <Route path="/p/:slug" element={<ProjectPage />} />
        <Route path="/runs/:runId" element={<RunPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="*" element={<Navigate replace to="/" />} />
      </Routes>
    </AppLayout>
  );
}
