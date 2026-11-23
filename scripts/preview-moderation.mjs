import { randomUUID } from 'node:crypto';

export const previewAuthSchema = `
  create schema if not exists auth;
  create table if not exists auth.users (id uuid primary key);
  create or replace function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to authenticated;
`;

const moderator = { id: '00000000-0000-4000-8000-000000000001', email: 'moderador@reclamosvgg.test', password: 'reclamos-local' };
const resident = { id: '00000000-0000-4000-8000-000000000002', email: 'vecino@reclamosvgg.test', password: 'vecino-local' };
const sessionLifetime = 3600;

export async function createPreviewModeration(db) {
  await db.query('insert into auth.users (id) values ($1), ($2) on conflict do nothing', [moderator.id, resident.id]);
  await db.query('insert into public.report_moderators (user_id) values ($1) on conflict do nothing', [moderator.id]);
  const sessions = new Map();

  function queryAsUser(user, sql, params = []) {
    return db.transaction(async (transaction) => {
      await transaction.exec('set local role authenticated');
      await transaction.query("select set_config('request.jwt.claim.sub', $1, true)", [user.id]);
      const { rows } = await transaction.query(sql, params);
      return rows;
    });
  }

  return async (request) => {
    const { pathname, searchParams } = new URL(request.url);
    try {
      if (pathname === '/auth/v1/token' && request.method === 'POST' && searchParams.get('grant_type') === 'password') {
        const { email, password } = await request.json();
        const account = [moderator, resident].find((user) => user.email === email && user.password === password);
        if (!account) return Response.json({ error: 'invalid_credentials' }, { status: 400 });
        const accessToken = randomUUID();
        sessions.set(accessToken, { id: account.id, expiresAt: Date.now() + sessionLifetime * 1000 });
        return Response.json({ access_token: accessToken, expires_in: sessionLifetime });
      }

      const token = request.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
      const user = sessions.get(token);
      if (!user || user.expiresAt <= Date.now()) {
        sessions.delete(token);
        return Response.json({ error: 'unauthorized' }, { status: 401 });
      }

      if (pathname === '/rest/v1/report_moderators' && request.method === 'GET') {
        return Response.json(await queryAsUser(user, 'select user_id from public.report_moderators limit 1'));
      }
      if (pathname === '/rest/v1/reports' && request.method === 'GET') {
        const status = searchParams.get('status')?.slice(3) ?? null;
        const offset = Number(searchParams.get('offset') ?? 0);
        const rows = await queryAsUser(user, `
          select request_id, tracking_number, category, description, latitude, longitude, status, created_at, updated_at
          from public.reports where $1::text is null or status = $1
          order by created_at desc, request_id desc limit 100 offset $2`, [status, offset]);
        return Response.json(rows);
      }
      if (pathname === '/rest/v1/reports' && request.method === 'PATCH') {
        const { status } = await request.json();
        const requestId = searchParams.get('request_id')?.slice(3);
        const expected = searchParams.get('status')?.slice(3);
        if (!requestId || !expected) return Response.json({ error: 'invalid_request' }, { status: 400 });
        const rows = await queryAsUser(user, `
          update public.reports set status = $1 where request_id = $2 and status = $3
          returning status, updated_at`, [status, requestId, expected]);
        return Response.json(rows);
      }
      return Response.json({ error: 'not_found' }, { status: 404 });
    } catch {
      return Response.json({ error: 'invalid_request' }, { status: 400 });
    }
  };
}
