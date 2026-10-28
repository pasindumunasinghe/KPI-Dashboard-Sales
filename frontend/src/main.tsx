import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from './api/client';
import { App } from './App';
import { AuthProvider } from './auth/AuthContext';
import { FiltersProvider } from './FiltersContext';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 15000,
      // Keep retrying while the first-start data load is running; fail fast otherwise.
      retry: (count, error) => (error instanceof ApiError && error.status === 503 ? count < 40 : false),
      retryDelay: 3000
    }
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <FiltersProvider>
            <App />
          </FiltersProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
