import { createRemoteJWKSet, jwtVerify, SignJWT, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { isRole, ROLES, type Role } from '@cpq/shared';
import type { Principal } from './principal.js';

export interface TokenVerifier {
  verify(token: string): Promise<Principal>;
}

export class InvalidTokenError extends Error {}

function toPrincipal(payload: JWTPayload, groupRoleMap: Record<string, Role> = {}): Principal {
  const oid = String(payload['oid'] ?? payload.sub ?? '');
  if (!oid) throw new InvalidTokenError('Token sem identificador de utilizador');

  const fromRoles = Array.isArray(payload['roles']) ? payload['roles'].filter(isRole) : [];
  const fromGroups = Array.isArray(payload['groups'])
    ? payload['groups'].map((g) => groupRoleMap[String(g)]).filter((r): r is Role => !!r)
    : [];
  const roles = [...new Set<Role>([...fromRoles, ...fromGroups])];

  return {
    oid,
    email: String(payload['email'] ?? payload['preferred_username'] ?? ''),
    displayName: String(payload['name'] ?? payload['email'] ?? oid),
    roles,
  };
}

export class EntraTokenVerifier implements TokenVerifier {
  constructor(
    private readonly opts: {
      tenantId: string;
      audience: string;
      groupRoleMap?: Record<string, Role>;
      /** Substituível em testes; por omissão usa o JWKS público do tenant. */
      keyResolver?: JWTVerifyGetKey;
    },
  ) {}

  private readonly jwks = this.opts.keyResolver ?? createRemoteJWKSet(
    new URL(`https://login.microsoftonline.com/${this.opts.tenantId}/discovery/v2.0/keys`),
  );

  async verify(token: string): Promise<Principal> {
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: `https://login.microsoftonline.com/${this.opts.tenantId}/v2.0`,
        audience: this.opts.audience,
        algorithms: ['RS256'],
      });
      return toPrincipal(payload, this.opts.groupRoleMap);
    } catch (e) {
      if (e instanceof InvalidTokenError) throw e;
      throw new InvalidTokenError('Token inválido');
    }
  }
}

/** Apenas desenvolvimento/testes: tokens HS256 assinados com um segredo local. */
export class DevTokenVerifier implements TokenVerifier {
  private readonly key: Uint8Array;
  constructor(secret: string) {
    this.key = new TextEncoder().encode(secret);
  }

  async issue(input: { oid: string; email: string; name: string; roles: Role[] }): Promise<string> {
    const roles = input.roles.filter((r) => (ROLES as readonly string[]).includes(r));
    return new SignJWT({ oid: input.oid, email: input.email, name: input.name, roles })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('cpq-dev')
      .setIssuedAt()
      .setExpirationTime('8h')
      .sign(this.key);
  }

  async verify(token: string): Promise<Principal> {
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: 'cpq-dev', algorithms: ['HS256'] });
      return toPrincipal(payload);
    } catch (e) {
      if (e instanceof InvalidTokenError) throw e;
      throw new InvalidTokenError('Token inválido');
    }
  }
}
