import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { RequireAuth } from './auth/RequireAuth';
import { Layout } from './components/Layout';
import { CatalogPage } from './pages/CatalogPage';
import { ContentPage } from './pages/ContentPage';
import { ClientsPage } from './pages/ClientsPage';
import { ProposalPage } from './pages/ProposalPage';
import { ProposalsPage } from './pages/ProposalsPage';
import { ForbiddenPage } from './pages/ForbiddenPage';
import { LoginPage } from './pages/LoginPage';
import { ProductPage } from './pages/ProductPage';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/acesso-negado" element={<ForbiddenPage />} />
          <Route
            element={
              <RequireAuth>
                <Layout />
              </RequireAuth>
            }
          >
            <Route path="/catalogo" element={<CatalogPage />} />
            <Route path="/catalogo/:id" element={<ProductPage />} />
            <Route path="/conteudos" element={<ContentPage />} />
            <Route path="/clientes" element={<ClientsPage />} />
            <Route path="/propostas" element={<ProposalsPage />} />
            <Route path="/propostas/:id" element={<ProposalPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/catalogo" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
