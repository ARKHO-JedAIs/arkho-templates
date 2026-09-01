import { useCallback, useEffect, useState } from 'react';
import { fetchUsers, UsersAuthError } from '../services/usersService';
import type { ManagedUser } from '../types/user.types';

const GENERIC_ERROR_MESSAGE =
  'No se pudo conectar con el servicio de usuarios. Verifica tu conexión e intenta de nuevo.';

/** Loads every user in the pool, for the admin/users management screen. */
export function useUsers() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authError, setAuthError] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setAuthError(false);

    try {
      const data = await fetchUsers();
      setUsers(data);
    } catch (err) {
      if (err instanceof UsersAuthError) {
        setAuthError(true);
      } else {
        setError(err instanceof Error ? err.message : GENERIC_ERROR_MESSAGE);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { users, isLoading, error, authError, reload: load };
}
