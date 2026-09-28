'use client';

import type { ReactNode } from 'react';
import { AuthProvider } from '@/lib/auth';
import { ToastHost } from '@/components/ui/Toast';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      {children}
      <ToastHost />
    </AuthProvider>
  );
}

export default Providers;
