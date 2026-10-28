import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HashRouter } from 'react-router-dom';
import { AuthMiniProvider } from 'auth-mini-react-components';
import { LinkitProvider } from 'linkit-react-components';
import { App } from './App';
import '@zccz14/ux/styles.css';
import 'linkit-react-components/styles.css';
import './style.css';

const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthMiniProvider
      authMiniBaseUrl="https://auth.ntnl.io"
      audiences={['autolabs.ntnl.io', 'linkit.ntnl.io']}
      autoRedirectToLogin
    >
      <LinkitProvider linkitBaseUrl="https://linkit.ntnl.io" lang="zh-CN">
        <QueryClientProvider client={client}>
          <HashRouter>
            <App />
          </HashRouter>
        </QueryClientProvider>
      </LinkitProvider>
    </AuthMiniProvider>
  </React.StrictMode>,
);
