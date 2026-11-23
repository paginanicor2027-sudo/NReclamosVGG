import { createServer } from 'node:http';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { createReportDirectoryHandler } from '../supabase/functions/report-directory/handler.ts';
import { createReportHandler } from '../supabase/functions/submit-report/handler.ts';
import { createPreviewModeration, previewAuthSchema } from './preview-moderation.mjs';

const root = new URL('../', import.meta.url);
const port = Number(process.env.PORT ?? '4173');
const origin = `http://127.0.0.1:${port}`;
const basePaths = ['/ReclamosVGG/', '/NReclamosVGG/'];
const workerUrl = process.env.RECLAMOS_PREVIEW_WORKER_URL;

async function createLocalRoutes() {
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
  await db.exec(previewAuthSchema);

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

  function reportRpc(sql, parameters) {
    return db.transaction(async (transaction) => {
      await transaction.exec('set local role service_role');
      const { rows: [row] } = await transaction.query(sql, parameters);
      return row.result;
    });
  }

  const handleReport = createReportHandler({
    allowedOrigins: [origin],
    boundary,
    store: ({ requestId, category, description, latitude, longitude }) => reportRpc(
      'select public.submit_report($1::uuid, $2::text, $3::text, $4::double precision, $5::double precision) as result',
      [requestId, category, description, latitude, longitude],
    ),
  });

  const handleDirectory = createReportDirectoryHandler({
    allowedOrigins: [origin],
    store: {
      list: ({ category, status, offset }) => reportRpc(
        'select public.list_published_reports($1::text, $2::text, $3::integer) as result',
        [category, status, offset],
      ),
      track: (trackingNumber) => reportRpc('select public.track_report($1::text) as result', [trackingNumber]),
    },
  });

  const handleModeration = await createPreviewModeration(db);
  return new Map([
    ['/api/reclamos', handleReport],
    ['/api/reclamos-publicados', handleDirectory],
    ['/auth/v1/token', handleModeration],
    ['/rest/v1/report_moderators', handleModeration],
    ['/rest/v1/reports', handleModeration],
  ]);
}

const routes = workerUrl ? new Map() : await createLocalRoutes();

const assetTypes = new Map([
  ['index.html', 'text/html; charset=utf-8'],
  ['styles.css', 'text/css; charset=utf-8'],
  ['report-signals.css', 'text/css; charset=utf-8'],
  ['app.js', 'text/javascript; charset=utf-8'],
  ['admin.html', 'text/html; charset=utf-8'],
  ['admin.css', 'text/css; charset=utf-8'],
  ['admin.js', 'text/javascript; charset=utf-8'],
  ['report-client.js', 'text/javascript; charset=utf-8'],
  ['report-directory.js', 'text/javascript; charset=utf-8'],
  ['report-pictograms.js', 'text/javascript; charset=utf-8'],
  ['report-category-picker.js', 'text/javascript; charset=utf-8'],
  ['report-form.js', 'text/javascript; charset=utf-8'],
  ['report-address.js', 'text/javascript; charset=utf-8'],
  ['privacidad.html', 'text/html; charset=utf-8'],
  ['info.css', 'text/css; charset=utf-8'],
  ['reports-config.js', 'text/javascript; charset=utf-8'],
  ['assets/fondo-deportistas.jpg', 'image/jpeg'],
  ['assets/cartel-primeros-100-dias.png', 'image/png'],
  ['assets/fonts/anton-latin.woff2', 'font/woff2'],
  ['data/villa-gobernador-galvez.geojson', 'application/geo+json'],
]);

const previewOptions = workerUrl ? {
  extendedIntake: true,
  endpoint: new URL('/api/reclamos', workerUrl).href,
  directoryEndpoint: new URL('/api/reclamos-publicados', workerUrl).href,
  moderationUrl: new URL(workerUrl).origin,
} : {
  endpoint: '/api/reclamos',
  directoryEndpoint: '/api/reclamos-publicados',
  supabaseUrl: origin,
};
const previewConfig = `export const reportsConfig = ${JSON.stringify(previewOptions)};\n`;

const server = createServer(async (incoming, outgoing) => {
  const url = new URL(incoming.url, origin);
  outgoing.setHeader('cache-control', 'no-store');

  const route = routes.get(url.pathname);
  if (route) {
    const hasBody = incoming.method === 'POST' || incoming.method === 'PATCH';
    const result = await route(new Request(url, {
      method: incoming.method,
      headers: incoming.headers,
      body: hasBody ? Readable.toWeb(incoming) : null,
      duplex: 'half',
    }));
    outgoing.writeHead(result.status, Object.fromEntries(result.headers));
    outgoing.end(Buffer.from(await result.arrayBuffer()));
    return;
  }

  const basePath = basePaths.find((base) => url.pathname.startsWith(base));
  const file = url.pathname.slice(basePath?.length ?? 1) || 'index.html';
  if (!assetTypes.has(file) || !['GET', 'HEAD'].includes(incoming.method)) {
    outgoing.writeHead(404).end();
    return;
  }

  try {
    const content = file === 'reports-config.js' ? previewConfig : await readFile(new URL(file, root));
    outgoing.writeHead(200, { 'content-type': assetTypes.get(file) });
    outgoing.end(incoming.method === 'HEAD' ? undefined : content);
  } catch (error) {
    const status = error.code === 'ENOENT' ? 404 : 500;
    outgoing.writeHead(status).end();
  }
});

server.listen(port, '127.0.0.1', () => console.log(`${origin}${basePaths[0]}`));
