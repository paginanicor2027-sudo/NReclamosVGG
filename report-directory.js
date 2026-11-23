import { reportsConfig } from './reports-config.js';
import { formatReportDate, publicStatuses, reportCategories, reportEndpoint, reportHeaders, reportStatuses } from './report-client.js';

function addOptions(select, defaultLabel, labels, values) {
  select.add(new Option(defaultLabel, ''));
  for (const value of values) select.add(new Option(labels[value], value));
}

function markerPopup(report) {
  const popup = document.createElement('div');
  popup.className = 'report-popup';
  const category = document.createElement('strong');
  category.textContent = reportCategories[report.category];
  const description = document.createElement('p');
  description.textContent = report.description;
  const state = document.createElement('p');
  state.textContent = reportStatuses[report.status];
  const date = document.createElement('small');
  date.textContent = `Última actualización ${formatReportDate(report.updatedAt)}`;
  popup.append(category, description, state, date);
  return popup;
}

function initializeMapReports(endpoint, map, leaflet) {
  const category = document.getElementById('public-category');
  const state = document.getElementById('public-status');
  const message = document.getElementById('directory-status');
  addOptions(category, 'Todas las categorías', reportCategories, Object.keys(reportCategories));
  addOptions(state, 'Todos los estados', reportStatuses, publicStatuses);

  const markers = leaflet.layerGroup().addTo(map);
  let currentLoad;
  async function loadReports() {
    currentLoad?.abort();
    const load = new AbortController();
    currentLoad = load;
    message.textContent = 'Cargando reclamos…';
    markers.clearLayers();
    const url = new URL(endpoint);
    if (category.value) url.searchParams.set('category', category.value);
    if (state.value) url.searchParams.set('status', state.value);

    try {
      const reports = [];
      let offset = 0;
      while (offset !== null) {
        url.searchParams.set('offset', String(offset));
        const response = await fetch(url, {
          headers: reportHeaders(),
          credentials: 'omit',
          signal: AbortSignal.any([load.signal, AbortSignal.timeout(12000)]),
        });
        if (!response.ok) throw new Error('Directory request failed');
        const page = await response.json();
        if (!Array.isArray(page.reports) || (page.nextOffset !== null &&
          (!Number.isSafeInteger(page.nextOffset) || page.nextOffset <= offset))) {
          throw new Error('Invalid directory page');
        }
        reports.push(...page.reports);
        offset = page.nextOffset;
      }

      if (currentLoad !== load) return;
      let count = 0;
      for (const report of reports) {
        if (!Object.hasOwn(reportCategories, report.category) || !publicStatuses.includes(report.status) ||
          !Number.isFinite(report.latitude) || !Number.isFinite(report.longitude)) continue;
        const label = `${reportCategories[report.category]} · ${reportStatuses[report.status]}`;
        const icon = leaflet.divIcon({
          className: `report-pin report-pin--${report.status}`,
          iconSize: [20, 20],
        });
        leaflet.marker([report.latitude, report.longitude], { icon, title: label })
          .bindPopup(markerPopup(report)).addTo(markers);
        count++;
      }
      message.textContent = count === 0 ? 'Sin reclamos para mostrar.' :
        `${count} ${count === 1 ? 'reclamo visible' : 'reclamos visibles'}`;
    } catch {
      if (currentLoad === load) message.textContent = 'No se pudieron cargar los reclamos. Volvé a intentar.';
    }
  }

  category.addEventListener('change', loadReports);
  state.addEventListener('change', loadReports);
  loadReports();
}

function initializeTracking(endpoint) {
  const trigger = document.getElementById('tracking-trigger');
  const dialog = document.getElementById('tracking-dialog');
  const close = document.getElementById('tracking-close');
  const form = document.getElementById('tracking-form');
  const input = document.getElementById('tracking-input');
  const submit = document.getElementById('tracking-submit');
  const result = document.getElementById('tracking-result');
  let currentLookup;

  trigger.addEventListener('click', () => {
    dialog.showModal();
    input.focus();
  });
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    currentLookup?.abort();
    currentLookup = null;
    submit.disabled = false;
    result.textContent = '';
    trigger.focus();
  });
  input.addEventListener('input', () => {
    input.removeAttribute('aria-invalid');
    result.textContent = '';
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (currentLookup) return;
    const trackingNumber = input.value.trim().toUpperCase();
    if (!/^VGG-[0-9A-F]{16}$/.test(trackingNumber)) {
      input.setAttribute('aria-invalid', 'true');
      result.textContent = 'Ingresá un código de seguimiento válido.';
      input.focus();
      return;
    }

    const lookup = new AbortController();
    currentLookup = lookup;
    submit.disabled = true;
    input.readOnly = true;
    result.textContent = 'Consultando…';
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { ...reportHeaders(), 'Content-Type': 'application/json' },
        credentials: 'omit',
        body: JSON.stringify({ trackingNumber }),
        signal: AbortSignal.any([lookup.signal, AbortSignal.timeout(12000)]),
      });
      const data = await response.json();
      if (currentLookup !== lookup) return;
      if (response.status === 404 && data.code === 'report_not_found') {
        result.textContent = 'No encontramos un reclamo con ese código.';
      } else if (response.ok && Object.hasOwn(reportStatuses, data.status)) {
        result.textContent = `${reportStatuses[data.status]}. Última actualización ${formatReportDate(data.updatedAt)}`;
      } else {
        throw new Error('Tracking request failed');
      }
    } catch {
      if (currentLookup === lookup) result.textContent = 'No se pudo consultar el reclamo. Volvé a intentar.';
    } finally {
      if (currentLookup === lookup) {
        currentLookup = null;
        submit.disabled = false;
      }
      if (!currentLookup) input.readOnly = false;
    }
  });
}

export function initializeReportDirectory(map, leaflet) {
  const endpoint = reportEndpoint(reportsConfig.directoryEndpoint);
  if (!endpoint) return;
  document.getElementById('report-directory').hidden = false;
  initializeMapReports(endpoint, map, leaflet);
  initializeTracking(endpoint);
}
