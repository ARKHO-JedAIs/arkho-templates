export type UserRole = 'admin' | 'member';

export interface ManagedUser {
  username: string;
  /** Stable Cognito user id - what audit fields like a report's reviewedBy
   * store, so it's the key for resolving those ids back to a person. */
  sub: string | null;
  email: string | null;
  name: string | null;
  /** Every profile the account holds, admin first. A user can hold both: an
   * admin who is also a member keeps the admin's reach over every screen
   * and can additionally draft their own. Empty means no role at all, which
   * leaves the account unable to reach anything. */
  roles: UserRole[];
  enabled: boolean;
  status: string | null;
  createdAt: string | null;
}

export interface CreateUserInput {
  email: string;
  name?: string;
  roles?: UserRole[];
}

export interface UpdateUserInput {
  name?: string;
  email?: string;
  /** The full set the user should end up with - it grants and revokes, so
   * omitting a role the user currently holds removes it. */
  roles?: UserRole[];
}
