import { reportsConfig } from './reports-config.js?v=vecinos-2';
import { reportCategories, reportEndpoint, reportHeaders } from './report-client.js?v=vecinos-2';

const maxDescriptionLength = 400;
const maxPhotoBytes = 180 * 1024;
const photoTypes = ['image/jpeg', 'image/png', 'image/webp'];
const draftKey = 'reclamosvgg:report-draft';
const serviceErrors = {
  invalid_request: 'Revisá los datos y la foto antes de volver a enviar.',
  outside_municipality: 'El punto está fuera de Villa Gobernador Gálvez. Cambiá la ubicación y elegí un punto dentro del límite.',
  request_conflict: 'Este envío ya está asociado a otros datos. Revisá el reclamo antes de volver a enviarlo.',
  service_unavailable: 'El servicio de reclamos no está disponible en este momento. Tus datos siguen en el formulario. Volvé a intentar.',
  timeout: 'El servicio tardó demasiado en responder. Tus datos siguen en el formulario. Volvé a intentar.',
};

function locateInRing(ring, latitude, longitude) {
  const tolerance = 1e-10;
  let inside = false;
  for (let index = 1; index < ring.length; index++) {
    const [startX, startY] = ring[index - 1];
    const [endX, endY] = ring[index];
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const cross = deltaX * (latitude - startY) - deltaY * (longitude - startX);
    if (Math.abs(cross) <= tolerance * Math.max(Math.abs(deltaX), Math.abs(deltaY)) &&
      longitude >= Math.min(startX, endX) - tolerance && longitude <= Math.max(startX, endX) + tolerance &&
      latitude >= Math.min(startY, endY) - tolerance && latitude <= Math.max(startY, endY) + tolerance) {
      return 'boundary';
    }
    if ((startY > latitude) !== (endY > latitude) && longitude < startX + (latitude - startY) * deltaX / deltaY) {
      inside = !inside;
    }
  }
  return inside ? 'inside' : 'outside';
}

function outsideMunicipality(boundary, point) {
  if (!boundary) return false;
  return !boundary.features.some(({ geometry }) => {
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    return polygons.some(([outer, ...holes]) => {
      const locate = (ring) => locateInRing(ring, point.latitude, point.longitude);
      const result = locate(outer);
      return result === 'boundary' || (result === 'inside' && !holes.some((hole) => locate(hole) === 'inside'));
    });
  });
}

async function preparePhoto(file) {
  const image = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { alpha: false });
  try {
    for (const [edge, quality] of [[1280, 0.83], [1280, 0.67], [960, 0.65], [720, 0.58]]) {
      const scale = Math.min(1, edge / Math.max(image.width, image.height));
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const jpeg = canvas.toDataURL('image/jpeg', quality);
      if (jpeg.startsWith('data:image/jpeg;base64,') && jpeg.split(',')[1].length <= (maxPhotoBytes / 3) * 4) return jpeg;
    }
    throw new Error('Photo too large');
  } finally {
    image.close();
  }
}

async function postReport(endpoint, report) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  const headers = { ...reportHeaders(), 'Content-Type': 'application/json' };

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

export function initializeReportForm(map, leaflet, boundary) {
  const endpoint = reportEndpoint(reportsConfig.endpoint);
  if (!endpoint) return;

  const extendedIntake = reportsConfig.extendedIntake === true;
  const get = (id) => document.getElementById(`report-${id}`);
  const trigger = get('trigger');
  const locationPanel = get('location-panel');
  const locationStatus = get('location-status');
  const crosshair = get('crosshair');
  const chooseCenter = get('use-center');
  const useGps = get('use-gps');
  const useWizardGps = get('use-gps-in-form');
  const gpsStatus = get('gps-status');
  const continueLocation = get('continue');
  const cancelLocation = get('cancel-location');
  const dialog = get('dialog');
  const title = get('dialog-title');
  const closeButton = get('close');
  const form = get('form');
  const draftRestored = get('draft-restored');
  const stepLabel = get('step-label');
  const stepProgress = get('step-progress');
  const changeLocation = get('change-location');
  const locationLabel = get('location-label');
  const pointSummary = get('point-summary');
  const category = get('category');
  const description = get('description');
  const descriptionCount = get('description-count');
  const previouslyReported = get('previously-reported');
  const fileInput = get('photo');
  const photoStatus = get('photo-status');
  const photoPreview = get('photo-preview');
  const photoImage = get('photo-image');
  const contactOptIn = get('contact-opt-in');
  const contactFields = get('contact-fields');
  const contactName = get('contact-name');
  const contactEmail = get('contact-email');
  const contactPhone = get('contact-phone');
  const formError = get('error');
  const sendingStatus = get('sending');
  const backButton = get('back');
  const submitButton = get('submit');
  const confirmation = get('confirmation');
  const trackingCode = get('tracking-code');
  const copyButton = get('copy-code');
  const copyStatus = get('copy-status');
  const mapContainer = map.getContainer();
  const stepNames = { photo: 'Foto', details: 'Detalles', location: 'Ubicación', review: 'Revisión y contacto' };
  const steps = extendedIntake ? Object.keys(stepNames) : ['details', 'location', 'review'];
  if (!extendedIntake) {
    stepNames.review = 'Revisión';
    for (const field of form.querySelectorAll('[data-intake-extra]')) field.hidden = true;
  }
  for (const [value, label] of Object.entries(reportCategories)) category.add(new Option(label, value));
  const gpsButtons = [useGps, useWizardGps];
  for (const button of gpsButtons) button.hidden = !navigator.geolocation;
  copyButton.hidden = !navigator.clipboard?.writeText;

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
  let step = steps[0];
  let photo = '';
  let photoTask = null;
  let gpsRequest = null;
  let addressPointLabel = '';
  const attempts = new Map();

  function updateDescriptionCount() {
    descriptionCount.textContent = `${[...description.value.trim()].length} de ${maxDescriptionLength} caracteres`;
  }

  function readPoint(lat, lng) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    const point = { latitude: Number(lat.toFixed(6)), longitude: Number(lng.toFixed(6)) };
    return outsideMunicipality(boundary, point) ? null : point;
  }

  function persistDraft() {
    try {
      sessionStorage.setItem(draftKey, JSON.stringify({
        step,
        category: category.value,
        description: [...description.value].slice(0, maxDescriptionLength).join(''),
        locationLabel: extendedIntake ? locationLabel.value : '',
        autoAddress: extendedIntake && locationLabel.value === addressPointLabel,
        previouslyReported: extendedIntake && previouslyReported.checked,
        point: selectedPoint,
      }));
    } catch { /* The form remains usable if session storage is unavailable. */ }
  }

  function restoreDraft() {
    try {
      const draft = JSON.parse(sessionStorage.getItem(draftKey));
      if (!draft || !steps.includes(draft.step)) return;
      category.value = Object.hasOwn(reportCategories, draft.category) ? draft.category : '';
      description.value = typeof draft.description === 'string' ? draft.description.slice(0, maxDescriptionLength * 2) : '';
      if (extendedIntake && typeof draft.locationLabel === 'string') locationLabel.value = draft.locationLabel.slice(0, 120);
      if (draft.autoAddress === true) addressPointLabel = locationLabel.value;
      previouslyReported.checked = extendedIntake && draft.previouslyReported === true;
      selectedPoint = readPoint(draft.point?.latitude, draft.point?.longitude);
      if (draft.step === 'review' && !selectedPoint) step = 'location';
      else step = draft.step;
      if (!category.value || !description.value.trim()) step = steps[Math.min(steps.indexOf(step), steps.indexOf('details'))];
      if (step !== steps[0] || category.value || description.value || selectedPoint) {
        if (!extendedIntake) get('draft-note').textContent = 'Recuperamos tu borrador.';
        draftRestored.hidden = false;
      }
    } catch { /* Invalid or unavailable storage is ignored. */ }
    updateDescriptionCount();
  }

  function removeDraft() {
    try { sessionStorage.removeItem(draftKey); } catch { /* Storage is optional. */ }
    draftRestored.hidden = true;
  }

  function syncPointSummary() {
    pointSummary.textContent = selectedPoint ? 'Punto marcado en el mapa.' : 'Todavía no elegiste un punto.';
    changeLocation.textContent = selectedPoint ? 'Cambiar el punto' : 'Marcar en el mapa';
  }

  function renderReview() {
    get('review-category').textContent = reportCategories[category.value] ?? '';
    get('review-description').textContent = description.value.trim();
    get('review-location').textContent = (extendedIntake && locationLabel.value.trim()) || 'Punto marcado en el mapa';
    get('review-photo').textContent = photo ? 'Foto adjunta' : 'Sin foto';
    get('review-previous').textContent = previouslyReported.checked ? 'Ya se hizo un reclamo por este problema' : 'Sin reclamo anterior indicado';
  }

  function renderStep(focus = true) {
    const index = steps.indexOf(step);
    for (const name of Object.keys(stepNames)) get(`step-${name}`).hidden = name !== step;
    stepLabel.textContent = `Paso ${index + 1} de ${steps.length} · ${stepNames[step]}`;
    stepProgress.max = steps.length;
    stepProgress.value = index + 1;
    backButton.hidden = index === 0;
    submitButton.disabled = step === 'photo' && photoTask !== null;
    submitButton.textContent = step === 'review' ? 'Enviar reclamo' : 'Siguiente';
    formError.textContent = '';
    syncPointSummary();
    if (step === 'review') renderReview();
    if (focus) get(`step-${step}`).querySelector('h3').focus();
  }

  function showMarker(point) {
    if (point) {
      marker.setLatLng([point.latitude, point.longitude]).addTo(map);
    } else {
      marker.remove();
    }
  }

  function cancelGps() {
    gpsRequest = null;
    for (const button of gpsButtons) button.disabled = false;
  }

  function requestGps(status, onPoint) {
    const request = {};
    gpsRequest = request;
    for (const button of gpsButtons) button.disabled = true;
    status.textContent = 'Buscando tu ubicación…';
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      if (gpsRequest !== request) return;
      cancelGps();
      const point = readPoint(coords.latitude, coords.longitude);
      if (!point) {
        status.textContent = 'Tu ubicación está fuera de Villa Gobernador Gálvez. Marcá un punto dentro de la ciudad.';
        return;
      }
      map.panTo([point.latitude, point.longitude]);
      onPoint(point);
    }, () => {
      if (gpsRequest !== request) return;
      cancelGps();
      status.textContent = 'No pudimos obtener tu ubicación. Podés marcar el punto en el mapa.';
    }, { timeout: 12000, maximumAge: 60000 });
  }

  function selectPoint({ lat, lng }) {
    cancelGps();
    const point = readPoint(lat, lng);
    if (!point) {
      candidatePoint = null;
      showMarker(null);
      continueLocation.disabled = true;
      locationStatus.textContent = 'Elegí un punto dentro de Villa Gobernador Gálvez.';
      return false;
    }
    candidatePoint = point;
    showMarker(candidatePoint);
    locationStatus.textContent = 'Ubicación marcada. Podés continuar.';
    continueLocation.disabled = false;
    return true;
  }

  function setSelecting(value) {
    selecting = value;
    locationPanel.hidden = !value;
    crosshair.hidden = !value;
    mapContainer.classList.toggle('selecting-report-location', value);
    mapContainer.setAttribute('aria-describedby', value ? 'map-instructions report-location-help' : 'map-instructions');
    if (!value) cancelGps();
  }

  function startSelecting() {
    cancelGps();
    gpsStatus.textContent = '';
    if (dialog.open) dialog.close();
    candidatePoint = selectedPoint;
    showMarker(candidatePoint);
    continueLocation.disabled = !candidatePoint;
    locationStatus.textContent = candidatePoint ? 'Podés mantener la ubicación marcada o elegir otra.' : '';
    setSelecting(true);
    mapContainer.focus({ preventScroll: true });
  }

  function openForm() {
    setSelecting(false);
    dialog.showModal();
    renderStep();
  }

  function setPhoto(image) {
    photo = image;
    photoPreview.hidden = !photo;
    if (photo) photoImage.src = photo;
    else photoImage.removeAttribute('src');
  }

  function updateContactFields() {
    contactFields.hidden = !contactOptIn.checked;
    if (!contactOptIn.checked) {
      for (const field of [contactName, contactEmail, contactPhone]) {
        field.value = '';
        field.removeAttribute('aria-invalid');
      }
    }
  }

  function clearDraft() {
    cancelGps();
    gpsStatus.textContent = '';
    form.reset();
    step = steps[0];
    photoTask = null;
    setPhoto('');
    photoStatus.textContent = '';
    updateContactFields();
    updateDescriptionCount();
    category.removeAttribute('aria-invalid');
    description.removeAttribute('aria-invalid');
    formError.textContent = '';
    trackingCode.textContent = '';
    copyStatus.textContent = '';
    title.textContent = 'Hacer un reclamo';
    form.hidden = false;
    confirmation.hidden = true;
    selectedPoint = null;
    addressPointLabel = '';
    attempts.clear();
    showMarker(null);
    removeDraft();
  }

  function closeForm() {
    if (submitting) return;
    cancelGps();
    gpsStatus.textContent = '';
    dialog.close();
    showMarker(null);
    trigger.focus();
  }

  trigger.addEventListener('click', () => {
    if (selecting) {
      mapContainer.focus({ preventScroll: true });
      return;
    }
    if (!confirmation.hidden) clearDraft();
    openForm();
  });
  map.on('click', ({ latlng }) => { if (selecting) selectPoint(latlng); });
  mapContainer.addEventListener('keydown', (event) => {
    if (!selecting || event.target !== mapContainer) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelLocation.click();
      return;
    }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (selectPoint(map.getCenter())) continueLocation.focus();
  });
  chooseCenter.addEventListener('click', () => selectPoint(map.getCenter()));
  useGps.addEventListener('click', () => {
    requestGps(locationStatus, (point) => {
      selectPoint({ lat: point.latitude, lng: point.longitude });
      continueLocation.focus();
    });
  });

  function storePoint(point) {
    if (selectedPoint && (selectedPoint.latitude !== point.latitude || selectedPoint.longitude !== point.longitude)) {
      if (locationLabel.value === addressPointLabel) locationLabel.value = '';
      addressPointLabel = '';
    }
    selectedPoint = point;
    persistDraft();
  }

  useWizardGps.addEventListener('click', () => {
    requestGps(gpsStatus, (point) => {
      storePoint(point);
      showMarker(point);
      syncPointSummary();
      formError.textContent = '';
      gpsStatus.textContent = 'Ubicación marcada. Podés cambiar el punto o seguir.';
    });
  });

  continueLocation.addEventListener('click', () => {
    if (!candidatePoint) return;
    storePoint(candidatePoint);
    openForm();
  });
  cancelLocation.addEventListener('click', () => {
    showMarker(selectedPoint);
    openForm();
  });
  closeButton.addEventListener('click', closeForm);
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeForm();
  });
  changeLocation.addEventListener('click', startSelecting);
  function restartForm() {
    clearDraft();
    renderStep();
  }
  get('new').addEventListener('click', restartForm);
  get('discard-draft').addEventListener('click', restartForm);
  copyButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(trackingCode.textContent);
      copyStatus.textContent = 'Código copiado.';
    } catch {
      copyStatus.textContent = 'Seleccioná el código para copiarlo.';
    }
  });

  get('remove-photo').addEventListener('click', () => {
    fileInput.value = '';
    setPhoto('');
    photoStatus.textContent = '';
    fileInput.focus();
  });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    photoTask = null;
    submitButton.disabled = false;
    setPhoto('');
    if (!photoTypes.includes(file.type) || file.size > 15 * 1024 * 1024) {
      photoStatus.textContent = 'Elegí una foto JPG, PNG o WebP de hasta 15 MB.';
      fileInput.value = '';
      return;
    }
    const task = preparePhoto(file);
    photoTask = task;
    submitButton.disabled = true;
    photoStatus.textContent = 'Preparando la foto…';
    try {
      const compressed = await task;
      if (photoTask !== task) return;
      setPhoto(compressed);
      photoStatus.textContent = 'Foto lista para adjuntar.';
    } catch {
      if (photoTask !== task) return;
      photoStatus.textContent = 'No se pudo preparar la foto. Probá con otra imagen o continuá sin adjuntarla.';
    } finally {
      if (photoTask === task) {
        photoTask = null;
        fileInput.value = '';
        submitButton.disabled = false;
      }
    }
  });
  contactOptIn.addEventListener('change', updateContactFields);
  for (const control of [category, description, locationLabel, previouslyReported]) {
    control.addEventListener('input', () => {
      if (control === description) updateDescriptionCount();
      persistDraft();
    });
  }
  for (const field of [category, description, contactName, contactEmail, contactPhone, contactOptIn]) {
    field.addEventListener('input', () => {
      field.removeAttribute('aria-invalid');
      formError.textContent = '';
    });
  }

  function goTo(nextStep) {
    cancelGps();
    gpsStatus.textContent = '';
    step = nextStep;
    persistDraft();
    renderStep();
  }

  backButton.addEventListener('click', () => goTo(steps[steps.indexOf(step) - 1]));

  function showError(field, message) {
    formError.textContent = message;
    field.setAttribute('aria-invalid', 'true');
    field.focus();
    return false;
  }

  function validateDetails() {
    if (!category.value) {
      return showError(category, 'Elegí una categoría para tu reclamo.');
    }
    const message = description.value.trim();
    if (!message || [...message].length > maxDescriptionLength) {
      return showError(description, 'Escribí una descripción de entre 1 y 400 caracteres.');
    }
    return true;
  }

  function validateContact() {
    if (!extendedIntake || !contactOptIn.checked) return true;
    const phone = contactPhone.value.trim();
    const email = contactEmail.value.trim();
    if (!phone && !email) return showError(contactEmail, 'Ingresá un correo o teléfono, o desmarcá la opción de contacto.');
    if (email && (!contactEmail.validity.valid || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      return showError(contactEmail, 'Revisá el correo electrónico.');
    }
    if (phone && (!/^\+?[\d ().-]+$/.test(phone) || !/^\d{7,15}$/.test(phone.replace(/\D/g, '')))) {
      return showError(contactPhone, 'Ingresá un teléfono de entre 7 y 15 dígitos, con el código de área.');
    }
    return true;
  }

  function preparePayload() {
    const payload = { category: category.value, description: description.value.trim(), ...selectedPoint };
    if (!extendedIntake) return payload;
    payload.extra = {
      ...(locationLabel.value.trim() ? { locationLabel: locationLabel.value.trim() } : {}),
      previouslyReported: previouslyReported.checked,
      ...(photo ? { photo: photo.split(',')[1] } : {}),
    };
    if (contactOptIn.checked) {
      for (const field of [contactName, contactEmail, contactPhone]) {
        if (field.value.trim()) payload.extra[field.name] = field.value.trim();
      }
    }
    return payload;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting || photoTask) return;
    formError.textContent = '';
    if (step === 'details' && !validateDetails()) return;
    if (step === 'location' && !selectedPoint) {
      formError.textContent = 'Marcá el punto en el mapa para continuar.';
      changeLocation.focus();
      return;
    }
    if (step !== 'review') {
      goTo(steps[steps.indexOf(step) + 1]);
      return;
    }
    if (!validateContact()) return;
    const payload = preparePayload();

    submitting = true;
    const controls = [backButton, closeButton, get('discard-draft'), submitButton, contactOptIn, contactName, contactEmail, contactPhone];
    for (const control of controls) control.disabled = true;
    submitButton.textContent = 'Enviando…';
    sendingStatus.textContent = 'Enviando tu reclamo.';

    let result;
    try {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload)));
      const signature = String.fromCharCode(...new Uint8Array(digest));
      if (!attempts.has(signature)) attempts.set(signature, crypto.randomUUID());
      result = await postReport(endpoint, { requestId: attempts.get(signature), ...payload });
    } catch {
      result = { error: 'service_unavailable' };
    }

    submitting = false;
    for (const control of controls) control.disabled = false;
    submitButton.textContent = 'Enviar reclamo';
    sendingStatus.textContent = '';

    if (result.error) {
      if (result.error === 'outside_municipality') {
        selectedPoint = null;
        showMarker(null);
        goTo('location');
      }
      formError.textContent = serviceErrors[result.error];
      return;
    }

    removeDraft();
    attempts.clear();
    form.reset();
    updateContactFields();
    setPhoto('');
    photoStatus.textContent = '';
    showMarker(null);
    trackingCode.textContent = result.trackingNumber;
    title.textContent = 'Reclamo recibido';
    form.hidden = true;
    confirmation.hidden = false;
    title.focus();
  });

  restoreDraft();
  updateContactFields();
  renderStep(false);
  trigger.hidden = false;

  return {
    openAt({ lat, lng }) {
      if (dialog.open || selecting || submitting) return;
      const point = readPoint(lat, lng);
      if (!point) return;
      if (!confirmation.hidden) clearDraft();
      if (locationLabel.value === addressPointLabel) locationLabel.value = '';
      addressPointLabel = '';
      selectedPoint = point;
      showMarker(point);
      persistDraft();
      openForm();
    },
    setAddressPoint({ lat, lng }, label) {
      const point = readPoint(lat, lng);
      if (!point) return false;
      cancelGps();
      gpsStatus.textContent = '';
      selectedPoint = point;
      if (extendedIntake) {
        addressPointLabel = label.trim().slice(0, 120);
        locationLabel.value = addressPointLabel;
      }
      showMarker(point);
      syncPointSummary();
      formError.textContent = '';
      persistDraft();
      return true;
    },
  };
}
