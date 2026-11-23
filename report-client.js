import { reportsConfig } from './reports-config.js';

export const reportCategories = Object.freeze({
  baches: 'Baches',
  luminarias: 'Luminarias',
  residuos: 'Residuos',
  desagues: 'Desagües',
  otros: 'Otros',
});

export const reportStatuses = Object.freeze({
  pending_review: 'Pendiente de revisión',
  published: 'Publicado',
  in_progress: 'En seguimiento',
  resolved: 'Resuelto',
  rejected: 'Rechazado',
});

export const publicStatuses = ['published', 'in_progress', 'resolved'];

const reportDate = new Intl.DateTimeFormat('es-AR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Argentina/Buenos_Aires',
});

function isLoopback(hostname) {
  return ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
}

export function reportEndpoint(endpoint) {
  if (!endpoint) return null;
  const url = new URL(endpoint, window.location.href);
  const isLocalHttp = url.protocol === 'http:' && isLoopback(url.hostname) && isLoopback(window.location.hostname);
  return url.protocol === 'https:' || isLocalHttp ? url : null;
}

export function reportHeaders() {
  const headers = { Accept: 'application/json' };
  if (reportsConfig.publishableKey?.startsWith('sb_publishable_')) {
    headers.apikey = reportsConfig.publishableKey;
  }
  return headers;
}

export function formatReportDate(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? reportDate.format(timestamp) : '';
}
