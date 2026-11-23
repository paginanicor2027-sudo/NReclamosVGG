import { reportsConfig } from './reports-config.js';

const maxDescriptionLength = 400;
const serviceErrors = {
  invalid_request: 'Revisá la categoría, la descripción y la ubicación antes de volver a enviar.',
  outside_municipality: 'El punto está fuera de Villa Gobernador Gálvez. Cambiá la ubicación y elegí un punto dentro del límite.',
  request_conflict: 'Este envío ya está asociado a otros datos. Revisá el reclamo antes de volver a enviarlo.',
  service_unavailable: 'El servicio de reclamos no está disponible en este momento. Tus datos siguen en el formulario. Volvé a intentar.',
  timeout: 'El servicio tardó demasiado en responder. Tus datos siguen en el formulario. Volvé a intentar.',
};

function isLoopback(hostname) {
  return ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
}

function getEndpoint() {
  const endpoint = reportsConfig.endpoint;
  if (!endpoint) return null;

  const isLocal = isLoopback(window.location.hostname);
  const url = new URL(endpoint, window.location.href);
  const isLocalHttp = isLocal && url.protocol === 'http:' && isLoopback(url.hostname);
  if (url.protocol !== 'https:' && !isLocalHttp) return null;
  return url;
}

async function postReport(endpoint, report) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };

  if (reportsConfig.publishableKey?.startsWith('sb_publishable_')) {
    headers.apikey = reportsConfig.publishableKey;
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      credentials: 'omit',
      headers,
      body: JSON.stringify(report),
      signal: controller.signal,
    });
    const result = await response.json().catch(() => null);

    if (controller.signal.aborted) return { error: 'timeout' };
    if ((response.status === 200 || response.status === 201) && result?.status === 'pending_review' &&
      typeof result.trackingNumber === 'string' && result.trackingNumber.trim()) {
      return { trackingNumber: result.trackingNumber };
    }

    return { error: Object.hasOwn(serviceErrors, result?.code) ? result.code : 'service_unavailable' };
  } catch {
    return { error: controller.signal.aborted ? 'timeout' : 'service_unavailable' };
  } finally {
    clearTimeout(timeout);
  }
}

export function initializeReportForm(map, leaflet) {
  const endpoint = getEndpoint();
  if (!endpoint) return;

  const trigger = document.getElementById('report-trigger');
  const locationPanel = document.getElementById('report-location-panel');
  const locationStatus = document.getElementById('report-location-status');
  const crosshair = document.getElementById('report-crosshair');
  const chooseCenter = document.getElementById('report-use-center');
  const continueButton = document.getElementById('report-continue');
  const cancelLocation = document.getElementById('report-cancel-location');
  const dialog = document.getElementById('report-dialog');
  const title = document.getElementById('report-dialog-title');
  const closeButton = document.getElementById('report-close');
  const form = document.getElementById('report-form');
  const changeLocation = document.getElementById('report-change-location');
  const category = document.getElementById('report-category');
  const description = document.getElementById('report-description');
  const descriptionCount = document.getElementById('report-description-count');
  const formError = document.getElementById('report-error');
  const sendingStatus = document.getElementById('report-sending');
  const submitButton = document.getElementById('report-submit');
  const confirmation = document.getElementById('report-confirmation');
  const trackingCode = document.getElementById('report-tracking-code');
  const newReport = document.getElementById('report-new');
  const mapContainer = map.getContainer();

  const marker = leaflet.circleMarker([0, 0], {
    radius: 8,
    color: '#fff',
    weight: 3,
    fillColor: '#b74929',
    fillOpacity: 1,
    interactive: false,
  });

  let selectedPoint = null;
  let candidatePoint = null;
  let selecting = false;
  let submitting = false;
  const attempts = new Map();

  function updateDescriptionCount() {
    descriptionCount.textContent = `${[...description.value.trim()].length} de ${maxDescriptionLength} caracteres`;
  }

  function showMarker(point) {
    if (point) {
      marker.setLatLng([point.latitude, point.longitude]).addTo(map);
    } else {
      marker.remove();
    }
  }

  function selectPoint({ lat, lng }) {
    candidatePoint = { latitude: Number(lat.toFixed(6)), longitude: Number(lng.toFixed(6)) };
    showMarker(candidatePoint);
    locationStatus.textContent = 'Ubicación marcada. Podés continuar.';
    continueButton.disabled = false;
  }

  function setSelecting(value) {
    selecting = value;
    locationPanel.hidden = !value;
    crosshair.hidden = !value;
    mapContainer.classList.toggle('selecting-report-location', value);
    mapContainer.setAttribute('aria-describedby', value ? 'map-instructions report-location-help' : 'map-instructions');
  }

  function startSelecting() {
    if (dialog.open) dialog.close();
    candidatePoint = selectedPoint;
    continueButton.disabled = !candidatePoint;
    locationStatus.textContent = candidatePoint ? 'Podés mantener la ubicación marcada o elegir otra.' : '';
    setSelecting(true);
    mapContainer.focus({ preventScroll: true });
  }

  function openForm() {
    setSelecting(false);
    dialog.showModal();
    title.focus();
  }

  function clearDraft() {
    form.reset();
    updateDescriptionCount();
    category.removeAttribute('aria-invalid');
    description.removeAttribute('aria-invalid');
    formError.textContent = '';
    trackingCode.textContent = '';
    title.textContent = 'Hacer un reclamo';
    form.hidden = false;
    confirmation.hidden = true;
    selectedPoint = null;
    attempts.clear();
    showMarker(null);
  }

  function closeForm() {
    if (submitting) return;
    dialog.close();
    if (!confirmation.hidden) showMarker(null);
    trigger.focus();
  }

  trigger.addEventListener('click', () => {
    if (selecting) {
      mapContainer.focus({ preventScroll: true });
      return;
    }
    if (!confirmation.hidden) clearDraft();
    if (selectedPoint) openForm();
    else startSelecting();
  });
  map.on('click', ({ latlng }) => { if (selecting) selectPoint(latlng); });
  mapContainer.addEventListener('keydown', (event) => {
    if (!selecting || event.target !== mapContainer || event.key !== 'Enter') return;
    event.preventDefault();
    selectPoint(map.getCenter());
    continueButton.focus();
  });
  chooseCenter.addEventListener('click', () => selectPoint(map.getCenter()));
  continueButton.addEventListener('click', () => {
    if (!candidatePoint) return;
    if (!selectedPoint || candidatePoint.latitude !== selectedPoint.latitude || candidatePoint.longitude !== selectedPoint.longitude) {
      formError.textContent = '';
    }
    selectedPoint = candidatePoint;
    openForm();
  });
  cancelLocation.addEventListener('click', () => {
    setSelecting(false);
    showMarker(selectedPoint);
    if (selectedPoint) openForm();
    else trigger.focus();
  });
  closeButton.addEventListener('click', closeForm);
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeForm();
  });
  changeLocation.addEventListener('click', startSelecting);
  newReport.addEventListener('click', () => {
    clearDraft();
    startSelecting();
  });

  category.addEventListener('change', () => {
    if (category.hasAttribute('aria-invalid')) formError.textContent = '';
    category.removeAttribute('aria-invalid');
  });
  description.addEventListener('input', () => {
    updateDescriptionCount();
    if (description.hasAttribute('aria-invalid')) formError.textContent = '';
    description.removeAttribute('aria-invalid');
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting || !selectedPoint) return;
    formError.textContent = '';

    if (!category.value) {
      formError.textContent = 'Elegí una categoría para tu reclamo.';
      category.setAttribute('aria-invalid', 'true');
      category.focus();
      return;
    }

    const message = description.value.trim();
    if (!message || [...message].length > maxDescriptionLength) {
      formError.textContent = 'Escribí una descripción de entre 1 y 400 caracteres.';
      description.setAttribute('aria-invalid', 'true');
      description.focus();
      return;
    }

    const payload = { category: category.value, description: message, ...selectedPoint };
    const signature = JSON.stringify(payload);
    if (!attempts.has(signature)) attempts.set(signature, crypto.randomUUID());

    submitting = true;
    submitButton.setAttribute('aria-disabled', 'true');
    submitButton.textContent = 'Enviando…';
    sendingStatus.textContent = 'Enviando tu reclamo.';
    for (const control of [category, description, changeLocation, closeButton]) control.disabled = true;

    const result = await postReport(endpoint, { requestId: attempts.get(signature), ...payload });

    submitting = false;
    submitButton.removeAttribute('aria-disabled');
    submitButton.textContent = 'Enviar reclamo';
    sendingStatus.textContent = '';
    for (const control of [category, description, changeLocation, closeButton]) control.disabled = false;

    if (result.error) {
      formError.textContent = serviceErrors[result.error];
      return;
    }

    trackingCode.textContent = result.trackingNumber;
    title.textContent = 'Reclamo recibido';
    form.hidden = true;
    confirmation.hidden = false;
    title.focus();
  });

  trigger.hidden = false;
}
