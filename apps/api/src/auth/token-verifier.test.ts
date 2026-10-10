import { generateKeyPair, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { DevTokenVerifier, EntraTokenVerifier, InvalidTokenError } from './token-verifier.js';

describe('DevTokenVerifier', () => {
  const v = new DevTokenVerifier('segredo-de-teste-com-tamanho-suficiente');

  it('emite e valida um token com papéis', async () => {
    const t = await v.issue({ oid: 'u1', email: 'a@x.pt', name: 'Ana', roles: ['Comercial'] });
    expect(await v.verify(t)).toMatchObject({ oid: 'u1', roles: ['Comercial'] });
  });

  it('rejeita assinatura de outro segredo', async () => {
    const other = new DevTokenVerifier('outro-segredo-de-teste-com-tamanho-ok');
    const t = await other.issue({ oid: 'u1', email: '', name: 'x', roles: [] });
    await expect(v.verify(t)).rejects.toBeInstanceOf(InvalidTokenError);
  });
});

describe('EntraTokenVerifier', () => {
  const tenant = 't-123';
  const audience = 'api://cpq';

  async function setup() {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const verifier = new EntraTokenVerifier({
      tenantId: tenant,
      audience,
      groupRoleMap: { 'g-fin': 'Aprovador_Financeiro' },
      keyResolver: async () => publicKey,
    });
    const sign = (claims: Record<string, unknown>, iss = `https://login.microsoftonline.com/${tenant}/v2.0`) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuer(iss)
        .setAudience(audience)
        .setExpirationTime('1h')
        .sign(privateKey);
    return { verifier, sign };
  }

  it('mapeia roles da aplicação e grupos para papéis', async () => {
    const { verifier, sign } = await setup();
    const t = await sign({ oid: 'o1', name: 'Rui', preferred_username: 'rui@x.pt', roles: ['Juridico', 'Inexistente'], groups: ['g-fin', 'g-x'] });
    const p = await verifier.verify(t);
    expect(p.roles.sort()).toEqual(['Aprovador_Financeiro', 'Juridico']);
    expect(p.email).toBe('rui@x.pt');
  });

  it('rejeita emissor errado', async () => {
    const { verifier, sign } = await setup();
    const t = await sign({ oid: 'o1' }, 'https://login.microsoftonline.com/outro/v2.0');
    await expect(verifier.verify(t)).rejects.toBeInstanceOf(InvalidTokenError);
  });
});
