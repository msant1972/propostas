import type { Role } from '@cpq/shared';

export interface Principal {
  /** Object ID do utilizador no Entra ID. */
  oid: string;
  email: string;
  displayName: string;
  roles: Role[];
}
