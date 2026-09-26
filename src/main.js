import * as maplibregl from 'maplibre-gl';
import mapLibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';

maplibregl.setWorkerUrl(mapLibreWorkerUrl);

const UC = { lng: 172.583, lat: -43.523 };
const app = document.querySelector('#app');
const state = {
  page: 'map', map: null, config: null, sessionId: localStorage.getItem('people-map-session') || crypto.randomUUID(),
  mode: '', stepFree: false, avoidStairs: false, rawPoints: [], routeHistory: [], redoHistory: [],
  route: null, livePoints: [], savedRoutes: [], results: [], features: { places: [], paths: [], closures: [] },
  markers: [], searchMarker: null, eventId: 'uc-open-day-demo', drawing: false, searchTimer: null,
};
localStorage.setItem('people-map-session', state.sessionId);

const esc = (value = '') => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...(options.body instanceof FormData ? {} : { 'content-type': 'application/json' }), ...options.headers }, body: options.body && !(options.body instanceof FormData) ? JSON.stringify(options.body) : options.body });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}
const toast = (message, error = false) => {
  const box = document.querySelector('.toast');
  if (!box) return;
  box.textContent = message; box.classList.toggle('error', error); box.classList.add('visible');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => box.classList.remove('visible'), 3600);
};
const prettyDistance = (meters) => meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(2)} km`;
const prettyDuration = (seconds) => `${Math.max(1, Math.round(seconds / 60))} min`;

function shell() {
  const admin = state.page !== 'map';
  app.innerHTML = `<header class="topbar"><a href="#" class="brand" data-action="public-map"><span class="brand-mark">P</span><span>people map</span></a><span class="product-line">The pedestrian layer for physical spaces</span><nav class="top-nav"><button class="nav-link ${state.page === 'map' ? 'active' : ''}" data-page="map">Explore</button><button class="nav-link ${admin ? 'active' : ''}" data-page="dashboard">Organisation</button></nav><div class="top-event"><i></i><span>UC Open Day</span><b>DEMO</b></div><button class="icon-button help-button" title="About People Map" data-action="about">?</button></header>
  <main class="main-view ${admin ? 'admin-main' : 'map-main'}">${admin ? adminFrame() : publicMap()}</main><div class="toast" role="status" aria-live="polite"></div><div id="modal-root"></div>`;
  bindShell();
  if (!admin) bootMap('map'); else bootAdminPage();
}

function publicMap() {
  return `<section class="map-app"><div class="map-container" id="map"></div><div id="draw-surface" class="draw-surface" aria-label="Draw a walking route on the map"></div>
    <div class="map-top-controls"><div class="search-wrap"><div class="search-control"><span class="search-icon">⌕</span><input id="place-search" autocomplete="off" placeholder="Search places or addresses" aria-label="Search places and addresses"><button class="clear-search" aria-label="Clear search" data-action="clear-search">×</button></div><div class="search-results"></div></div><button class="my-location" data-action="locate" aria-label="Go to my location" title="My location">◎</button></div>
    <div class="map-label"><span class="location-dot"></span><b>University of Canterbury</b><span>· Christchurch, Aotearoa</span></div>
    <div class="map-tools"><button class="tool-button primary-tool ${state.mode === 'draw' ? 'tool-active' : ''}" data-action="draw"><span class="tool-icon">↗</span><span>${state.mode === 'draw' ? 'Drawing route…' : 'Draw Route'}</span></button><button class="tool-button" data-action="ab-route"><span class="tool-icon">A→B</span><span>Route from A → B</span></button><button class="tool-button ${state.mode === 'pin' ? 'tool-active' : ''}" data-action="pin"><span class="tool-icon">＋</span><span>Drop Pin</span></button><button class="tool-button" data-action="saved"><span class="tool-icon">▱</span><span>Saved Routes</span><b class="saved-count">${state.savedRoutes.length || ''}</b></button><label class="stepfree-control"><input id="stepfree" type="checkbox" ${state.stepFree ? 'checked' : ''}><span class="checkmark">✓</span><span>Step-free</span></label><label class="avoidstairs-control"><input id="avoidstairs" type="checkbox" ${state.avoidStairs ? 'checked' : ''}><span class="checkmark">✓</span><span>Avoid stairs</span></label></div>
    <div class="draw-toolbar ${state.mode === 'draw' ? 'show' : ''}"><button data-action="undo" title="Undo last stroke" ${state.routeHistory.length < 2 ? 'disabled' : ''}>↶ Undo</button><button data-action="redo" title="Redo stroke" ${state.redoHistory.length ? '' : 'disabled'}>↷ Redo</button><span class="draw-hint">Draw directly on the map · routes snap to mapped walkways</span><button data-action="finish-draw" class="finish-draw">Finish</button><button data-action="clear-route">Clear</button></div>
    <section class="route-card ${state.route ? 'route-ready' : ''}" aria-live="polite">${routeCardContent()}</section><div class="attribution-note">© OpenStreetMap contributors · MapLibre</div>
    <section class="side-drawer" id="side-drawer" aria-live="polite"></section><section class="ab-drawer" id="ab-drawer"></section>
    <div class="map-progress ${state.drawing || state.snapping ? 'show' : ''}">${state.snapping ? 'Finding a walkable path…' : state.drawing ? 'Drawing your route · release to snap to paths' : ''}</div>
  </section>`;
}

function routeCardContent() {
  if (state.route) return `<div class="route-card-top"><div><span class="route-status"><i></i>WALKING ROUTE</span><h2>${esc(state.route.name || 'Your walk')}</h2><p class="route-numbers"><b>${prettyDistance(state.route.distance_m)}</b><span>·</span>${prettyDuration(state.route.duration_s)}<span>·</span>${state.route.step_free ? 'Step-free preference' : state.route.avoid_stairs ? 'Avoid stairs' : 'Pedestrian route'}</p></div><button class="route-close" data-action="dismiss-route" aria-label="Hide route">×</button></div><div class="route-endpoints"><span>START</span><i></i><span>END</span></div><div class="route-card-actions"><button class="button button-primary" data-action="save-route">${state.route.saved ? '✓ Saved' : '☆ Save route'}</button><button class="button" data-action="share-route">↗ Share</button><button class="button" data-action="route-pin">＋ Pin on route</button><button class="button" data-action="continue-draw">＋ Continue drawing</button></div><p class="access-note">${state.route.step_free ? 'Based on OpenStreetMap accessibility tags; verify conditions on site.' : state.route.avoid_stairs ? 'Avoid-stairs preference follows mapped pedestrian data; verify conditions on site.' : 'Route follows mapped pedestrian ways. Check local conditions before setting out.'}</p>`;
  return `<div class="route-empty"><span class="route-empty-icon">↗</span><div><b>Your walk starts here</b><span>${state.mode === 'draw' ? 'Press and drag along the way you want to walk.' : 'Choose Draw Route and sketch a walk directly on the map.'}</span></div><button class="button button-primary button-small" data-action="draw">Draw Route</button></div>`;
}

function adminFrame() {
  const tabs = [['dashboard','Overview','▦'],['map','Pedestrian map','⌖'],['places','Places','⌂'],['events','Events & closures','◷'],['analytics','Analytics','▥'],['assistant','AI assistant','✳'],['settings','Settings','⚙']];
  return `<div class="admin-shell"><aside class="admin-nav"><div class="admin-org"><div class="org-avatar">UC</div><div><b>University of Canterbury</b><small>Organisation workspace</small></div><span>⌄</span></div><div class="admin-nav-label">MANAGE SPACE</div>${tabs.map(([id,label,icon]) => `<button class="admin-nav-link ${state.page === id ? 'active' : ''}" data-page="${id}"><span>${icon}</span>${label}${id === 'analytics' ? '<i class="new-dot"></i>' : ''}</button>`).join('')}<div class="admin-nav-bottom"><span class="demo-badge">UC OPEN DAY · DEMO</span><small>Organisations manage the map.<br>People manage their journey.</small></div></aside><section class="admin-content" id="admin-content"></section></div>`;
}

function bindShell() {
  document.querySelectorAll('[data-page]').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.page)));
  document.querySelector('[data-action="about"]')?.addEventListener('click', () => showAbout());
}
function navigate(page) {
  state.page = page;
  state.mode = '';
  if (state.map) { state.map.remove(); state.map = null; }
  state.markers = [];
  shell();
}
async function bootMap(containerId) {
  try {
    state.config = await api('/api/config');
    const map = new maplibregl.Map({
      container: containerId, style: state.config.mapStyle, center: [UC.lng, UC.lat], zoom: 16,
      pitch: 0, attributionControl: true,
      cooperativeGestures: true,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    state.map = map;
    map.on('error', (event) => { console.error('Map layer error', event.error); toast(`Map tile error: ${event.error?.message || 'service unavailable'}`, true); });
    map.on('load', async () => {
      addMapLayers(map);
      await loadFeatures();
      await loadSavedRoutes();
      recordOpen();
      const sharedId = new URLSearchParams(location.search).get('route');
      if (sharedId) openRoute(sharedId);
      map.resize();
    });
    map.on('click', async (event) => {
      if (state.mode === 'pin') await dropPin(event.lngLat);
      else if (state.mode === 'feature') selectFeatureLocation(event.lngLat);
    });
    bindMapUi();
  } catch (error) { toast(error.message, true); }
}
function addMapLayers(map) {
  map.addSource('people-route', { type: 'geojson', data: emptyCollection() });
  map.addLayer({ id: 'people-route-glow', type: 'line', source: 'people-route', paint: { 'line-color': '#e0ad59', 'line-width': 13, 'line-opacity': .26, 'line-blur': 2 } });
  map.addLayer({ id: 'people-route-line', type: 'line', source: 'people-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#126b53', 'line-width': 6, 'line-opacity': .96, 'line-blur': .1 } });
  map.addSource('route-preview', { type: 'geojson', data: emptyCollection() });
  map.addLayer({ id: 'route-preview-line', type: 'line', source: 'route-preview', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#207b60', 'line-width': 4, 'line-dasharray': [1.5, 1.3] } });
  map.addSource('organisation-data', { type: 'geojson', data: emptyCollection() });
  map.addLayer({ id: 'organisation-paths', type: 'line', source: 'organisation-data', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#4b7dcb', 'line-width': 4, 'line-dasharray': [1, 1], 'line-opacity': .9 } });
  map.addLayer({ id: 'organisation-places', type: 'circle', source: 'organisation-data', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 7, 'circle-color': '#607aca', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' } });
  map.addLayer({ id: 'organisation-labels', type: 'symbol', source: 'organisation-data', filter: ['==', ['geometry-type'], 'Point'], layout: { 'text-field': ['get', 'name'], 'text-offset': [0, 1.3], 'text-size': 11, 'text-anchor': 'top' }, paint: { 'text-color': '#263c37', 'text-halo-color': '#fff', 'text-halo-width': 1.4 } });
  map.addSource('user-pins', { type: 'geojson', data: emptyCollection() });
  map.addLayer({ id: 'user-pins-circles', type: 'circle', source: 'user-pins', paint: { 'circle-radius': 7, 'circle-color': '#e98553', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
  map.addLayer({ id: 'user-pins-labels', type: 'symbol', source: 'user-pins', layout: { 'text-field': ['get', 'label'], 'text-offset': [0, 1.3], 'text-size': 10, 'text-anchor': 'top' }, paint: { 'text-color': '#683a24', 'text-halo-color': '#fff', 'text-halo-width': 1.4 } });
  map.addSource('analytics-areas', { type: 'geojson', data: emptyCollection() });
  map.addLayer({ id: 'analytics-heat', type: 'circle', source: 'analytics-areas', paint: { 'circle-color': '#e7854e', 'circle-radius': ['interpolate',['linear'],['get','count'],1,8,10,20], 'circle-opacity': .28, 'circle-stroke-color': '#d66c3d', 'circle-stroke-width': 1 } });
  map.on('click', 'organisation-places', (e) => { const f = e.features?.[0]; if (f) new maplibregl.Popup({ offset: 12 }).setLngLat(e.lngLat).setHTML(`<b>${esc(f.properties.name)}</b><br>${esc(f.properties.type)}`).addTo(map); });
  map.on('mouseenter', 'organisation-places', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'organisation-places', () => { map.getCanvas().style.cursor = ''; });
}
const emptyCollection = () => ({ type: 'FeatureCollection', features: [] });
async function loadFeatures() {
  try {
    state.features = await api('/api/features');
    const features = [
      ...state.features.paths.map((p) => ({ type: 'Feature', geometry: p.geometry, properties: { name: p.name, type: p.path_type, step_free: p.step_free, verified: p.verified } })),
      ...state.features.places.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)).map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lng, p.lat] }, properties: { name: p.name, type: p.type, accessibility: p.accessibility, verified: p.verified } })),
    ];
    state.map?.getSource('organisation-data')?.setData({ type: 'FeatureCollection', features });
  } catch (error) { toast(`Organisation layer could not load: ${error.message}`, true); }
}
function bindMapUi() {
  document.querySelectorAll('.map-main [data-action]').forEach((button) => button.addEventListener('click', () => act(button.dataset.action, button)));
  document.querySelector('#stepfree')?.addEventListener('change', async (event) => { state.stepFree = event.target.checked; if (state.route && state.rawPoints.length > 1) await snapRoute(state.rawPoints); updateRouteCard(); });
  document.querySelector('#avoidstairs')?.addEventListener('change', async (event) => { state.avoidStairs = event.target.checked; if (state.route && state.rawPoints.length > 1) await snapRoute(state.rawPoints); });
  const input = document.querySelector('#place-search');
  input?.addEventListener('input', () => { clearTimeout(state.searchTimer); state.searchTimer = setTimeout(() => searchPlaces(input.value), 280); });
  input?.addEventListener('keydown', (event) => { if (event.key === 'Escape') clearSearch(); if (event.key === 'Enter') document.querySelector('.search-result')?.click(); });
  setupDrawingSurface();
}
async function searchPlaces(query) {
  const results = document.querySelector('.search-results');
  if (!results) return;
  if (query.trim().length < 2) { results.innerHTML = ''; return; }
  results.innerHTML = '<div class="search-loading">Searching OpenStreetMap places…</div>';
  try {
    const data = await api(`/api/search?q=${encodeURIComponent(query.trim())}`);
    state.results = data.results;
    results.innerHTML = state.results.map((item, index) => `<button class="search-result" data-result="${index}"><span>⌖</span><span><b>${esc(item.label)}</b><small>${esc(item.properties?.type || item.properties?.osm_value || 'Place')}</small></span><i>↗</i></button>`).join('') || '<div class="search-loading">No results from OpenStreetMap.</div>';
    results.querySelectorAll('[data-result]').forEach((button) => button.addEventListener('click', () => selectSearchResult(state.results[Number(button.dataset.result)])));
  } catch (error) { results.innerHTML = `<div class="search-loading">${esc(error.message)}</div>`; }
}
function clearSearch() { document.querySelector('#place-search').value = ''; document.querySelector('.search-results').innerHTML = ''; }
function selectSearchResult(result) {
  const [lng, lat] = result.coordinates;
  if (state.searchDestination) {
    state.searchDestination = null;
    const target = state.abField;
    state.abPoints[target] = { lng, lat, label: result.label };
    const input = document.querySelector(`[data-ab-field="${target}"]`); if (input) input.value = result.label;
  } else {
    state.map.flyTo({ center: [lng, lat], zoom: 18, essential: true });
    state.searchMarker?.remove();
    state.searchMarker = new maplibregl.Marker({ color: '#e98553' }).setLngLat([lng, lat]).setPopup(new maplibregl.Popup({ offset: 18 }).setText(result.label)).addTo(state.map);
    state.searchMarker.togglePopup();
  }
  clearSearch();
}
function setupDrawingSurface() {
  const surface = document.querySelector('#draw-surface');
  if (!surface) return;
  surface.addEventListener('pointerdown', (event) => {
    if (state.mode !== 'draw' || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    surface.setPointerCapture(event.pointerId); state.drawing = true; state.livePoints = [];
    state.map.dragPan.disable(); state.map.doubleClickZoom.disable();
    addDrawPoint(event); updateProgress();
  });
  surface.addEventListener('pointermove', (event) => {
    if (!state.drawing) return;
    event.preventDefault(); addDrawPoint(event); showPreview([...state.rawPoints, ...state.livePoints]);
  });
  const end = async (event) => {
    if (!state.drawing) return;
    event.preventDefault(); state.drawing = false; state.map.dragPan.enable(); state.map.doubleClickZoom.enable();
    const segment = state.livePoints.slice(); state.livePoints = [];
    if (segment.length < 2) { updateProgress(); return toast('Draw a longer line to make a route.'); }
    if (state.routeHistory.length === 0) state.routeHistory.push(state.rawPoints.slice());
    state.rawPoints = [...state.rawPoints, ...segment];
    state.routeHistory.push(state.rawPoints.slice()); state.redoHistory = [];
    state.mode = 'draw'; updateTools(); await snapRoute(state.rawPoints); updateProgress();
  };
  surface.addEventListener('pointerup', end);
  surface.addEventListener('pointercancel', end);
}
function addDrawPoint(event) {
  const rect = state.map.getCanvas().getBoundingClientRect();
  const lngLat = state.map.unproject([event.clientX - rect.left, event.clientY - rect.top]);
  const point = { lat: lngLat.lat, lng: lngLat.lng };
  const prior = state.livePoints.at(-1) || state.rawPoints.at(-1);
  if (!prior || haversine(prior, point) > 2.5) state.livePoints.push(point);
  if (state.livePoints.length > 100) state.livePoints = state.livePoints.filter((_p, i) => i % 2 === 0);
}
function haversine(a, b) {
  const rad = (n) => n * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
function showPreview(points) {
  const coordinates = points.map((p) => [p.lng, p.lat]);
  if (coordinates.length < 2) return;
  state.map.getSource('route-preview')?.setData({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } }] });
}
function thinPoints(points, max = 90) {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  return Array.from({ length: max }, (_v, i) => points[Math.round(i * step)]);
}
async function snapRoute(points) {
  if (points.length < 2) return;
  state.snapping = true; updateProgress();
  showPreview(points);
  try {
    const data = await api('/api/routes/snap', { method: 'POST', body: { points: thinPoints(points), sessionId: state.sessionId, stepFree: state.stepFree, avoidStairs: state.avoidStairs, routeId: state.route?.id, eventId: state.eventId } });
    state.route = data.route;
    state.map.getSource('people-route')?.setData({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { id: data.route.id }, geometry: data.route.geometry }] });
    state.map.getSource('route-preview')?.setData(emptyCollection());
    renderRoutePins(data.route.pins || []); fitRoute(data.route.geometry);
    await refreshSavedCount();
    updateRouteCard();
  } catch (error) {
    state.map.getSource('route-preview')?.setData(emptyCollection());
    toast(`${error.message} Your sketch was not saved as a route.`, true);
  } finally { state.snapping = false; updateProgress(); }
}
function fitRoute(geometry) {
  const bounds = new maplibregl.LngLatBounds();
  geometry.coordinates.forEach((point) => bounds.extend(point));
  if (!bounds.isEmpty()) state.map.fitBounds(bounds, { padding: { top: 100, right: 80, bottom: 190, left: 80 }, maxZoom: 18, duration: 650 });
}
function updateRouteCard() {
  const card = document.querySelector('.route-card');
  if (card) { card.classList.toggle('route-ready', Boolean(state.route)); card.innerHTML = routeCardContent(); bindMapActions(); }
}
function updateTools() {
  document.querySelectorAll('[data-action="draw"]').forEach((b) => { b.classList.toggle('tool-active', state.mode === 'draw'); const label = b.querySelector('span:last-child'); if (label) label.textContent = state.mode === 'draw' ? 'Drawing route…' : 'Draw Route'; });
  document.querySelector('[data-action="pin"]')?.classList.toggle('tool-active', state.mode === 'pin');
  document.querySelector('.draw-toolbar')?.classList.toggle('show', state.mode === 'draw');
  document.querySelector('.map-main')?.classList.toggle('is-drawing', state.mode === 'draw');
  bindMapActions();
}
function updateProgress() {
  const p = document.querySelector('.map-progress');
  if (p) { p.textContent = state.snapping ? 'Finding a walkable path…' : state.drawing ? 'Drawing your route · release to snap to paths' : ''; p.classList.toggle('show', state.drawing || state.snapping); }
}
function renderRoutePins(pins) {
  const features = pins.map((p) => ({ type: 'Feature', properties: { label: p.label, id: p.id }, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } }));
  state.map.getSource('user-pins')?.setData({ type: 'FeatureCollection', features });
}
async function dropPin(lngLat) {
  const label = `Pin ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  try {
    let data;
    if (state.route) data = await api(`/api/routes/${state.route.id}/pins`, { method: 'POST', body: { lat: lngLat.lat, lng: lngLat.lng, label, sessionId: state.sessionId } });
    else data = await api('/api/pins', { method: 'POST', body: { lat: lngLat.lat, lng: lngLat.lng, label, sessionId: state.sessionId } });
    state.mode = '';
    if (state.route) {
      const pin = { id: data.id, label, lat: lngLat.lat, lng: lngLat.lng };
      state.route.pins = [...(state.route.pins || []), pin]; renderRoutePins(state.route.pins);
    } else {
      const el = document.createElement('div'); el.className = 'loose-pin'; el.textContent = '＋';
      state.markers.push(new maplibregl.Marker({ element: el }).setLngLat(lngLat).setPopup(new maplibregl.Popup({ offset: 15 }).setText(label)).addTo(state.map));
    }
    updateTools(); toast(state.route ? 'Pin added to this route' : 'Pin dropped on the map');
  } catch (error) { toast(error.message, true); }
}

async function recordOpen() { try { await api('/api/usage', { method: 'POST', body: { kind: 'map_open', eventId: state.eventId, sessionId: state.sessionId } }); } catch { /* map use should not depend on analytics availability */ } }
async function loadSavedRoutes() {
  try { state.savedRoutes = (await api(`/api/routes?sessionId=${encodeURIComponent(state.sessionId)}`)).routes; document.querySelector('.saved-count').textContent = state.savedRoutes.length || ''; }
  catch { state.savedRoutes = []; }
}
async function refreshSavedCount() { await loadSavedRoutes(); }
async function openRoute(id) {
  try {
    const { route } = await api(`/api/routes/${encodeURIComponent(id)}`);
    state.route = route; state.rawPoints = []; state.mode = '';
    state.map.getSource('people-route').setData({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { id }, geometry: route.geometry }] });
    renderRoutePins(route.pins || []); fitRoute(route.geometry); updateRouteCard();
  } catch (error) { toast(`That route could not be opened: ${error.message}`, true); }
}
function beginDraw() {
  if (state.mode === 'draw') return finishDrawing();
  state.mode = 'draw'; state.livePoints = [];
  if (!state.route) { state.rawPoints = []; state.routeHistory = []; state.redoHistory = []; }
  else if (!state.rawPoints.length) state.rawPoints = state.route.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
  updateTools(); updateProgress(); toast('Press and drag on the map to sketch your walk.');
}
async function finishDrawing() {
  if (state.drawing) return;
  state.mode = '';
  updateTools(); updateProgress();
  if (state.rawPoints.length >= 2 && !state.route) await snapRoute(state.rawPoints);
  else if (state.route) toast('Route editing finished.');
}
async function undo() {
  if (state.routeHistory.length < 2) return;
  state.redoHistory.push(state.routeHistory.pop()); state.rawPoints = state.routeHistory.at(-1).slice();
  if (state.rawPoints.length >= 2) await snapRoute(state.rawPoints);
  else clearCurrentRoute(false, true);
  updateTools();
}
async function redo() {
  const next = state.redoHistory.pop(); if (!next) return;
  state.routeHistory.push(next); state.rawPoints = next.slice();
  if (state.rawPoints.length >= 2) await snapRoute(state.rawPoints);
  updateTools();
}
function clearCurrentRoute(removeUnsaved = true, preserveHistory = false) {
  const priorRoute = state.route;
  state.route = null; state.rawPoints = []; if (!preserveHistory) { state.routeHistory = []; state.redoHistory = []; } state.mode = '';
  state.map.getSource('people-route')?.setData(emptyCollection()); state.map.getSource('route-preview')?.setData(emptyCollection());
  renderRoutePins([]); updateRouteCard(); updateTools();
  if (removeUnsaved && priorRoute?.id && !priorRoute.saved) api(`/api/routes/${priorRoute.id}`, { method: 'DELETE', body: { sessionId: state.sessionId } }).catch(() => {});
}
function bindMapActions() { document.querySelectorAll('.map-main [data-action]').forEach((button) => { button.onclick = () => act(button.dataset.action, button); }); }

async function act(action, button) {
  try {
    if (action === 'draw') beginDraw();
    if (action === 'finish-draw') await finishDrawing();
    if (action === 'undo') await undo();
    if (action === 'redo') await redo();
    if (action === 'clear-route') clearCurrentRoute();
    if (action === 'dismiss-route') { state.route = null; state.map.getSource('people-route')?.setData(emptyCollection()); updateRouteCard(); }
    if (action === 'pin') { state.mode = state.mode === 'pin' ? '' : 'pin'; updateTools(); toast(state.mode === 'pin' ? 'Tap anywhere on the map to place a pin.' : 'Pin mode ended.'); }
    if (action === 'route-pin') { state.mode = 'pin'; updateTools(); toast('Tap a spot along your route to add a pin.'); }
    if (action === 'continue-draw') beginDraw();
    if (action === 'save-route') showSaveDialog();
    if (action === 'share-route') await shareRoute();
    if (action === 'saved') await showSavedRoutes();
    if (action === 'ab-route') showAbDrawer();
    if (action === 'locate') locateUser();
    if (action === 'clear-search') clearSearch();
    if (action === 'close-drawer') closeDrawers();
    if (action === 'close-ab') document.querySelector('#ab-drawer').innerHTML = '';
    if (action === 'calculate-ab') await calculateAbRoute();
    if (action === 'about') showAbout();
  } catch (error) { toast(error.message, true); }
}
function locateUser() {
  if (!navigator.geolocation) return toast('Location is not available in this browser.', true);
  navigator.geolocation.getCurrentPosition(({ coords }) => state.map.flyTo({ center: [coords.longitude, coords.latitude], zoom: 17 }), () => toast('Location permission was not available.', true), { enableHighAccuracy: true, timeout: 8000 });
}
function closeDrawers() { document.querySelector('#side-drawer').innerHTML = ''; }
function showSavedRoutes() {
  loadSavedRoutes().then(() => {
    const drawer = document.querySelector('#side-drawer');
    drawer.innerHTML = `<button class="drawer-close" data-action="close-drawer">×</button><div class="eyebrow">YOUR WALKS</div><h2>Saved routes</h2><p>Routes are saved privately in this browser session.</p>${state.savedRoutes.map((r) => `<button class="saved-route-row" data-open-route="${esc(r.id)}"><span class="saved-route-icon">↗</span><span><b>${esc(r.name || 'Untitled walk')}</b><small>${prettyDistance(r.distance_m)} · ${prettyDuration(r.duration_s)}</small></span><i>›</i></button>`).join('') || '<div class="empty-drawer">Your saved routes will appear here.</div>'}`;
    drawer.querySelector('[data-action="close-drawer"]').onclick = closeDrawers;
    drawer.querySelectorAll('[data-open-route]').forEach((el) => el.onclick = () => { closeDrawers(); openRoute(el.dataset.openRoute); });
  });
}
function showSaveDialog() {
  if (!state.route) return toast('Draw and snap a route before saving it.');
  const root = document.querySelector('#modal-root');
  root.innerHTML = `<div class="modal-backdrop"><section class="modal"><div class="eyebrow">SAVE THIS WALK</div><h2>Name your route</h2><p>Your route geometry and walking details will be saved to your route library.</p><label for="route-name">Route name</label><input id="route-name" maxlength="80" value="${esc(state.route.name === 'Untitled walk' ? '' : state.route.name)}" placeholder="e.g. Library to Engineering"><footer><button class="button" data-action="cancel-modal">Cancel</button><button class="button button-primary" data-action="confirm-save">Save route</button></footer></section></div>`;
  root.querySelector('[data-action="cancel-modal"]').onclick = () => { root.innerHTML = ''; };
  root.querySelector('[data-action="confirm-save"]').onclick = async () => {
    const name = root.querySelector('#route-name').value.trim() || 'Untitled walk';
    const { route } = await api(`/api/routes/${state.route.id}`, { method: 'PATCH', body: { name, saved: true } });
    state.route = route; root.innerHTML = ''; await loadSavedRoutes(); updateRouteCard(); toast('Route saved to your walks.');
  };
}
async function shareRoute() {
  if (!state.route) return;
  const { route } = await api(`/api/routes/${state.route.id}`, { method: 'PATCH', body: { shared: true } });
  state.route = route;
  const link = `${location.origin}${location.pathname}?route=${encodeURIComponent(route.id)}`;
  try { await navigator.clipboard.writeText(link); toast('Route link copied. Anyone with the link can view this route.'); }
  catch { prompt('Copy this route link', link); }
  updateRouteCard();
}

const stateAb = () => { state.abPoints ||= { start: null, end: null }; };
function showAbDrawer() {
  stateAb();
  const panel = document.querySelector('#ab-drawer');
  panel.innerHTML = `<button class="drawer-close" data-action="close-ab">×</button><div class="eyebrow">OPTIONAL ROUTE PLANNER</div><h2>Route from A → B</h2><p>For a direct point-to-point walking route, instead of drawing one yourself.</p><label>Start<input data-ab-field="start" placeholder="Search a starting place" value="${esc(state.abPoints.start?.label || '')}"></label><label>Destination<input data-ab-field="end" placeholder="Search a destination" value="${esc(state.abPoints.end?.label || '')}"></label><button class="button button-primary full-button" data-action="calculate-ab">Find walking route</button><small>Uses pedestrian routing and map data. Step-free preference follows available accessibility tags.</small>`;
  panel.querySelector('[data-action="close-ab"]').onclick = () => { panel.innerHTML = ''; };
  panel.querySelector('[data-action="calculate-ab"]').onclick = calculateAbRoute;
  panel.querySelectorAll('[data-ab-field]').forEach((input) => input.addEventListener('change', async () => {
    const field = input.dataset.abField;
    const data = await api(`/api/search?q=${encodeURIComponent(input.value)}`);
    const result = data.results[0];
    if (!result) return toast(`Could not find ${field}. Try a more specific place.`, true);
    state.abPoints[field] = { lng: result.coordinates[0], lat: result.coordinates[1], label: result.label };
    input.value = result.label;
  }));
}
async function geocode(query) {
  const data = await api(`/api/search?q=${encodeURIComponent(query)}`);
  if (!data.results.length) throw new Error(`No map result found for “${query}”.`);
  const result = data.results[0]; return { lng: result.coordinates[0], lat: result.coordinates[1], label: result.label };
}
async function calculateAbRoute() {
  stateAb();
  const startInput = document.querySelector('[data-ab-field="start"]');
  const endInput = document.querySelector('[data-ab-field="end"]');
  const start = state.abPoints.start || (startInput?.value.trim() ? await geocode(startInput.value) : null);
  const end = state.abPoints.end || (endInput?.value.trim() ? await geocode(endInput.value) : null);
  if (!start || !end) return toast('Enter and select both a start and destination.', true);
  const data = await api('/api/routes/point-to-point', { method: 'POST', body: { start, end, sessionId: state.sessionId, stepFree: state.stepFree, avoidStairs: state.avoidStairs, eventId: state.eventId } });
  state.route = data.route; state.rawPoints = []; state.mode = '';
  state.map.getSource('people-route').setData({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: state.route.geometry }] });
  fitRoute(state.route.geometry); document.querySelector('#ab-drawer').innerHTML = ''; updateRouteCard(); toast('Pedestrian route found.');
}

async function bootAdminPage() {
  const target = document.querySelector('#admin-content');
  const page = state.page;
  if (page === 'dashboard') target.innerHTML = await dashboardView();
  if (page === 'map') target.innerHTML = adminMapView();
  if (page === 'places') target.innerHTML = await placesView();
  if (page === 'events') target.innerHTML = await eventsView();
  if (page === 'analytics') target.innerHTML = await analyticsView();
  if (page === 'assistant') target.innerHTML = await assistantView();
  if (page === 'settings') target.innerHTML = settingsView();
  bindAdminActions();
  if (page === 'map') bootMap('admin-map');
  if (page === 'analytics') loadAnalyticsMap();
}
async function dashboardView() {
  const metrics = await api('/api/analytics');
  return `<div class="admin-heading"><div><div class="eyebrow">UC · UNIVERSITY OF CANTERBURY</div><h1>Space overview</h1><p>Open Day pedestrian map and organisation activity.</p></div><button class="button button-primary" data-page="map">⌖ Manage map</button></div><div class="dashboard-banner"><div class="banner-icon">✳</div><div><b>UC Open Day · Demo event</b><span>Event map is ready for verified organisation details. No indoor or accessibility data is preloaded.</span></div><button class="button" data-page="events">Event settings →</button></div><div class="admin-metrics"><article><small>Map users</small><b>${metrics.counts.mapUsers}</b><span>anonymous visitors</span></article><article><small>Routes created</small><b>${metrics.counts.routesCreated}</b><span>walks drawn on map</span></article><article><small>Step-free requests</small><b>${metrics.counts.stepFreeRequests}</b><span>using mapped data</span></article><article><small>Saved / shared</small><b>${metrics.counts.savedRoutes} / ${metrics.counts.sharedRoutes}</b><span>visitor route actions</span></article></div><div class="admin-two-col"><section class="admin-card"><div class="admin-card-heading"><div><h2>Recent activity</h2><p>Aggregated actions from visitors</p></div><button class="text-action" data-page="analytics">View analytics →</button></div>${metrics.eventActivity.slice(0,6).map((e) => `<div class="activity-row"><span class="activity-dot"></span><span>${esc(e.kind.replaceAll('_',' '))}</span><b>${e.count}</b></div>`).join('') || '<div class="empty-state">No visitor activity yet. Draw a route in the public map to see analytics populate.</div>'}</section><section class="admin-card"><div class="admin-card-heading"><div><h2>Map data status</h2><p>Verified organisation-controlled layer</p></div><button class="text-action" data-page="places">Manage →</button></div><div class="data-status"><span>Places and entrances</span><b>${state.features.places.length}</b></div><div class="data-status"><span>Pedestrian paths</span><b>${state.features.paths.length}</b></div><div class="data-status"><span>Published closures</span><b>${state.features.closures.length}</b></div><p class="privacy-note">Base map and routes use OpenStreetMap data. Organisation-specific details appear only after an administrator adds them.</p></section></div>`;
}
function adminMapView() {
  return `<div class="admin-heading"><div><div class="eyebrow">ORGANISATION MAP LAYER</div><h1>Pedestrian network</h1><p>Manage verified places and paths on the real campus map.</p></div><div class="heading-actions"><button class="button" data-action="show-upload">⇧ Import floor plan</button><button class="button button-primary" data-action="new-feature">＋ Add map feature</button></div></div><div class="admin-map-wrap"><div class="map-container" id="admin-map"></div><div id="admin-draw-surface" class="draw-surface"></div><div class="admin-map-tools"><button class="button" data-action="draw-org-path">＋ Draw pedestrian path</button><span class="map-layer-key"><i></i>Organisation data</span></div><div class="admin-map-legend">OSM base map · blue marks are organisation-managed</div></div><input type="file" hidden id="plan-file" accept="image/png,image/jpeg,application/pdf"><div id="map-feature-modal"></div>`;
}
async function placesView() {
  const data = await api('/api/features'); state.features = data;
  const places = data.places.map((p) => `<div class="managed-row"><span class="managed-type">${esc(p.type)}</span><span><b>${esc(p.name)}</b><small>${esc(p.description || 'Organisation-provided')}</small></span><span class="verified ${p.verified ? '' : 'unverified'}">${p.verified ? 'Verified' : 'Needs review'}</span><button data-delete-feature="${p.id}" title="Remove">×</button></div>`).join('');
  const paths = data.paths.map((p) => `<div class="managed-row"><span class="managed-type">${esc(p.path_type)}</span><span><b>${esc(p.name)}</b><small>${p.step_free ? 'Step-free path · organisation confirmed' : 'Pedestrian path'}</small></span><span class="verified">${p.verified ? 'Verified' : 'Draft'}</span><button data-delete-feature="${p.id}" title="Remove">×</button></div>`).join('');
  return `<div class="admin-heading"><div><div class="eyebrow">ORGANISATION MAP LAYER</div><h1>Places & paths</h1><p>Only organisation-confirmed information is stored as verified map data.</p></div><button class="button button-primary" data-action="new-feature">＋ Add place</button></div><section class="admin-card"><div class="admin-card-heading"><div><h2>Managed places</h2><p>Buildings, entrances, rooms, lifts, ramps, bathrooms and event locations</p></div></div>${places || '<div class="empty-state">Add authoritative place data. The app does not fabricate UC building locations or accessibility claims.</div>'}${paths}<button class="button" data-page="map">Open pedestrian map editor →</button></section><div id="map-feature-modal"></div>`;
}
async function eventsView() {
  const { events } = await api('/api/events'); const data = await api('/api/features');
  return `<div class="admin-heading"><div><div class="eyebrow">EVENT LICENSING · YEAR-ROUND MAPS</div><h1>Events & closures</h1><p>Publish event locations and temporary changes for visitors.</p></div><button class="button button-primary" data-action="new-event">＋ Create event</button></div><div class="admin-two-col"><section class="admin-card"><div class="admin-card-heading"><div><h2>Events</h2><p>Maps can be licensed for individual events or managed year-round.</p></div></div>${events.map((e) => `<div class="event-list-row"><span class="event-date">✳</span><span><b>${esc(e.name)}</b><small>${e.starts_at ? new Date(e.starts_at).toLocaleString() : 'Date not set'}</small></span><span class="status-tag">${esc(e.status)}</span>${e.status === 'published' ? '<span class="verified">Live</span>' : `<button class="button button-small" data-publish-event="${esc(e.id)}">Publish</button>`}</div>`).join('')}<form id="event-form" class="inline-form"><input name="name" required placeholder="Event name"><button class="button button-primary">Create event</button></form></section><section class="admin-card"><div class="admin-card-heading"><div><h2>Temporary closures</h2><p>Show an affected map feature and dates to visitors</p></div><button class="button button-small" data-action="ai-closure">✳ Ask AI</button></div>${data.closures.map((c) => `<div class="event-list-row"><span class="closure-icon">⚠</span><span><b>${esc(c.name)}</b><small>${esc(c.starts_at || 'Time not set')} – ${esc(c.ends_at || 'Time not set')}</small></span><span class="status-tag">${esc(c.status)}</span></div>`).join('') || '<div class="empty-state">No closures. Add a map closure or ask AI to structure a closure note.</div>'}<form id="closure-form" class="stack-form"><input name="name" required placeholder="Affected entrance, path or place"><div class="form-two"><label>Starts<input name="startsAt" type="datetime-local"></label><label>Ends<input name="endsAt" type="datetime-local"></label></div><button class="button">Publish closure</button></form></section></div><div id="ai-result"></div>`;
}
async function analyticsView() {
  const { counts, destinations, areas, byHour, eventActivity } = await api('/api/analytics');
  const max = Math.max(1, ...byHour.map((x) => x.count));
  return `<div class="admin-heading"><div><div class="eyebrow">AGGREGATED PEDESTRIAN INSIGHTS</div><h1>Analytics</h1><p>What people are drawing, searching, saving and sharing across your spaces.</p></div><button class="button" data-action="export-analytics">⇩ Export CSV</button></div><div class="privacy-strip"><span>◎</span><b>Privacy-conscious by design</b><span>Area activity is grouped into coarse cells; no individual journey histories are shown.</span><span class="source-tag">${counts.mapUsers} map opens</span></div><div class="admin-metrics analytics-metrics"><article><small>Map users</small><b>${counts.mapUsers}</b><span>anonymous visitors</span></article><article><small>Routes created</small><b>${counts.routesCreated}</b><span>walks snapped to paths</span></article><article><small>Saved / shared</small><b>${counts.savedRoutes} / ${counts.sharedRoutes}</b><span>visitor route actions</span></article><article><small>Step-free requests</small><b>${counts.stepFreeRequests}</b><span>mapped accessibility preference</span></article></div><div class="admin-two-col"><section class="admin-card"><div class="admin-card-heading"><div><h2>Route activity by hour</h2><p>Real routes and route searches recorded by this app</p></div></div><div class="analytics-bars">${Array.from({ length: 12 }, (_x, i) => { const v = byHour.find((h) => Number(h.hour) === i + 8)?.count || 0; return `<div><i style="height:${Math.max(2, v / max * 100)}%"></i><small>${i + 8}:00</small></div>`; }).join('')}</div><div class="chart-legend"><i></i>Route activity</div></section><section class="admin-card"><div class="admin-card-heading"><div><h2>Most searched destinations</h2><p>Aggregated search terms from visitors</p></div></div>${destinations.map((d) => `<div class="destination-row"><span>${esc(d.name)}</span><b>${d.count}</b></div>`).join('') || '<div class="empty-state">Search data will appear as visitors look up places.</div>'}</section><section class="admin-card"><div class="admin-card-heading"><div><h2>Popular map areas</h2><p>Coarse geographic cells from route endpoints and pins</p></div><span class="status-tag">Aggregated</span></div><div class="mini-map" id="analytics-map"></div></section><section class="admin-card"><div class="admin-card-heading"><div><h2>Event activity</h2><p>Usage grouped by event and action</p></div></div>${eventActivity.map((e) => `<div class="destination-row"><span>${esc((e.eventId || 'Campus').replaceAll('-',' '))} · ${esc(e.kind.replaceAll('_',' '))}</span><b>${e.count}</b></div>`).join('') || '<div class="empty-state">Event analytics will appear when people use the public map.</div>'}</section></div>`;
}
async function assistantView() {
  const { enabled, model } = await api('/api/ai/status');
  return `<div class="admin-heading"><div><div class="eyebrow">ADMIN COPILOT · REVIEW REQUIRED</div><h1>Map assistant</h1><p>Describe a map update or ask about aggregated activity. Changes always need your confirmation.</p></div><span class="${enabled ? 'ai-live' : 'ai-needs-key'}">${enabled ? `LIVE · ${esc(model)}` : 'OPENAI_API_KEY NEEDED'}</span></div><div class="assistant-layout"><section class="admin-card assistant-card"><div class="assistant-intro"><div class="assistant-icon">✳</div><div><h2>What would you like to update?</h2><p>Examples: “The eastern entrance is closed Saturday from 9am to 4pm” or “Which destinations have people searched for?”</p></div></div><form id="assistant-form"><textarea name="message" required placeholder="Describe a map update or ask a question…" ${enabled ? '' : 'disabled'}></textarea><div class="assistant-footer"><span>AI proposals do not publish automatically. Accessibility claims are never inferred.</span><button class="button button-primary" ${enabled ? '' : 'disabled'}>✳ Propose action</button></div></form><div id="ai-result"></div></section><aside class="admin-card"><h2>Review flow</h2><div class="review-step"><i>1</i><span><b>Describe</b><small>Ask for a map or event update</small></span></div><div class="review-step"><i>2</i><span><b>Review</b><small>Check the structured proposal</small></span></div><div class="review-step"><i>3</i><span><b>Confirm</b><small>Only confirmation writes to your map</small></span></div>${enabled ? '' : '<div class="key-note">Add <code>OPENAI_API_KEY</code> to the server `.env` to connect the OpenAI Responses API. The map and routing work without it.</div>'}</aside></div>`;
}
function settingsView() {
  return `<div class="admin-heading"><div><div class="eyebrow">ORGANISATION</div><h1>Settings</h1><p>Organisation, privacy and map service configuration.</p></div></div><section class="admin-card settings-card"><h2>University of Canterbury</h2><p>Organisation ID: <code>uc</code> · Public map is available without an account.</p><div class="settings-item"><span><b>Map base</b><small>OpenStreetMap raster tiles via MapLibre GL</small></span><i>Connected</i></div><div class="settings-item"><span><b>Place search</b><small>Photon geocoding, based on OpenStreetMap</small></span><i>Connected</i></div><div class="settings-item"><span><b>Pedestrian routing</b><small>Valhalla map matching and walking cost model</small></span><i>Connected</i></div><div class="settings-item"><span><b>AI assistant</b><small>OpenAI Responses API · server-side only</small></span><i>${state.config?.aiEnabled ? 'Enabled' : 'Key required'}</i></div><div class="privacy-note">This workspace has no sign-in or role management yet. Do not use it for sensitive production data until authentication and organisation access controls are added.</div></section>`;
}

async function loadAnalyticsMap() {
  try {
    const data = await api('/api/analytics');
    const map = new maplibregl.Map({ container: 'analytics-map', style: state.config?.mapStyle, center: [UC.lng, UC.lat], zoom: 15, interactive: false, attributionControl: false });
    map.on('load', () => {
      map.addSource('areas', { type: 'geojson', data: { type: 'FeatureCollection', features: data.areas.map((a) => { const [lat, lng] = a.cell.split(',').map(Number); return { type: 'Feature', properties: { count: a.count }, geometry: { type: 'Point', coordinates: [lng, lat] } }; }) } });
      map.addLayer({ id: 'activity-areas', type: 'circle', source: 'areas', paint: { 'circle-radius': ['interpolate',['linear'],['get','count'],1,8,10,20], 'circle-color': '#e98553', 'circle-opacity': .5, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1 } });
    });
  } catch (error) { toast(error.message, true); }
}

function bindAdminActions() {
  document.querySelectorAll('#admin-content [data-page]').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.page)));
  document.querySelectorAll('#admin-content [data-action]').forEach((button) => button.addEventListener('click', () => adminAction(button.dataset.action)));
  document.querySelectorAll('[data-delete-feature]').forEach((button) => button.addEventListener('click', async () => { await api(`/api/features/${button.dataset.deleteFeature}`, { method: 'DELETE' }); bootAdminPage(); }));
  document.querySelector('#event-form')?.addEventListener('submit', async (e) => { e.preventDefault(); const name = new FormData(e.currentTarget).get('name'); await api('/api/events', { method: 'POST', body: { name } }); bootAdminPage(); toast('Event created as a draft.'); });
  document.querySelector('#closure-form')?.addEventListener('submit', async (e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); await api('/api/closures', { method: 'POST', body: { name: fd.get('name'), startsAt: fd.get('startsAt'), endsAt: fd.get('endsAt'), eventId: state.eventId } }); bootAdminPage(); toast('Closure published.'); });
  document.querySelector('#assistant-form')?.addEventListener('submit', submitAssistant);
  document.querySelector('#plan-file')?.addEventListener('change', uploadPlan);
  document.querySelectorAll('[data-publish-event]').forEach((button) => button.addEventListener('click', async () => { await api(`/api/events/${button.dataset.publishEvent}`, { method: 'PATCH', body: { status: 'published' } }); await bootAdminPage(); toast('Event published.'); }));
}
async function adminAction(action) {
  if (action === 'new-feature') showFeatureForm();
  if (action === 'show-upload') document.querySelector('#plan-file')?.click();
  if (action === 'new-event') document.querySelector('#event-form input[name="name"]')?.focus();
  if (action === 'ai-closure') { navigate('assistant'); setTimeout(() => { const box = document.querySelector('#admin-content textarea'); if (box) box.value = 'The eastern entrance is closed Saturday from 9am to 4pm.'; }, 200); }
  if (action === 'draw-org-path') startOrgPathDrawing();
  if (action === 'export-analytics') exportAnalytics();
}

function showFeatureForm() {
  if (state.page !== 'map') { navigate('map'); setTimeout(showFeatureForm, 250); return; }
  const modal = document.querySelector('#map-feature-modal');
  if (!modal) return toast('Open the pedestrian map editor to place a feature.');
  modal.innerHTML = `<div class="modal-backdrop"><section class="modal"><div class="eyebrow">ORGANISATION-CONTROLLED DATA</div><h2>Add a map feature</h2><p>Use authoritative details. Accessibility information is only saved when your organisation has verified it.</p><label>Name<input id="feature-name" maxlength="120" placeholder="e.g. North entrance"></label><label>Feature type<select id="feature-type"><option>building</option><option>entrance</option><option>exit</option><option>room</option><option>bathroom</option><option>stairs</option><option>lift</option><option>ramp</option><option>event_location</option><option>restricted_area</option></select></label><label>Description<input id="feature-description" placeholder="Optional organisation-provided detail"></label><label>Verified accessibility detail<input id="feature-accessibility" placeholder="Leave blank unless verified"></label><label class="check-label"><input type="checkbox" id="feature-verified"> I have verified this information</label><p class="feature-placement">Next, click the real map to place this feature.</p><footer><button class="button" data-cancel-feature>Cancel</button><button class="button button-primary" data-place-feature>Choose map location</button></footer></section></div>`;
  modal.querySelector('[data-cancel-feature]').onclick = () => { modal.innerHTML = ''; };
  modal.querySelector('[data-place-feature]').onclick = () => {
    const name = modal.querySelector('#feature-name').value.trim();
    if (!name) return toast('Add a name first.', true);
    state.pendingFeature = { name, type: modal.querySelector('#feature-type').value, description: modal.querySelector('#feature-description').value, accessibility: modal.querySelector('#feature-accessibility').value, verified: modal.querySelector('#feature-verified').checked };
    modal.innerHTML = ''; state.mode = 'feature'; toast('Click a location on the real map to save this feature.');
  };
}
function selectFeatureLocation(point) {
  if (!state.pendingFeature) return;
  api('/api/features', { method: 'POST', body: { ...state.pendingFeature, lat: point.lat, lng: point.lng, eventId: state.eventId } }).then(() => {
    state.pendingFeature = null; state.mode = ''; loadFeatures(); toast('Organisation feature saved.');
  }).catch((error) => toast(error.message, true));
}
function startOrgPathDrawing() {
  state.mode = 'org-path'; state.orgPoints = [];
  const surface = document.querySelector('#admin-draw-surface');
  surface.classList.add('active');
  surface.onpointerdown = (event) => { event.preventDefault(); surface.setPointerCapture(event.pointerId); state.drawing = true; state.orgPoints = []; addOrgPoint(event); };
  surface.onpointermove = (event) => { if (state.drawing) addOrgPoint(event); };
  surface.onpointerup = async () => {
    if (!state.drawing) return; state.drawing = false; surface.classList.remove('active'); surface.onpointerdown = surface.onpointermove = surface.onpointerup = null;
    const coords = state.orgPoints.map(({ lng, lat }) => [lng, lat]);
    if (coords.length < 2) { state.mode = ''; return toast('Draw a longer path.'); }
    const name = prompt('Name this organisation-managed pedestrian path');
    if (!name) { state.mode = ''; return; }
    try { await api('/api/features', { method: 'POST', body: { name, type: 'pedestrian_path', geometry: { type: 'LineString', coordinates: coords }, eventId: state.eventId } }); await loadFeatures(); toast('Pedestrian path saved. Note: the public Valhalla network does not yet include this private path.'); }
    catch (error) { toast(error.message, true); }
    state.mode = '';
  };
}
function addOrgPoint(event) {
  const rect = state.map.getCanvas().getBoundingClientRect();
  const ll = state.map.unproject([event.clientX - rect.left, event.clientY - rect.top]);
  const p = { lat: ll.lat, lng: ll.lng };
  if (!state.orgPoints.length || haversine(state.orgPoints.at(-1), p) > 4) state.orgPoints.push(p);
  showPreview(state.orgPoints);
}
async function uploadPlan(event) {
  const file = event.target.files?.[0]; if (!file) return;
  const form = new FormData(); form.set('plan', file);
  try {
    const result = await api('/api/imports', { method: 'POST', body: form });
    document.querySelector('#plan-file').value = '';
    const suggestions = result.suggestions || [];
    const target = document.querySelector('#map-feature-modal') || document.querySelector('#admin-content');
    target.insertAdjacentHTML('beforeend', `<div class="import-notice"><b>${esc(result.name)} uploaded${result.aiEnabled ? ' · AI suggestions ready for review' : ''}</b><span>${result.aiEnabled ? 'Suggestions are not verified. Confirming stores items without coordinates or accessibility claims.' : 'Add OPENAI_API_KEY to enable live AI suggestions. The uploaded plan is stored privately on this server.'}</span>${suggestions.map((s, i) => `<label><input type="checkbox" data-suggestion="${i}" checked>${esc(s.type)} · ${esc(s.name)}<small>${esc(s.note)}</small></label>`).join('')}${suggestions.length ? `<button class="button" data-import-id="${result.id}">Confirm selected suggestions</button>` : ''}</div>`);
    target.querySelector('[data-import-id]')?.addEventListener('click', async (e) => {
      const accepted = [...target.querySelectorAll('[data-suggestion]:checked')].map((x) => Number(x.dataset.suggestion));
      const confirmed = await api(`/api/imports/${e.currentTarget.dataset.importId}/confirm`, { method: 'POST', body: { accepted } });
      toast(`${confirmed.confirmedSuggestions} items added as unverified map features.`); e.currentTarget.parentElement.remove();
    });
  } catch (error) { toast(error.message, true); }
}
async function submitAssistant(event) {
  event.preventDefault();
  const result = document.querySelector('#ai-result'); const message = new FormData(event.currentTarget).get('message');
  result.innerHTML = '<div class="ai-loading">Interpreting request with OpenAI…</div>';
  try {
    const data = await api('/api/ai/proposals', { method: 'POST', body: { message } });
    const p = data.proposal;
    result.innerHTML = `<div class="proposal-card"><div class="proposal-heading"><span>PROPOSED · REVIEW BEFORE PUBLISHING</span><b>${esc(p.action)}</b></div><h3>${esc(p.title)}</h3><p>${esc(p.description)}</p>${p.name ? `<div class="proposal-field"><small>Name / affected item</small><b>${esc(p.name)}</b></div>` : ''}${p.startsAt || p.endsAt ? `<div class="proposal-field"><small>Time</small><b>${esc(p.startsAt || 'Not specified')} — ${esc(p.endsAt || 'Not specified')}</b></div>` : ''}${p.insight ? `<div class="proposal-field"><small>Aggregate insight</small><b>${esc(p.insight)}</b></div>` : ''}<p class="no-access-inference">Accessibility information was not generated by AI.</p><button class="button button-primary" data-confirm-proposal="${data.id}">Confirm reviewed action</button><button class="button" data-cancel-proposal="${data.id}">Dismiss</button></div>`;
    result.querySelector('[data-confirm-proposal]').onclick = async () => { const reply = await api(`/api/ai/proposals/${data.id}/confirm`, { method: 'POST', body: {} }); result.innerHTML = `<div class="proposal-confirmed">✓ ${esc(reply.status)} · Admin action recorded.</div>`; };
    result.querySelector('[data-cancel-proposal]').onclick = () => { result.innerHTML = ''; };
  } catch (error) { result.innerHTML = `<div class="ai-error">${esc(error.message)}</div>`; }
}
async function exportAnalytics() {
  const { counts, destinations, areas } = await api('/api/analytics');
  const lines = [['metric','value'], ...Object.entries(counts), ['searched_destinations','count'], ...destinations.map((d) => [d.name,d.count]), ['activity_areas','count'], ...areas.map((a) => [a.cell,a.count])];
  const csv = lines.map((row) => row.map((v) => `"${String(v).replaceAll('"','""')}"`).join(',')).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'people-map-analytics.csv'; a.click(); URL.revokeObjectURL(a.href);
}
function showAbout() {
  document.querySelector('#modal-root').innerHTML = `<div class="modal-backdrop"><section class="modal about-modal"><div class="brand-mark">P</div><h2>People Map</h2><p>The pedestrian layer for physical spaces.</p><p class="secondary-copy">Organisations manage the map. People manage their journey. Draw a walk on the real map, then save and share it.</p><footer><button class="button button-primary" data-close-about>Explore campus</button></footer></section></div>`;
  document.querySelector('[data-close-about]').onclick = () => { document.querySelector('#modal-root').innerHTML = ''; };
}

// Open shared routes directly with ?route=<id> while keeping the geographic map as the first screen.
api('/api/config').then((config) => { state.config = config; state.eventId = config.event?.id || state.eventId; }).catch(() => {});
shell();
