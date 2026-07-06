import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createRouter as createTanStackRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen.js';
import { AppProviders } from './providers.js';
import { initialSessionContext } from './route-guards.js';
import './styles/index.css';

const createRouter = createTanStackRouter as unknown as (options: unknown) => unknown;

const router = createRouter({
  routeTree,
  context: {
    session: initialSessionContext(),
  },
  defaultPreload: 'intent',
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProviders>
      <RouterProvider router={router as never} />
    </AppProviders>
  </StrictMode>,
);
