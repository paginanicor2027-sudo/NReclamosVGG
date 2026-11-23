// Only public settings belong in this file.
const workerUrl = 'https://reclamosvgg.paginanicor2027.workers.dev';

export const reportsConfig = {
  extendedIntake: true,
  endpoint: `${workerUrl}/api/reclamos`,
  directoryEndpoint: `${workerUrl}/api/reclamos-publicados`,
  moderationUrl: workerUrl,
  supabaseUrl: '',
  publishableKey: '',
};
