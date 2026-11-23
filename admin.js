import { reportsConfig } from './reports-config.js?v=vecinos-2';
import { formatReportDate, publicStatuses, reportCategoryOption, reportEndpoint, reportHeaders, reportStatuses } from './report-client.js?v=categorias-1';

const pageSize = 100;
const reportColumns = 'request_id,tracking_number,category,description,latitude,longitude,status,created_at,updated_at';
const membershipPath = '/rest/v1/report_moderators?select=user_id&limit=1';
const noServiceMessage = 'El servicio de moderación todavía no está configurado.';

const loginPanel = document.getElementById('moderation-login');
const loginForm = document.getElementById('moderation-login-form');
const loginFields = document.getElementById('moderation-login-fields');
const email = document.getElementById('moderation-email');
const password = document.getElementById('moderation-password');
const loginSubmit = document.getElementById('moderation-login-submit');
const loginMessage = document.getElementById('moderation-login-message');
const logout = document.getElementById('moderation-logout');
const workspace = document.getElementById('moderation-workspace');
const reportsTitle = document.getElementById('moderation-reports-title');
const filter = document.getElementById('moderation-filter');
const refresh = document.getElementById('moderation-refresh');
const listMessage = document.getElementById('moderation-list-message');
const actionMessage = document.getElementById('moderation-action-message');
const reportsList = document.getElementById('moderation-reports');
const loadMore = document.getElementById('moderation-more');
const reportTemplate = document.getElementById('moderation-report-template');
const deleteDialog = document.getElementById('moderation-delete-dialog');
const deleteCode = document.getElementById('moderation-delete-code');

const usesAccessKey = Boolean(reportsConfig.moderationUrl);
const baseUrl = getServiceUrl();
const records = new Map();
const pendingChanges = new Set();
let session = null;
let sessionExpiry = null;
let loginRequest = null;
let listRequest = null;
let nextOffset = 0;

function getServiceUrl() {
  try {
    const url = reportEndpoint(reportsConfig.moderationUrl || reportsConfig.supabaseUrl);
    return url && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

async function request(path, { token, signal, body, prefer, method = 'GET', photo = false } = {}) {
  const headers = reportHeaders();
  if (usesAccessKey) delete headers.apikey;
  if (photo) headers.Accept = 'image/jpeg';
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;

  try {
    const timeoutSignal = AbortSignal.timeout(15000);
    const response = await fetch(new URL(path, baseUrl), {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
    });
    const data = photo
      ? response.ok && response.headers.get('content-type') === 'image/jpeg' && await response.blob()
      : await response.json().catch(() => null);
    return { status: response.status, ok: response.ok, data };
  } catch {
    return { status: 0, ok: false, data: null };
  }
}

function setMessage(node, text, error = false) {
  node.textContent = text;
  if (error) node.dataset.tone = 'error';
  else delete node.dataset.tone;
}

function clearReports() {
  records.clear();
  reportsList.replaceChildren();
  nextOffset = 0;
  loadMore.hidden = true;
}

function endSession(message = '', focus = false) {
  clearTimeout(sessionExpiry);
  loginRequest?.abort();
  listRequest?.abort();
  session?.controller.abort();
  if (deleteDialog?.open) deleteDialog.close('cancel');
  loginRequest = null;
  listRequest = null;
  session = null;
  pendingChanges.clear();
  clearReports();
  loginForm.reset();
  filter.value = 'pending_review';
  loginFields.disabled = !baseUrl;
  loginSubmit.textContent = 'Ingresar';
  refresh.disabled = false;
  loadMore.disabled = false;
  setMessage(listMessage, '');
  setMessage(actionMessage, '');
  setMessage(loginMessage, baseUrl ? message : noServiceMessage);
  workspace.hidden = true;
  logout.hidden = true;
  loginPanel.hidden = false;
  if (focus) email.focus();
}

function getSession() {
  if (session && Date.now() >= session.expiresAt) endSession('La sesión venció. Volvé a ingresar.', true);
  return session;
}

function watchExpiry() {
  const active = getSession();
  if (active) {
    const remaining = active.expiresAt - Date.now();
    sessionExpiry = setTimeout(watchExpiry, Math.min(remaining, 2147483647));
  }
}

function expiryFrom(data) {
  const deadlines = [];
  if (Number.isFinite(data.expires_at) && data.expires_at > 0) deadlines.push(data.expires_at * 1000);
  if (Number.isFinite(data.expires_in) && data.expires_in > 0) deadlines.push(Date.now() + data.expires_in * 1000);
  return deadlines.length ? Math.min(...deadlines) : 0;
}

function sessionRejected(response) {
  if (response.status === 401) {
    endSession('La sesión dejó de estar disponible. Volvé a ingresar.', true);
    return true;
  }
  if (response.status === 403) {
    endSession('Tu cuenta ya no puede acceder al panel de moderación.', true);
    return true;
  }
  return false;
}

async function signIn(event) {
  event.preventDefault();
  if (!baseUrl || loginRequest || session) return;

  const current = new AbortController();
  loginRequest = current;
  const credentials = { email: email.value.trim(), password: password.value };
  password.value = '';
  loginFields.disabled = true;
  loginSubmit.textContent = 'Ingresando…';
  setMessage(loginMessage, 'Verificando acceso…');

  try {
    const auth = await request('/auth/v1/token?grant_type=password', {
      method: 'POST',
      signal: current.signal,
      body: credentials,
    });
    credentials.password = '';
    if (loginRequest !== current) return;
    if (!auth.ok) {
      let message = 'El servicio de acceso no está disponible. Volvé a intentar.';
      if ([400, 401, 403].includes(auth.status)) {
        message = usesAccessKey ? 'Revisá el correo y la clave de acceso.' : 'Revisá el correo y la contraseña.';
      }
      if (auth.status === 429) message = 'Hubo demasiados intentos. Esperá un momento y volvé a ingresar.';
      setMessage(loginMessage, message, true);
      return;
    }

    const token = auth.data?.access_token;
    const expiresAt = auth.data ? expiryFrom(auth.data) : 0;
    if (typeof token !== 'string' || !token.trim() || expiresAt <= Date.now()) {
      setMessage(loginMessage, 'No se pudo iniciar una sesión válida. Volvé a intentar.', true);
      return;
    }

    const membership = await request(membershipPath, { token, signal: current.signal });
    if (loginRequest !== current) return;
    if (!membership.ok || !Array.isArray(membership.data)) {
      const message = [401, 403].includes(membership.status)
        ? 'Tu cuenta no tiene acceso a este panel.'
        : 'No pudimos verificar el permiso de moderación. Volvé a intentar.';
      setMessage(loginMessage, message, true);
      return;
    }
    if (!membership.data.length) {
      setMessage(loginMessage, 'Tu cuenta no tiene permiso de moderación.', true);
      return;
    }
    if (expiresAt <= Date.now()) {
      setMessage(loginMessage, 'La sesión venció durante la verificación. Volvé a ingresar.', true);
      return;
    }

    session = { token, expiresAt, controller: current };
    loginPanel.hidden = true;
    logout.hidden = false;
    workspace.hidden = false;
    setMessage(loginMessage, '');
    reportsTitle.focus();
    watchExpiry();
    void loadReports();
  } finally {
    if (loginRequest === current) {
      loginRequest = null;
      loginFields.disabled = false;
      loginSubmit.textContent = 'Ingresar';
      if (!session) password.focus();
    }
  }
}

function formatCoordinates(report) {
  if (!Number.isFinite(report.latitude) || !Number.isFinite(report.longitude)) return '—';
  return `${report.latitude.toFixed(5)}, ${report.longitude.toFixed(5)}`;
}

function reportActions(status) {
  if (status === 'pending_review') return ['published', 'rejected'];
  return publicStatuses.includes(status) ? publicStatuses.filter(choice => choice !== status) : [];
}

function confirmReportDeletion(tracking) {
  deleteCode.textContent = tracking;
  deleteDialog.returnValue = 'cancel';
  return new Promise(resolve => {
    deleteDialog.addEventListener('close', () => resolve(deleteDialog.returnValue === 'delete'), { once: true });
    deleteDialog.showModal();
  });
}

function renderReportPhoto(report, field) {
  const button = field('photo-button');
  const image = field('photo');
  const message = field('photo-message');
  button.hidden = !usesAccessKey || report.has_photo !== true;
  if (button.hidden) return;

  button.addEventListener('click', async () => {
    const active = getSession();
    if (!active) return;
    button.disabled = true;
    setMessage(message, 'Cargando la foto…');
    const id = new URLSearchParams({ id: report.request_id });
    const response = await request(`/api/reclamos-foto?${id}`, {
      photo: true,
      token: active.token,
      signal: active.controller.signal,
    });
    if (getSession() !== active || !button.isConnected || sessionRejected(response)) return;
    if (!(response.data instanceof Blob)) {
      button.disabled = false;
      setMessage(message, 'No pudimos abrir la foto. Volvé a intentar.', true);
      return;
    }
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (getSession() !== active || !button.isConnected) return;
      image.src = reader.result;
      image.hidden = false;
      button.hidden = true;
      setMessage(message, 'Revisá que la foto no muestre datos personales antes de publicar.');
    });
    reader.addEventListener('error', () => {
      button.disabled = false;
      setMessage(message, 'No pudimos abrir la foto. Volvé a intentar.', true);
    });
    reader.readAsDataURL(response.data);
  });
}

function renderReport(report) {
  const card = reportTemplate.content.firstElementChild.cloneNode(true);
  const field = name => card.querySelector(`[data-${name}]`);
  const tracking = report.tracking_number || '—';
  field('tracking').textContent = tracking;
  field('category').textContent = reportCategoryOption(report.category);
  field('description').textContent = report.description ?? '';
  field('location').textContent = [report.location_label, formatCoordinates(report)].filter(Boolean).join(' · ');
  field('previous').hidden = report.previously_reported !== true;
  const contact = [report.contact_name, report.contact_email, report.contact_phone].filter(Boolean);
  field('contact').textContent = contact.join(' · ');
  field('private-contact').hidden = contact.length === 0;
  field('created').textContent = formatReportDate(report.created_at) || '—';
  field('updated').textContent = formatReportDate(report.updated_at) || '—';
  field('status').textContent = Object.hasOwn(reportStatuses, report.status) ? reportStatuses[report.status] : 'Sin estado';
  field('status').dataset.status = report.status;
  renderReportPhoto(report, field);

  const form = field('transition');
  const choices = reportActions(report.status);
  if (!choices.length) {
    form.hidden = true;
    return card;
  }

  const select = field('target');
  const save = form.querySelector('button[type="submit"]');
  const deleteButton = field('delete');
  if (deleteButton) {
    deleteButton.hidden = !deleteDialog || !usesAccessKey || !publicStatuses.includes(report.status);
    deleteButton.setAttribute('aria-label', `Eliminar reclamo ${tracking}`);
  }
  const error = field('error');
  select.setAttribute('aria-label', `Nuevo estado para ${tracking}`);
  for (const choice of choices) {
    const option = document.createElement('option');
    option.value = choice;
    option.textContent = reportStatuses[choice];
    select.append(option);
  }

  select.addEventListener('change', () => {
    save.disabled = !choices.includes(select.value);
    setMessage(error, '');
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!choices.includes(select.value)) return;
    const choice = select.value;
    select.disabled = true;
    save.disabled = true;
    deleteButton?.setAttribute('disabled', '');
    save.textContent = 'Guardando…';
    setMessage(error, '');
    const result = await changeStatus(report, choice);
    select.disabled = false;
    save.disabled = false;
    deleteButton?.removeAttribute('disabled');
    save.textContent = 'Guardar estado';
    if (result) {
      setMessage(card.isConnected ? error : actionMessage, result, true);
      if (card.isConnected) save.focus();
    }
  });
  deleteButton?.addEventListener('click', async () => {
    if (!deleteDialog || deleteButton.hidden || !getSession() || deleteDialog.open || pendingChanges.has(report.request_id)) return;
    if (!await confirmReportDeletion(tracking) || !card.isConnected) return;
    select.disabled = true;
    save.disabled = true;
    deleteButton.disabled = true;
    deleteButton.textContent = 'Eliminando…';
    setMessage(error, '');
    const result = await deleteReport(report);
    if (!card.isConnected) return;
    select.disabled = false;
    save.disabled = !choices.includes(select.value);
    deleteButton.disabled = false;
    deleteButton.textContent = 'Eliminar';
    if (result) setMessage(error, result, true);
    deleteButton.focus();
  });
  return card;
}

function updateListMessage() {
  const count = records.size;
  const text = count === 0
    ? 'No hay reclamos para este estado.'
    : `Mostrando ${count} ${count === 1 ? 'reclamo' : 'reclamos'}.`;
  setMessage(listMessage, text);
}

async function loadReports(append = false) {
  const active = getSession();
  if (!active) return;
  if (append && (listRequest || loadMore.hidden)) return;

  listRequest?.abort();
  const current = new AbortController();
  listRequest = current;
  if (!append) clearReports();
  const offset = nextOffset;
  const params = new URLSearchParams({
    select: reportColumns,
    order: 'created_at.desc',
    limit: String(pageSize),
    offset: String(offset),
  });
  if (Object.hasOwn(reportStatuses, filter.value)) params.set('status', `eq.${filter.value}`);
  refresh.disabled = true;
  loadMore.disabled = true;
  setMessage(listMessage, 'Cargando reclamos…');

  const response = await request(`/rest/v1/reports?${params}`, {
    token: active.token,
    signal: AbortSignal.any([current.signal, active.controller.signal]),
  });
  if (getSession() !== active || listRequest !== current) return;
  listRequest = null;
  refresh.disabled = false;
  loadMore.disabled = false;
  if (sessionRejected(response)) return;
  if (!response.ok || !Array.isArray(response.data)) {
    setMessage(listMessage, 'No se pudo cargar la lista. Volvé a intentar.', true);
    return;
  }

  for (const report of response.data) {
    if (typeof report?.request_id !== 'string' || records.has(report.request_id)) continue;
    const card = renderReport(report);
    records.set(report.request_id, card);
    reportsList.append(card);
  }

  nextOffset = offset + response.data.length;
  loadMore.hidden = response.data.length < pageSize;
  updateListMessage();
}

async function changeStatus(report, status) {
  const active = getSession();
  if (!active || pendingChanges.has(report.request_id)) return '';
  pendingChanges.add(report.request_id);

  try {
    const params = new URLSearchParams({
      request_id: `eq.${report.request_id}`,
      status: `eq.${report.status}`,
      select: 'status,updated_at',
    });
    const response = await request(`/rest/v1/reports?${params}`, {
      method: 'PATCH',
      token: active.token,
      signal: active.controller.signal,
      prefer: 'return=representation',
      body: { status },
    });
    if (getSession() !== active || sessionRejected(response)) return '';
    if (response.ok && Array.isArray(response.data) && response.data.length === 0) {
      const membership = await request(membershipPath, { token: active.token, signal: active.controller.signal });
      if (getSession() !== active || sessionRejected(membership)) return '';
      if (membership.ok && Array.isArray(membership.data) && membership.data.length === 0) {
        endSession('Tu cuenta ya no tiene permiso de moderación.', true);
        return '';
      }
      return 'El estado cambió o ya no tenés permiso para modificarlo. Actualizá la lista.';
    }
    const updated = Array.isArray(response.data) && response.data.length === 1 ? response.data[0] : null;
    if (!response.ok || updated?.status !== status) return 'No pudimos confirmar el cambio. Actualizá la lista antes de reintentar.';

    const existing = records.get(report.request_id);
    if (existing && (!filter.value || filter.value === status)) {
      const replacement = renderReport({ ...report, status, updated_at: updated.updated_at });
      records.set(report.request_id, replacement);
      existing.replaceWith(replacement);
      replacement.focus();
    } else if (existing) {
      records.delete(report.request_id);
      existing.remove();
      nextOffset = Math.max(0, nextOffset - 1);
      updateListMessage();
      filter.focus();
    }
    setMessage(actionMessage, `Estado guardado para ${report.tracking_number}.`);
    if (listRequest) void loadReports();
    return '';
  } finally {
    if (session === active) pendingChanges.delete(report.request_id);
  }
}

async function deleteReport(report) {
  const active = getSession();
  if (!active || pendingChanges.has(report.request_id)) return '';
  pendingChanges.add(report.request_id);

  try {
    const params = new URLSearchParams({
      request_id: `eq.${report.request_id}`,
      status: `eq.${report.status}`,
    });
    const response = await request(`/rest/v1/reports?${params}`, {
      method: 'DELETE',
      token: active.token,
      signal: active.controller.signal,
    });
    if (getSession() !== active || sessionRejected(response)) return '';
    if (response.ok && Array.isArray(response.data) && response.data.length === 0) {
      setMessage(actionMessage, 'El reclamo ya fue eliminado o cambió de estado. Actualizamos la lista.');
      void loadReports();
      return '';
    }
    if (!response.ok || response.data?.length !== 1 || response.data[0]?.request_id !== report.request_id) {
      return 'No pudimos confirmar la eliminación. Actualizá la lista antes de reintentar.';
    }

    const card = records.get(report.request_id);
    if (card) {
      const hadFocus = card.contains(document.activeElement) || document.activeElement === document.body;
      records.delete(report.request_id);
      card.remove();
      nextOffset = Math.max(0, nextOffset - 1);
      updateListMessage();
      if (hadFocus) filter.focus();
    }
    setMessage(actionMessage, `Reclamo ${report.tracking_number} eliminado.`);
    if (listRequest) void loadReports();
    return '';
  } finally {
    if (session === active) pendingChanges.delete(report.request_id);
  }
}

if (baseUrl) loginFields.disabled = false;
else setMessage(loginMessage, noServiceMessage);
if (usesAccessKey) document.getElementById('moderation-password-label').textContent = 'Clave de acceso';

loginForm.addEventListener('submit', signIn);
logout.addEventListener('click', () => endSession('Cerraste sesión.', true));
filter.addEventListener('change', () => {
  setMessage(actionMessage, '');
  void loadReports();
});
refresh.addEventListener('click', () => {
  setMessage(actionMessage, '');
  void loadReports();
});
loadMore.addEventListener('click', () => { void loadReports(true); });
window.addEventListener('pagehide', () => endSession());
document.addEventListener('visibilitychange', getSession);
