import type { ReactNode } from 'react';

/** What every sign-in layout receives: the app name and the form to frame. */
export interface LoginLayoutProps {
  appName: string;
  children: ReactNode;
}
