import { reportsConfig } from './reports-config.js?v=vecinos-2';
import { formatReportDate, publicStatuses, reportCategories, reportCategoryOption, reportEndpoint, reportHeaders, reportStatuses } from './report-client.js?v=categorias-1';
import { createReportCategorySign } from './report-pictograms.js?v=selector-1';
import { initializeReportCategoryPicker } from './report-category-picker.js?v=selector-1';

const publicIdPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
function addOptions(select, defaultLabel, labels, values, displayLabel = (value) => labels[value]) {
  select.add(new Option(defaultLabel, ''));
  for (const value of values) {
    const option = new Option(displayLabel(value), value);
    option.setAttribute('aria-label', labels[value]);
    select.add(option);
  }
}

function appendText(parent, tag, text, className = '') {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  parent.append(element);
}

function appendCategoryTitle(parent, category, className) {
  const title = document.createElement('strong');
  title.classList.add('report-category-title');
  if (className) title.classList.add(className);
  title.append(createReportCategorySign(category, true), reportCategories[category]);
  parent.append(title);
}

function signalIcon(leaflet, category, status) {
  return leaflet.divIcon({
    className: `report-signal-marker report-signal-marker--${status}`,
    html: createReportCategorySign(category),
    iconSize: [40, 40],
    iconAnchor: [20, 20],
    popupAnchor: [0, -19],
  });
}

function markerPopup(report, endpoint) {
  const popup = document.createElement('div');
  popup.className = 'report-popup';

  appendCategoryTitle(popup, report.category);
  appendText(popup, 'p', report.description);
  if (report.locationLabel) appendText(popup, 'p', report.locationLabel);
  appendText(popup, 'p', reportStatuses[report.status]);
  if (report.previouslyReported === true) appendText(popup, 'p', 'Informado previamente por otro canal');
  const date = formatReportDate(report.updatedAt);
  if (date) appendText(popup, 'small', `Última actualización ${date}`);

  if (publicIdPattern.test(report.photoId ?? '')) {
    const url = new URL('/api/reclamos-foto', endpoint);
    url.searchParams.set('id', report.photoId);
    const image = document.createElement('img');
    image.className = 'report-popup-photo';
    image.alt = 'Foto adjunta al reclamo';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.crossOrigin = 'anonymous';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => image.remove(), { once: true });
    image.src = url.href;
    popup.append(image);
  }

  if (publicIdPattern.test(report.publicId ?? '')) {
    const shared = new URL(window.location.pathname, window.location.origin);
    shared.searchParams.set('reclamo', report.publicId);
    const whatsapp = new URL('https://wa.me/');
    whatsapp.searchParams.set('text', `ReclamosVGG · ${reportCategories[report.category]}\n${shared.href}`);
    const link = document.createElement('a');
    link.className = 'report-popup-share';
    link.href = whatsapp.href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Compartir por WhatsApp';
    popup.append(link);
  }
  return popup;
}

function normalizeSearch(value) {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('es-AR');
}

function countReports(count) {
  return `${count} ${count === 1 ? 'reclamo' : 'reclamos'}`;
}

function initializeMapReports(endpoint, map, leaflet) {
  const category = document.getElementById('public-category');
  const state = document.getElementById('public-status');
  const message = document.getElementById('directory-status');
  const toggle = document.getElementById('directory-view-toggle');
  const retry = document.getElementById('directory-retry');
  const panel = document.getElementById('directory-list-panel');
  const search = document.getElementById('directory-search');
  const listMessage = document.getElementById('directory-list-status');
  const list = document.getElementById('directory-list');
  addOptions(category, 'Todas las categorías', reportCategories, Object.keys(reportCategories), reportCategoryOption);
  initializeReportCategoryPicker(category, (key) => createReportCategorySign(key, true));
  addOptions(state, 'Todos los estados', reportStatuses, publicStatuses);

  const markers = leaflet.layerGroup().addTo(map);
  const requestedId = new URLSearchParams(window.location.search).get('reclamo');
  let sharedId = publicIdPattern.test(requestedId ?? '') ? requestedId.toLowerCase() : null;
  let currentLoad;
  let entries = [];
  let loading = false;
  let failed = false;

  function showList(visible) {
    panel.hidden = !visible;
    toggle.setAttribute('aria-expanded', String(visible));
    toggle.textContent = visible ? 'Ver mapa' : 'Ver lista';
    renderList();
  }

  function openReport(marker, focus = false) {
    showList(false);
    map.getContainer().scrollIntoView({ block: 'nearest' });
    map.setView(marker.getLatLng(), Math.max(16, map.getZoom()), { animate: false });
    if (focus) marker.getElement()?.focus({ preventScroll: true });
    marker.openPopup();
  }

  function renderList() {
    if (panel.hidden) return;
    list.replaceChildren();
    if (loading || failed) {
      listMessage.textContent = loading ? 'Cargando la lista…' : 'La lista no está disponible.';
      return;
    }

    const words = normalizeSearch(search.value.trim()).split(/\s+/).filter(Boolean);
    const matches = entries.filter(({ searchable }) => words.every((word) => searchable.includes(word)));
    if (matches.length > 0) listMessage.textContent = countReports(matches.length);
    else listMessage.textContent = words.length > 0 ? 'No encontramos reclamos con esa búsqueda.' : 'Sin reclamos para mostrar.';
    const rows = document.createDocumentFragment();
    for (const { report, marker } of matches) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.className = 'directory-list-button';
      button.type = 'button';
      appendCategoryTitle(button, report.category, 'directory-list-title');
      appendText(button, 'span', report.description, 'directory-list-description');
      appendText(button, 'span', [report.locationLabel, reportStatuses[report.status], formatReportDate(report.updatedAt)]
        .filter(Boolean).join(' · '), 'directory-list-meta');
      button.addEventListener('click', () => openReport(marker, true));
      item.append(button);
      rows.append(item);
    }
    list.append(rows);
  }

  async function loadReports() {
    currentLoad?.abort();
    const load = new AbortController();
    currentLoad = load;
    entries = [];
    loading = true;
    failed = false;
    message.textContent = 'Cargando reclamos…';
    retry.hidden = true;
    markers.clearLayers();
    renderList();
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
      for (const report of reports) {
        if (!report || !Object.hasOwn(reportCategories, report.category) || !publicStatuses.includes(report.status) ||
          !Number.isFinite(report.latitude) || !Number.isFinite(report.longitude) || typeof report.description !== 'string') continue;
        const label = `${reportCategories[report.category]} · ${reportStatuses[report.status]}`;
        const marker = leaflet.marker([report.latitude, report.longitude], {
          icon: signalIcon(leaflet, report.category, report.status),
          title: label,
        }).bindPopup(() => markerPopup(report, endpoint));
        marker.on('add', () => marker.getElement()?.setAttribute('aria-label', label));
        marker.addTo(markers);
        const searchable = normalizeSearch([reportCategories[report.category], report.description, report.locationLabel]
          .filter(Boolean).join(' '));
        entries.push({ report, marker, searchable });
      }
      message.textContent = entries.length === 0 ? 'Sin reclamos para mostrar.' : `${countReports(entries.length)} en el mapa`;
      if (sharedId) {
        const match = entries.find(({ report }) => typeof report.publicId === 'string' && report.publicId.toLowerCase() === sharedId);
        sharedId = null;
        if (match) openReport(match.marker);
        else message.textContent = 'Ese reclamo ya no está disponible en el mapa.';
      }
    } catch {
      if (currentLoad !== load) return;
      failed = true;
      message.textContent = 'No pudimos cargar los reclamos.';
      retry.hidden = false;
    } finally {
      if (currentLoad === load) {
        loading = false;
        renderList();
      }
    }
  }

  for (const select of [category, state]) {
    select.addEventListener('change', () => {
      sharedId = null;
      loadReports();
    });
  }
  toggle.addEventListener('click', () => showList(panel.hidden));
  search.addEventListener('input', renderList);
  retry.addEventListener('click', loadReports);
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
