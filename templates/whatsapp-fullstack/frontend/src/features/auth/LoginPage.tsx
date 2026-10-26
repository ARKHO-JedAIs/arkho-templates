import { useCallback, useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import useAuthStore, { selectIsAuthenticated } from '@/lib/stores/useAuthStore';
import { LoginForm } from './components/LoginForm';
import { LoginLayout } from './layouts';

/**
 * The product name, declared once.
 *
 * Keeping it in a constant rather than inline in the JSX is what stops the
 * generated file from failing its own Prettier check: substituting a longer or
 * shorter name into markup would change the line width and the wrapping with it.
 */
const APP_NAME = '{{ project_name }}';

/**
 * Sign-in screen: the redirect-if-signed-in logic and the form. How it looks is
 * the layout chosen at generation time (`./layouts`: card, split or fullscreen).
 */
export default function LoginPage() {
  const navigate = useNavigate();
  const { checkAuth } = useAuthStore();

  const redirectIfSignedIn = useCallback(async () => {
    await checkAuth();
    if (selectIsAuthenticated(useAuthStore.getState())) {
      navigate({ to: '/' });
    }
  }, [checkAuth, navigate]);

  useEffect(() => {
    void redirectIfSignedIn();
  }, [redirectIfSignedIn]);

  return (
    <LoginLayout appName={APP_NAME}>
      <LoginForm />
    </LoginLayout>
  );
}
