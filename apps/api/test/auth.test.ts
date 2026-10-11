import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, resetDb, TEST_DB, TEST_PASSWORD, type Harness } from './helpers.js';

const run = describe.skipIf(!TEST_DB);

run('autenticação local', () => {
  let h: Harness;
  const login = (email: string, password: string) => h.http().post('/api/v1/auth/login').send({ email, password });
  const A = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    h = await boot();
    await resetDb(h.prisma);
  });
  afterAll(() => h?.close());

  it('health é público e os cabeçalhos de segurança estão presentes', async () => {
    const r = await h.http().get('/api/v1/health').expect(200, { status: 'ok' });
    expect(r.headers['content-security-policy']).toContain("default-src 'none'");
  });

  it('sem token, 401 em problem+json', async () => {
    const r = await h.http().get('/api/v1/me').expect(401);
    expect(r.headers['content-type']).toContain('application/problem+json');
  });

  it('login com as credenciais certas devolve o token e o utilizador', async () => {
    const u = await h.makeUser({ role: 'Comercial', key: 'login', name: 'Ana' });
    const r = await login(u.email.toUpperCase(), TEST_PASSWORD).expect(201); // o email não distingue maiúsculas
    expect(r.body.user).toMatchObject({ email: u.email, displayName: 'Ana', roles: ['Comercial'], mustChangePassword: false });
    expect(new Date(r.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    const me = await h.http().get('/api/v1/me').set(A(r.body.accessToken)).expect(200);
    expect(me.body).toMatchObject({ email: u.email, roles: ['Comercial'] });
    expect(await h.prisma.user.findUniqueOrThrow({ where: { email: u.email } })).toMatchObject({ failedLogins: 0 });
  });

  it('credenciais erradas dão a mesma resposta para utilizador desconhecido e palavra-passe errada', async () => {
    const u = await h.makeUser({ role: 'Comercial', key: 'erro' });
    const a = await login(u.email, 'errada-Errada-1').expect(401);
    const b = await login('ninguem@teste.pt', 'errada-Errada-1').expect(401);
    expect(a.body.detail).toBe(b.body.detail);
    await login('isto-nao-e-email', 'x').expect(400);
  });

  it('bloqueia a conta após tentativas falhadas e desbloqueia pelo administrador', async () => {
    const u = await h.makeUser({ role: 'Comercial', key: 'lock' });
    for (let i = 0; i < 5; i++) await login(u.email, 'errada-Errada-1').expect(401);
    const locked = await login(u.email, TEST_PASSWORD).expect(423); // mesmo com a palavra-passe certa
    expect(locked.body.code).toBe('ACCOUNT_LOCKED');

    const adm = await h.token('Administrador', 'a1');
    await h.http().post(`/api/v1/users/${u.id}/unlock`).set(A(adm)).expect(201);
    await login(u.email, TEST_PASSWORD).expect(201);
  });

  it('um token adulterado, de outro segredo ou expirado é recusado', async () => {
    await h.http().get('/api/v1/me').set(A('abc.def.ghi')).expect(401);
    const { SignJWT } = await import('jose');
    const forged = await new SignJWT({ tv: 1 }).setProtectedHeader({ alg: 'HS256' }).setSubject('x').setIssuer('cpq').setExpirationTime('1h').sign(new TextEncoder().encode('outro-segredo-completamente-diferente-0123456789'));
    await h.http().get('/api/v1/me').set(A(forged)).expect(401);
  });

  it('mudar a palavra-passe termina as outras sessões e valida a política', async () => {
    const u = await h.makeUser({ role: 'Comercial', key: 'change' });
    const t1 = await h.login(u.email);
    await h.http().post('/api/v1/auth/change-password').set(A(t1)).send({ currentPassword: 'errada', newPassword: 'Nova-Pass-2026!' }).expect(422);
    await h.http().post('/api/v1/auth/change-password').set(A(t1)).send({ currentPassword: TEST_PASSWORD, newPassword: 'curta' }).expect(422);
    await h.http().post('/api/v1/auth/change-password').set(A(t1)).send({ currentPassword: TEST_PASSWORD, newPassword: TEST_PASSWORD }).expect(422);
    const ok = await h.http().post('/api/v1/auth/change-password').set(A(t1)).send({ currentPassword: TEST_PASSWORD, newPassword: 'Nova-Pass-2026!' }).expect(201);

    await h.http().get('/api/v1/me').set(A(t1)).expect(401); // a sessão antiga já não vale
    await h.http().get('/api/v1/me').set(A(ok.body.accessToken)).expect(200); // a nova sim
    await login(u.email, TEST_PASSWORD).expect(401);
    await login(u.email, 'Nova-Pass-2026!').expect(201);
  });

  it('desativar o utilizador ou mudar-lhe os papéis termina a sessão', async () => {
    const adm = await h.token('Administrador', 'a2');
    const u = await h.makeUser({ role: 'Comercial', key: 'desativar' });
    const t = await h.login(u.email);
    await h.http().patch(`/api/v1/users/${u.id}`).set(A(adm)).send({ roles: ['Gestor_Comercial'] }).expect(200);
    await h.http().get('/api/v1/me').set(A(t)).expect(401);
    const t2 = await h.login(u.email);
    expect((await h.http().get('/api/v1/me').set(A(t2))).body.roles).toEqual(['Gestor_Comercial']);
    await h.http().patch(`/api/v1/users/${u.id}`).set(A(adm)).send({ isActive: false }).expect(200);
    await h.http().get('/api/v1/me').set(A(t2)).expect(401);
    await login(u.email, TEST_PASSWORD).expect(401);
  });

  describe('administração de utilizadores', () => {
    it('só o administrador gere utilizadores', async () => {
      const com = await h.token('Comercial', 'x1');
      await h.http().get('/api/v1/users').set(A(com)).expect(403);
      await h.http().post('/api/v1/users').set(A(com)).send({ email: 'n@teste.pt', displayName: 'N', roles: ['Comercial'] }).expect(403);
    });

    it('cria com palavra-passe temporária: tem de a mudar antes de fazer o que quer que seja', async () => {
      const adm = await h.token('Administrador', 'a3');
      const created = await h.http().post('/api/v1/users').set(A(adm)).send({ email: 'Novo.Utilizador@teste.pt', displayName: 'Novo', roles: ['Comercial'] }).expect(201);
      expect(created.body.user).toMatchObject({ email: 'novo.utilizador@teste.pt', mustChangePassword: true, roles: ['Comercial'] });
      const temp = created.body.temporaryPassword as string;
      expect(temp).toBeTypeOf('string');
      await h.http().post('/api/v1/users').set(A(adm)).send({ email: 'novo.utilizador@teste.pt', displayName: 'Outra vez', roles: ['Comercial'] }).expect(409);

      const t = await login('novo.utilizador@teste.pt', temp).expect(201);
      expect(t.body.user.mustChangePassword).toBe(true);
      const blocked = await h.http().get('/api/v1/catalog/products').set(A(t.body.accessToken)).expect(403);
      expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
      await h.http().get('/api/v1/me').set(A(t.body.accessToken)).expect(200); // /me e mudar a palavra-passe continuam permitidos
      const changed = await h.http().post('/api/v1/auth/change-password').set(A(t.body.accessToken)).send({ currentPassword: temp, newPassword: 'Minha-Pass-2026!' }).expect(201);
      await h.http().get('/api/v1/catalog/products').set(A(changed.body.accessToken)).expect(200);
    });

    it('repor a palavra-passe gera uma temporária, desbloqueia e termina sessões', async () => {
      const adm = await h.token('Administrador', 'a4');
      const u = await h.makeUser({ role: 'Comercial', key: 'repor' });
      const t = await h.login(u.email);
      const r = await h.http().post(`/api/v1/users/${u.id}/reset-password`).set(A(adm)).expect(201);
      await h.http().get('/api/v1/me').set(A(t)).expect(401);
      await login(u.email, r.body.temporaryPassword).expect(201);
      await login(u.email, TEST_PASSWORD).expect(401);
    });

    it('palavras-passe fracas e equipas inexistentes são recusadas', async () => {
      const adm = await h.token('Administrador', 'a5');
      await h.http().post('/api/v1/users').set(A(adm)).send({ email: 'f@teste.pt', displayName: 'F', roles: ['Comercial'], password: 'fraca' }).expect(422);
      await h.http().post('/api/v1/users').set(A(adm)).send({ email: 'g@teste.pt', displayName: 'G', roles: ['Comercial'], teamId: '00000000-0000-4000-8000-0000000000aa' }).expect(422);
      await h.http().post('/api/v1/users').set(A(adm)).send({ email: 'h@teste.pt', displayName: 'H', roles: ['Inventado'] }).expect(400);
    });

    it('equipas: listar e criar (só o administrador)', async () => {
      const adm = await h.token('Administrador', 'a6');
      const com = await h.token('Comercial', 'x2');
      await h.http().post('/api/v1/teams').set(A(com)).send({ name: 'Centro' }).expect(403);
      await h.http().post('/api/v1/teams').set(A(adm)).send({ name: 'Centro' }).expect(201);
      await h.http().post('/api/v1/teams').set(A(adm)).send({ name: 'Centro' }).expect(409);
      expect((await h.http().get('/api/v1/teams').set(A(com)).expect(200)).body.map((t: { name: string }) => t.name)).toContain('Centro');
    });
  });

  it('toda a atividade de autenticação fica registada para auditoria', async () => {
    const actions = (await h.prisma.outboxEvent.findMany({ where: { eventType: 'audit.record' } })).map((e) => (e.payload as { action: string }).action);
    expect(actions).toEqual(expect.arrayContaining(['auth.login', 'auth.login_failed', 'auth.locked', 'auth.password_changed', 'user.created', 'user.updated', 'user.password_reset', 'user.unlocked']));
  });

  describe('último administrador', () => {
    it('o sistema nunca fica sem administradores ativos', async () => {
      await resetDb(h.prisma);
      const only = await h.makeUser({ role: 'Administrador', key: 'unico' });
      const t = await h.login(only.email);
      const down = await h.http().patch(`/api/v1/users/${only.id}`).set(A(t)).send({ isActive: false }).expect(409);
      expect(down.body.code).toBe('LAST_ADMIN');
      await h.http().patch(`/api/v1/users/${only.id}`).set(A(t)).send({ roles: ['Comercial'] }).expect(409);
      const second = await h.makeUser({ role: 'Administrador', key: 'segundo' });
      await h.http().patch(`/api/v1/users/${second.id}`).set(A(t)).send({ isActive: false }).expect(200);
    });

  });
});
