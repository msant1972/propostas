import { Inject, Injectable } from '@nestjs/common';
import { jwtVerify, SignJWT } from 'jose';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import type { Principal } from './principal.js';

export class InvalidTokenError extends Error {}

@Injectable()
export class TokenService {
  private readonly key: Uint8Array;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.key = new TextEncoder().encode(env.AUTH_JWT_SECRET);
  }

  async issue(p: Principal): Promise<{ token: string; expiresAt: Date }> {
    const expiresAt = new Date(Date.now() + this.env.AUTH_TOKEN_TTL_HOURS * 3600_000);
    const token = await new SignJWT({ tv: p.tokenVersion })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(p.userId)
      .setIssuer('cpq')
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(this.key);
    return { token, expiresAt };
  }

  async verify(token: string): Promise<Principal> {
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: 'cpq', algorithms: ['HS256'] });
      if (!payload.sub || typeof payload['tv'] !== 'number') throw new InvalidTokenError('Token inválido');
      return { userId: payload.sub, tokenVersion: payload['tv'] };
    } catch (e) {
      if (e instanceof InvalidTokenError) throw e;
      throw new InvalidTokenError('Token inválido ou expirado');
    }
  }
}
