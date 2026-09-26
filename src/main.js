import { places, buildings, hourlyActivity, destinationActivity } from './data.js';
import './styles.css';

const state = {
  page: 'map', query: '', selected: '', favorites: new Set(), pins: [],
  stepFree: false, avoidBusy: false, drawMode: false, pinMode: false,
  addFeature: '', routePoints: [], savedRoute: false, closure: null, uploadName: '',
};
const app = document.querySelector('#app');
const esc = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function campusMap({ admin = false } = {}) {
  const paths = state.stepFree
    ? 'M130 190 Q210 230 310 300 T430 270 T570 190 M310 300 Q470 330 600 340'
    : 'M130 190 Q220 285 310 300 T430 270 T570 190 M310 300 Q490 275 600 340';
  return `<svg class="campus-map ${admin ? 'admin-map-svg' : ''}" viewBox="0 0 900 600" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Illustrated University of Canterbury campus map">
    <rect width="900" height="600" fill="#e9f0e7" />
    <path class="road" d="M-30 460 C170 400 360 465 545 392 S770 335 940 360"/><path class="road-dash" d="M-30 460 C170 400 360 465 545 392 S770 335 940 360"/>
    <path class="road" d="M262 -20 C302 140 260 266 340 400 S400 520 420 630"/><path class="road-dash" d="M262 -20 C302 140 260 266 340 400 S400 520 420 630"/>
    <g class="greenery"><path d="M35 80h105v90H35zM165 25h65v90h-65zM685 44h178v84H685zM735 176h125v96H735zM660 435h188v108H660zM60 510h225v60H60z"/><circle cx="75" cy="260" r="37"/><circle cx="781" cy="380" r="44"/><circle cx="560" cy="75" r="30"/><circle cx="176" cy="391" r="29"/><circle cx="390" cy="72" r="25"/><circle cx="625" cy="520" r="24"/></g>
    <path class="footpath" d="M118 175 Q300 205 410 145T720 160 M110 330 Q220 270 320 310T510 265T740 295 M490 115 Q510 200 495 290T600 460 M165 470 Q225 390 310 335"/>
    <g class="map-buildings">${buildings.map((b) => `<g><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="8"/><text x="${b.x + 12}" y="${b.y + b.h / 2 + 4}">${esc(b.name)}</text></g>`).join('')}</g>
    <g class="map-road-label"><text x="74" y="453">University Drive</text><text x="435" y="545">Ilam Road</text><text x="647" y="102">BOTANIC GARDEN</text><text x="28" y="294">ILAM FIELDS</text></g>
    ${state.closure ? `<g class="closure-mark"><rect x="525" y="137" width="164" height="104" rx="10"/><text x="567" y="195">CLOSED</text></g>` : ''}
    <polyline class="route-line ${state.selected ? '' : 'is-hidden'}" points="130,190 220,252 310,300 430,270 500,223 570,190" />
    ${state.routePoints.length > 0 ? `<polyline class="route-line user-route" points="${state.routePoints.map((p) => `${p.x},${p.y}`).join(' ')}" />` : ''}
    ${places.map((p) => `<g class="map-place ${state.selected === p.id ? 'is-selected' : ''}" data-place="${p.id}" transform="translate(${p.x} ${p.y})"><circle r="15"/><text y="1">${p.icon}</text></g>`).join('')}
    ${state.pins.map((p, i) => `<g class="map-place user-pin" transform="translate(${p.x} ${p.y})"><circle r="14"/><text y="1">${i + 1}</text></g>`).join('')}
    ${state.addFeature ? `<g class="feature-hint" transform="translate(450 260)"><circle r="17"/><text y="1">＋</text></g>` : ''}
  </svg>`;
}

function filteredPlaces() {
  const q = state.query.trim().toLowerCase();
  return places.filter((p) => !q || `${p.name} ${p.type} ${p.detail}`.toLowerCase().includes(q));
}

function visitorView() {
  const result = filteredPlaces();
  const rows = result.map((p) => `<article class="place-row ${state.selected === p.id ? 'selected' : ''}" data-select="${p.id}">
    <span class="place-icon">${p.icon}</span><span class="place-copy"><b>${esc(p.name)}</b><small>${esc(p.type)} · ${esc(p.detail)}</small></span>
    <button class="favorite-btn ${state.favorites.has(p.id) ? 'is-favorite' : ''}" data-favorite="${p.id}" aria-label="${state.favorites.has(p.id) ? 'Remove saved place' : 'Save place'}">${state.favorites.has(p.id) ? '★' : '☆'}</button>
  </article>`).join('') || '<p class="empty-state">No places match that search.</p>';
  const sideTitle = state.query ? 'Search results' : state.favoritesView ? 'Saved places' : 'Popular places';
  return `<section class="page visitor-page"><header class="page-heading"><div><div class="eyebrow">UNIVERSITY OF CANTERBURY · CHRISTCHURCH</div><h1>Find your way around</h1><p>Explore campus, find your next stop, and get there your way.</p></div><button class="button" data-action="share-map">↗ <span>Share map</span></button></header>
    <nav class="view-tabs"><button class="view-tab active" data-action="browse">Campus map</button><button class="view-tab" data-action="favorites-view">Saved places <span class="count">${state.favorites.size}</span></button><button class="view-tab" data-action="events-view">Open Day events</button></nav>
    <div class="map-layout"><aside class="visitor-panel"><label class="search-box"><span>⌕</span><input id="place-search" value="${esc(state.query)}" placeholder="Search places, buildings, rooms…" aria-label="Search places"><kbd>⌘ K</kbd></label>
      <div class="section-label"><b>${sideTitle}</b><span>UC CAMPUS</span></div><div class="place-list">${rows}</div>
      <div class="route-card"><div class="route-card-heading"><b>Walking route</b><button class="button button-primary button-small" data-action="get-route">↗ Route</button></div>
        <label class="switch-row"><span>♿ &nbsp;Step-free route</span><button class="switch ${state.stepFree ? 'on' : ''}" data-action="step-free" role="switch" aria-checked="${state.stepFree}" aria-label="Step-free route"></button></label>
        <label class="switch-row"><span>⏱ &nbsp;Avoid busy paths</span><button class="switch ${state.avoidBusy ? 'on' : ''}" data-action="avoid-busy" role="switch" aria-checked="${state.avoidBusy}" aria-label="Avoid busy paths"></button></label>
        ${state.selected ? `<div class="route-result"><span>12 min · 850 m</span><b>${state.stepFree ? 'Step-free ✓' : 'Walking route'}</b><div class="route-actions"><button class="button button-small" data-action="save-route">${state.savedRoute ? '★ Saved route' : '☆ Save route'}</button><button class="button button-small" data-action="share-route">↗ Share</button></div></div>` : ''}
      </div>
    </aside><div class="map-stage"><div class="map-toolbar"><button class="map-tool ${!state.drawMode && !state.pinMode ? 'active' : ''}" data-action="explore">Explore</button><button class="map-tool ${state.drawMode ? 'active' : ''}" data-action="draw-route">✎ Draw route</button><button class="map-tool ${state.pinMode ? 'active' : ''}" data-action="drop-pin">＋ Drop pin</button></div><button class="map-tool layers-tool" data-action="layers">☷ Layers</button>
      ${campusMap()}<div class="map-hint">${state.drawMode ? 'Click the map to add route points · Save route when you are done' : state.pinMode ? 'Click anywhere on the map to drop a pin' : '<b>UC campus</b> · Walking routes · Accessible places'}</div><div class="zoom-control"><button aria-label="Zoom in">+</button><button aria-label="Zoom out">−</button></div></div></div></section>`;
}

function adminView() {
  const closure = state.closure || { location: 'Eastern entrance', day: 'Saturday', start: '9:00 am', end: '4:00 pm' };
  const features = [['Building','⌂'],['Entrance','↗'],['Room','▢'],['Bathroom','♿'],['Stairs','⌁'],['Lift','↟'],['Ramp','⇗'],['Event location','✳']];
  return `<section class="page"><header class="page-heading"><div><div class="eyebrow">ORGANISATION WORKSPACE · UC</div><h1>Map manager</h1><p>Build and update the map people use to find their way.</p></div><button class="button button-primary" data-action="publish">✓ &nbsp;Publish updates</button></header>
    <nav class="view-tabs"><button class="view-tab active">Map editor</button><button class="view-tab">Events & closures</button><button class="view-tab">Map settings</button></nav>
    <div class="admin-layout"><div class="map-stage admin-stage"><div class="map-toolbar"><button class="map-tool active" data-action="clear-feature">Select</button><button class="map-tool" data-action="arm-feature">＋ Add point</button><button class="map-tool" data-action="closure-toggle">▧ Mark closure</button></div>${campusMap({ admin: true })}<div class="map-hint">${state.addFeature ? `Click map to place: ${esc(state.addFeature)}` : 'Select a feature type, then click to place it'}</div></div>
      <aside class="admin-sidebar"><div class="panel-card"><h2>Map features</h2><p class="muted">Add verified details to your pedestrian map.</p><div class="feature-grid">${features.map(([name, icon]) => `<button class="feature-button ${state.addFeature === name ? 'selected' : ''}" data-feature="${name}"><span>${icon}</span>${name}</button>`).join('')}</div>
        <label class="upload-box">⇧ <b>Upload floor or site plan</b><small>PNG, JPG or PDF · AI suggestions need review</small><input type="file" accept="image/png,image/jpeg,application/pdf" hidden data-action="upload"></label>${state.uploadName ? `<div class="upload-status">✓ ${esc(state.uploadName)} uploaded · suggestions ready for review</div>` : ''}</div>
      <div class="panel-card"><div class="panel-title-row"><div><h2>Open Day updates</h2><p class="muted">Temporary changes shown to visitors</p></div><button class="button button-small" data-action="ai-closure">✧ Add with AI</button></div>
        <div class="closure-card"><b>⚠ ${esc(closure.location)} closed</b><span>${esc(closure.day)} · ${esc(closure.start)} – ${esc(closure.end)}</span><small>Visitors are directed to the north entrance.</small></div>
        <div class="event-card"><span><b>UC Open Day</b><small>Saturday · 9:00 am–3:00 pm</small></span><span class="status-pill">Published</span></div><button class="button full-width" data-action="new-event">＋ Create event location</button>
      </div></aside></div></section>`;
}

function analyticsView() {
  const bars = hourlyActivity.map((v, i) => `<div class="bar-group"><i class="bar users" style="height:${v}%"></i><i class="bar routes" style="height:${Math.round(v * .73)}%"></i><small>${8 + i}:00</small></div>`).join('');
  const ranks = destinationActivity.map((d, i) => `<div class="ranking-row"><span class="rank">0${i + 1}</span><b>${esc(d.name)}</b><span class="rank-meter"><i style="width:${d.share}%"></i></span><span>${d.count}</span></div>`).join('');
  return `<section class="page"><header class="page-heading"><div><div class="eyebrow">ORGANISATION INSIGHTS · UC OPEN DAY</div><h1>Analytics</h1><p>Aggregated insights to understand how people navigate your space.</p></div><button class="button" data-action="export">⇩ &nbsp;Export</button></header>
    <div class="analytics-context"><span class="status-pill">UC Open Day</span><span>Sample event data · Counts are aggregated; no individual journeys shown</span></div>
    <div class="metric-grid"><article class="metric-card"><div>Map users <span>◉</span></div><strong>2,846</strong><small>↑ 18% <i>vs previous event</i></small></article><article class="metric-card"><div>Route searches <span>⌁</span></div><strong>4,219</strong><small>↑ 24% <i>vs previous event</i></small></article><article class="metric-card"><div>Step-free requests <span>♿</span></div><strong>684</strong><small>16% <i>of route searches</i></small></article><article class="metric-card"><div>Pins & reports <span>⌖</span></div><strong>137</strong><small>92 resolved <i>by map team</i></small></article></div>
    <div class="analytics-grid"><article class="panel-card"><div class="panel-title-row"><div><h2>Map activity</h2><p class="muted">Aggregated map opens and route searches by hour</p></div><span class="filter-label">Open Day · Today</span></div><div class="activity-chart">${bars}</div><div class="chart-legend"><span><i class="legend-dot users"></i>Map users</span><span><i class="legend-dot routes"></i>Route searches</span></div></article>
      <article class="panel-card"><div class="panel-title-row"><div><h2>Most searched destinations</h2><p class="muted">Where visitors are heading</p></div><span class="filter-label">All destinations</span></div><div class="ranking-list">${ranks}</div></article>
      <article class="panel-card"><div class="panel-title-row"><div><h2>Popular entrances & paths</h2><p class="muted">High-level campus flow</p></div><span class="status-pill">Aggregated</span></div><div class="insight-row"><span>North entrance <small>· primary arrival</small></span><b>38%</b></div><div class="insight-row"><span>Central spine <small>· busiest path</small></span><b>1,204</b></div><div class="insight-row"><span>Eastern entrance <small>· closure reroute</small></span><b>+12%</b></div></article>
      <article class="panel-card"><div class="panel-title-row"><div><h2>Event activity</h2><p class="muted">Open Day visitor navigation</p></div><span class="status-pill">Event</span></div><div class="insight-row"><span>Step-free route requests</span><b>684</b></div><div class="insight-row"><span>Closure reroutes</span><b>216</b></div><div class="insight-row"><span>Visitor pins & reports</span><b>137</b></div><div class="insight-note"><b>Insight</b> Closure reroutes increased north entrance use by 12%. Consider keeping extra wayfinding signs at the eastern approach.</div></article></div></section>`;
}

function render() {
  const title = state.page === 'map' ? 'Visitor map' : state.page === 'admin' ? 'Map manager' : 'Analytics';
  app.innerHTML = `<aside class="rail"><a class="brand" href="#" aria-label="People Map home">P</a><nav class="rail-nav" aria-label="Main navigation"><button class="rail-button ${state.page === 'map' ? 'active' : ''}" data-page="map" aria-label="Visitor map">⌖</button><button class="rail-button ${state.page === 'admin' ? 'active' : ''}" data-page="admin" aria-label="Map manager">▦</button><button class="rail-button ${state.page === 'analytics' ? 'active' : ''}" data-page="analytics" aria-label="Analytics">▥</button></nav><div class="rail-bottom">?</div></aside><main class="main"><header class="topbar"><div>UC · University of Canterbury <span>/</span> <b>${title}</b></div><div class="topbar-right"><span class="live-pill"><i></i>Open Day · Live map</span><span class="avatar">J</span></div></header>${state.page === 'map' ? visitorView() : state.page === 'admin' ? adminView() : analyticsView()}</main><div class="toast" role="status" aria-live="polite"></div>${state.modal ? modalView() : ''}`;
  bindEvents();
}

function modalView() {
  return `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="eyebrow">AI-ASSISTED UPDATE</div><h2 id="modal-title">Review suggested change</h2><p>AI can structure the closure you describe. Confirm all details before it appears on the visitor map. Accessibility details must come from verified organisation data.</p><label for="closure-note">Describe the change</label><textarea id="closure-note">${esc(state.modalText || 'The eastern entrance is closed Saturday from 9am to 4pm.')}</textarea><div class="suggestion-preview">${state.suggestion ? `<b>Suggested closure</b><span>${esc(state.suggestion.location)} · ${esc(state.suggestion.day)}, ${esc(state.suggestion.start)}–${esc(state.suggestion.end)}</span>` : 'Select “Review suggestion” to structure the note.'}</div><footer><button class="button" data-action="close-modal">Cancel</button><button class="button" data-action="review-note">Review suggestion</button><button class="button button-primary" data-action="confirm-closure" ${state.suggestion ? '' : 'disabled'}>Confirm closure</button></footer></section></div>`;
}

let toastTimer;
function toast(message) {
  const el = document.querySelector('.toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('visible'), 2400);
}

async function share(text) {
  try { await navigator.clipboard.writeText(text); toast('Link copied to clipboard'); }
  catch { toast('Share link: ' + text); }
}

function parseClosure(text) {
  const day = text.match(/\b(Saturday|Sunday|Monday|Tuesday|Wednesday|Thursday|Friday)\b/i)?.[0] || 'Saturday';
  const location = text.match(/(?:the\s+)?([\w -]+?\s+(?:entrance|gate|path|building|room))\s+(?:is\s+)?closed/i)?.[1]?.replace(/^the\s+/i, '').trim() || 'Eastern entrance';
  const times = [...text.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/gi)].map((m) => `${m[1]}${m[2] ? `:${m[2]}` : ':00'} ${m[3].toLowerCase()}`);
  return { location: location.replace(/\b\w/g, (c) => c.toUpperCase()), day: day[0].toUpperCase() + day.slice(1).toLowerCase(), start: times[0] || '9:00 am', end: times[1] || '4:00 pm' };
}

function bindEvents() {
  document.querySelectorAll('[data-page]').forEach((el) => el.addEventListener('click', () => { state.page = el.dataset.page; state.modal = false; render(); }));
  const search = document.querySelector('#place-search');
  search?.addEventListener('input', (e) => { const pos = e.target.selectionStart; state.query = e.target.value; render(); const next = document.querySelector('#place-search'); next.focus(); next.setSelectionRange(pos, pos); });
  document.querySelectorAll('[data-select]').forEach((el) => el.addEventListener('click', () => { state.selected = el.dataset.select; state.favoritesView = false; render(); }));
  document.querySelectorAll('[data-favorite]').forEach((el) => el.addEventListener('click', (e) => { e.stopPropagation(); const id = el.dataset.favorite; state.favorites.has(id) ? state.favorites.delete(id) : state.favorites.add(id); render(); toast(state.favorites.has(id) ? 'Place saved' : 'Place removed from saved places'); }));
  document.querySelectorAll('[data-action]').forEach((el) => el.addEventListener(el.type === 'file' ? 'change' : 'click', (e) => handleAction(e, el)));
  document.querySelectorAll('[data-feature]').forEach((el) => el.addEventListener('click', () => { state.addFeature = el.dataset.feature; render(); }));
  document.querySelectorAll('.map-stage').forEach((stage) => stage.addEventListener('click', handleMapClick));
  document.querySelectorAll('.zoom-control button').forEach((el) => el.addEventListener('click', () => toast('Map zoom updated')));
  document.querySelectorAll('.campus-map [data-place]').forEach((el) => el.addEventListener('click', (e) => { e.stopPropagation(); if (state.page === 'map') { state.selected = el.dataset.place; render(); } }));
}

function handleAction(event, el) {
  const action = el.dataset.action;
  if (action === 'browse') { state.favoritesView = false; state.query = ''; render(); }
  if (action === 'favorites-view') { state.favoritesView = true; state.query = ''; render(); document.querySelector('.section-label b').textContent = 'Saved places'; document.querySelector('.place-list').innerHTML = places.filter((p) => state.favorites.has(p.id)).map((p) => `<article class="place-row" data-select="${p.id}"><span class="place-icon">${p.icon}</span><span class="place-copy"><b>${esc(p.name)}</b><small>${esc(p.type)} · ${esc(p.detail)}</small></span></article>`).join('') || '<p class="empty-state">Saved places will appear here.</p>'; bindSavedRows(); }
  if (action === 'events-view') { state.query = 'Open Day'; state.favoritesView = false; render(); }
  if (action === 'step-free') { state.stepFree = !state.stepFree; render(); }
  if (action === 'avoid-busy') { state.avoidBusy = !state.avoidBusy; render(); }
  if (action === 'get-route') { if (!state.selected) return toast('Choose a destination first'); render(); toast(`Accessible walking route to ${places.find((p) => p.id === state.selected)?.name}`); }
  if (action === 'save-route') { state.savedRoute = !state.savedRoute; render(); toast(state.savedRoute ? 'Route saved' : 'Route removed from saved routes'); }
  if (action === 'share-route' || action === 'share-map') share(`${location.origin}${location.pathname}#${action === 'share-route' ? `route=${state.selected}` : 'campus'}`);
  if (action === 'draw-route') { state.drawMode = !state.drawMode; state.pinMode = false; state.routePoints = []; render(); }
  if (action === 'drop-pin') { state.pinMode = !state.pinMode; state.drawMode = false; render(); }
  if (action === 'explore') { state.drawMode = false; state.pinMode = false; render(); }
  if (action === 'layers') toast('Layers: buildings · walking paths · accessible places');
  if (action === 'publish') toast('Map updates published');
  if (action === 'closure-toggle') { state.closure = state.closure ? null : parseClosure('Eastern entrance closed Saturday from 9am to 4pm'); render(); }
  if (action === 'clear-feature') { state.addFeature = ''; render(); }
  if (action === 'arm-feature') { state.addFeature = state.addFeature || 'Entrance'; render(); }
  if (action === 'ai-closure') { state.modal = true; state.suggestion = null; state.modalText = 'The eastern entrance is closed Saturday from 9am to 4pm.'; render(); }
  if (action === 'close-modal') { state.modal = false; render(); }
  if (action === 'review-note') { state.modalText = document.querySelector('#closure-note').value; state.suggestion = parseClosure(state.modalText); render(); }
  if (action === 'confirm-closure') { if (!state.suggestion) return; state.closure = state.suggestion; state.modal = false; state.suggestion = null; render(); toast('Closure added to draft map updates'); }
  if (action === 'new-event') toast('Event location added to draft');
  if (action === 'export') toast('Analytics export prepared');
  if (action === 'upload' && event.target.files?.[0]) { state.uploadName = event.target.files[0].name; render(); toast('Plan uploaded · review AI suggestions before publishing'); }
}

function bindSavedRows() {
  document.querySelectorAll('.place-list [data-select]').forEach((row) => row.addEventListener('click', () => { state.selected = row.dataset.select; state.page = 'map'; state.favoritesView = false; render(); }));
}

function handleMapClick(event) {
  if (event.target.closest('button') || event.target.closest('[data-place]')) return;
  const svg = event.currentTarget.querySelector('.campus-map');
  if (!svg || (!state.pinMode && !state.drawMode && !state.addFeature)) return;
  const rect = svg.getBoundingClientRect();
  const point = { x: Math.round((event.clientX - rect.left) * 900 / rect.width), y: Math.round((event.clientY - rect.top) * 600 / rect.height) };
  if (state.pinMode) { state.pins.push(point); render(); toast('Pin placed on the map'); }
  else if (state.drawMode) { state.routePoints.push(point); render(); }
  else if (state.addFeature) { const feature = state.addFeature; state.addFeature = ''; render(); toast(`${feature} added to draft map`); }
}

document.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); document.querySelector('#place-search')?.focus(); } });
render();
