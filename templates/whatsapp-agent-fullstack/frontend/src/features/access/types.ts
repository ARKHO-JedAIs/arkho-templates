export interface RolePermissions {
  menu: string[];
  actions: string[];
}

export interface AccessRole {
  id: string;
  name: string;
  description: string;
  /** Comes with the project: its permissions change, but it is never deleted. */
  system: boolean;
  /** Holds every permission in code (developer): shown, never edited. */
  locked: boolean;
  permissions: RolePermissions;
}

export interface CatalogItem {
  id: string;
  label: string;
}

/** GET /admin/access */
export interface AccessOverview {
  roles: AccessRole[];
  menu: CatalogItem[];
  actions: CatalogItem[];
}

export interface NewRoleInput {
  id: string;
  name: string;
  description?: string;
  menu?: string[];
  actions?: string[];
}
