import { createServer } from 'node:http';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { createReportHandler } from '../supabase/functions/submit-report/handler.ts';

const root = new URL('../', import.meta.url);
const port = Number(process.env.PORT ?? '4173');
const origin = `http://127.0.0.1:${port}`;
const basePath = '/NReclamosVGG';
const dataDirectory = new URL('.local/', root);
const migrations = new URL('supabase/migrations/', root);
const boundary = JSON.parse(await readFile(new URL('data/villa-gobernador-galvez.geojson', root), 'utf8'));

await mkdir(dataDirectory, { recursive: true });
const db = new PGlite(fileURLToPath(new URL('reports-db', dataDirectory)));
await db.exec(`
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'service_role') then
      create role service_role bypassrls;
      create role anon;
      create role authenticated;
    end if;
  end $$;
  create schema if not exists preview;
  create table if not exists preview.migrations (name text primary key);
`);

const { rows: appliedMigrations } = await db.query('select name from preview.migrations');
const appliedNames = new Set(appliedMigrations.map(({ name }) => name));
for (const file of (await readdir(migrations)).sort()) {
  if (!file.endsWith('.sql') || appliedNames.has(file)) continue;
  const sql = await readFile(new URL(file, migrations), 'utf8');
  await db.transaction(async (transaction) => {
    await transaction.exec(sql);
    await transaction.query('insert into preview.migrations (name) values ($1)', [file]);
  });
}

const handleReport = createReportHandler({
  allowedOrigins: [origin],
  boundary,
  store: ({ requestId, category, description, latitude, longitude }) => db.transaction(async (transaction) => {
    await transaction.exec('set local role service_role');
    const { rows: [row] } = await transaction.query(
      'select public.submit_report($1::uuid, $2::text, $3::text, $4::double precision, $5::double precision) as result',
      [requestId, category, description, latitude, longitude],
    );
    return row.result;
  }),
});

const assetTypes = new Map([
  ['index.html', 'text/html; charset=utf-8'],
  ['styles.css', 'text/css; charset=utf-8'],
  ['app.js', 'text/javascript; charset=utf-8'],
  ['report-form.js', 'text/javascript; charset=utf-8'],
  ['reports-config.js', 'text/javascript; charset=utf-8'],
  ['data/villa-gobernador-galvez.geojson', 'application/geo+json'],
]);

const server = createServer(async (incoming, outgoing) => {
  const url = new URL(incoming.url, origin);
  outgoing.setHeader('cache-control', 'no-store');

  if (url.pathname === '/api/reclamos') {
    const hasBody = !['GET', 'HEAD'].includes(incoming.method);
    const result = await handleReport(new Request(url, {
      method: incoming.method,
      headers: incoming.headers,
      body: hasBody ? Readable.toWeb(incoming) : null,
      duplex: 'half',
    }));
    outgoing.writeHead(result.status, Object.fromEntries(result.headers));
    outgoing.end(Buffer.from(await result.arrayBuffer()));
    return;
  }

  const pathname = url.pathname.startsWith(`${basePath}/`) ? url.pathname.slice(basePath.length) : url.pathname;
  const file = pathname.slice(1) || 'index.html';
  if (!assetTypes.has(file) || !['GET', 'HEAD'].includes(incoming.method)) {
    outgoing.writeHead(404).end();
    return;
  }

  try {
    const content = file === 'reports-config.js'
      ? "export const reportsConfig = { endpoint: '/api/reclamos' };\n"
      : await readFile(new URL(file, root));
    outgoing.writeHead(200, { 'content-type': assetTypes.get(file) });
    outgoing.end(incoming.method === 'HEAD' ? undefined : content);
  } catch (error) {
    const status = error.code === 'ENOENT' ? 404 : 500;
    outgoing.writeHead(status).end();
  }
});

server.listen(port, '127.0.0.1', () => console.log(`${origin}${basePath}/`));
