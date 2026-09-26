import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import OpenAI from 'openai';
import initSqlJs from 'sql.js';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = express();
const port = Number(process.env.PORT || 4174);
const photonBase = process.env.PHOTON_URL || 'https://photon.komoot.io';
const valhallaBase = process.env.VALHALLA_URL || 'https://valhalla1.openstreetmap.de';
const dataDir = path.resolve(root, 'data');
const dbPath = path.resolve(root, process.env.DATABASE_FILE || './data/people-map.sqlite');
await mkdir(path.dirname(dbPath), { recursive: true });
await mkdir(path.join(dataDir, 'uploads'), { recursive: true });
const SQL = await initSqlJs({ locateFile: (file) => new URL(`../node_modules/sql.js/dist/${file}`, import.meta.url).pathname });
const sqlite = existsSync(dbPath) ? new SQL.Database(new Uint8Array(readFileSync(dbPath))) : new SQL.Database();
let transactionDepth = 0;
let dirty = false;
function persistDatabase() {
  if (transactionDepth) { dirty = true; return; }
  writeFileSync(dbPath, Buffer.from(sqlite.export()));
  dirty = false;
}
const db = {
  exec(query) { sqlite.exec(query); persistDatabase(); },
  prepare(query) {
    return {
      run(...params) {
        const statement = sqlite.prepare(query);
        statement.bind(params);
        while (statement.step()) { /* statements may return rows; run discards them */ }
        statement.free();
        const changes = sqlite.getRowsModified();
        persistDatabase();
        return { changes };
      },
      get(...params) {
        const statement = sqlite.prepare(query); statement.bind(params);
        const row = statement.step() ? statement.getAsObject() : undefined;
        statement.free(); return row;
      },
      all(...params) {
        const statement = sqlite.prepare(query); statement.bind(params);
        const rows = []; while (statement.step()) rows.push(statement.getAsObject());
        statement.free(); return rows;
      },
    };
  },
  transaction(callback) {
    return (...args) => {
      sqlite.run('BEGIN'); transactionDepth++;
      try {
        const result = callback(...args);
        transactionDepth--; sqlite.run('COMMIT');
        if (dirty) persistDatabase();
        return result;
      } catch (error) {
        transactionDepth--; sqlite.run('ROLLBACK'); dirty = false; throw error;
      }
    };
  },
};
sqlite.run('PRAGMA foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS organisations (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id),
    name TEXT NOT NULL, starts_at TEXT, ends_at TEXT, status TEXT NOT NULL DEFAULT 'draft', created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS places (
    id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id), event_id TEXT,
    name TEXT NOT NULL, type TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
    lat REAL, lng REAL, accessibility TEXT NOT NULL DEFAULT '', verified INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'organisation', created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS pedestrian_paths (
    id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id), event_id TEXT,
    name TEXT NOT NULL, path_type TEXT NOT NULL DEFAULT 'pedestrian_path', geometry TEXT NOT NULL,
    step_free INTEGER NOT NULL DEFAULT 0, verified INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'published', created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS closures (
    id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id), event_id TEXT,
    name TEXT NOT NULL, feature_id TEXT, starts_at TEXT, ends_at TEXT, geometry TEXT,
    status TEXT NOT NULL DEFAULT 'published', created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS routes (
    id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL, event_id TEXT, session_id TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '', geometry TEXT NOT NULL, distance_m REAL NOT NULL, duration_s REAL NOT NULL,
    step_free INTEGER NOT NULL DEFAULT 0, avoid_stairs INTEGER NOT NULL DEFAULT 0, start_name TEXT NOT NULL DEFAULT '', destination_name TEXT NOT NULL DEFAULT '',
    route_kind TEXT NOT NULL DEFAULT 'drawn', created_at TEXT NOT NULL, saved INTEGER NOT NULL DEFAULT 0, shared INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS route_pins (
    id TEXT PRIMARY KEY, route_id TEXT REFERENCES routes(id) ON DELETE CASCADE, session_id TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT 'Route pin', lat REAL NOT NULL, lng REAL NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS usage_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, organisation_id TEXT NOT NULL, event_id TEXT,
    kind TEXT NOT NULL, area_cell TEXT NOT NULL DEFAULT '', label TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ai_proposals (
    id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL, event_id TEXT, action TEXT NOT NULL,
    proposal TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, confirmed_at TEXT
  );
  CREATE TABLE IF NOT EXISTS imports (
    id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL, file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL, file_path TEXT NOT NULL, suggestions TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'uploaded', created_at TEXT NOT NULL
  );
`);
const usageColumns = sqlite.exec('PRAGMA table_info(usage_events)')[0].values.map((column) => column[1]);
if (!usageColumns.includes('session_id')) db.exec("ALTER TABLE usage_events ADD COLUMN session_id TEXT NOT NULL DEFAULT ''");
const routeColumns = sqlite.exec('PRAGMA table_info(routes)')[0].values.map((column) => column[1]);
if (!routeColumns.includes('avoid_stairs')) db.exec('ALTER TABLE routes ADD COLUMN avoid_stairs INTEGER NOT NULL DEFAULT 0');
const now = () => new Date().toISOString();
db.prepare('INSERT OR IGNORE INTO organisations(id,name,created_at) VALUES(?,?,?)').run('uc', 'University of Canterbury', now());
if (!db.prepare('SELECT 1 FROM events WHERE id=?').get('uc-open-day-demo')) {
  db.prepare('INSERT INTO events(id,organisation_id,name,status,created_at) VALUES(?,?,?,?,?)').run('uc-open-day-demo', 'uc', 'UC Open Day · Demo event', 'draft', now());
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, path.join(dataDir, 'uploads')),
    filename: (_req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 12 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, ['image/png', 'image/jpeg', 'application/pdf'].includes(file.mimetype)),
});

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

function ensure(value, message) { if (!value) { const error = new Error(message); error.status = 400; throw error; } }
function record(kind, { eventId = 'uc-open-day-demo', label = '', lat, lng, sessionId = '' } = {}) {
  // Rounded area cells are approximately 100 m; exact user coordinates stay with the route only when a route is explicitly saved.
  const cell = Number.isFinite(lat) && Number.isFinite(lng) ? `${lat.toFixed(3)},${lng.toFixed(3)}` : '';
  db.prepare('INSERT INTO usage_events(organisation_id,event_id,kind,area_cell,label,created_at,session_id) VALUES(?,?,?,?,?,?,?)')
    .run('uc', eventId, kind, cell, String(label).slice(0, 120), now(), String(sessionId).slice(0, 80));
}
function routeSummary(row) {
  const pins = db.prepare('SELECT id,label,lat,lng,created_at FROM route_pins WHERE route_id=? ORDER BY created_at').all(row.id);
  return { ...row, geometry: JSON.parse(row.geometry), pins, step_free: Boolean(row.step_free), avoid_stairs: Boolean(row.avoid_stairs), saved: Boolean(row.saved), shared: Boolean(row.shared) };
}
function decodePolyline6(value) {
  let index = 0, lat = 0, lng = 0;
  const points = [];
  while (index < value.length) {
    let result = 0, shift = 0, byte;
    do { byte = value.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    result = 0; shift = 0;
    do { byte = value.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);
    points.push([lng / 1e6, lat / 1e6]);
  }
  return points;
}
function asGeometry(shape) {
  if (shape?.type === 'LineString' && Array.isArray(shape.coordinates)) return shape;
  if (typeof shape === 'string') return { type: 'LineString', coordinates: decodePolyline6(shape) };
  throw new Error('Walking service returned no route geometry');
}
async function valhalla(pathname, body) {
  const response = await fetch(`${valhallaBase.replace(/\/$/, '')}/${pathname}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(25_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) throw new Error(payload.error || `Walking service returned ${response.status}`);
  return payload;
}
function assistantClient() {
  if (!process.env.OPENAI_API_KEY) { const error = new Error('Set OPENAI_API_KEY in .env to enable the AI assistant.'); error.status = 503; throw error; }
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

app.get('/api/health', (_req, res) => res.json({ ok: true, maps: 'open-data', ai: Boolean(process.env.OPENAI_API_KEY) }));
app.get('/api/config', (_req, res) => res.json({
  mapStyle: { version: 8, sources: { openstreetmap: { type: 'raster', tiles: [process.env.MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap contributors' } }, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e9f0e7' } }, { id: 'openstreetmap', type: 'raster', source: 'openstreetmap', paint: { 'raster-fade-duration': 0 } }] },
  aiEnabled: Boolean(process.env.OPENAI_API_KEY), organisation: { id: 'uc', name: 'University of Canterbury' }, event: db.prepare('SELECT id,name,status FROM events WHERE id=?').get('uc-open-day-demo'),
}));

app.get('/api/search', async (req, res, next) => {
  try {
    const query = String(req.query.q || '').trim();
    ensure(query.length >= 2, 'Enter at least two characters to search.');
    const url = new URL('/api/', photonBase);
    url.search = new URLSearchParams({ q: query, lat: '-43.523', lon: '172.583', limit: '8', lang: 'en' }).toString();
    const response = await fetch(url, { headers: { 'user-agent': 'PeopleMap/0.2 contact: mapmap-demo' }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`Place search returned ${response.status}`);
    const data = await response.json();
    const features = data.features || [];
    const label = (feature) => [feature.properties?.name, feature.properties?.street, feature.properties?.city, feature.properties?.country].filter(Boolean).join(', ');
    const results = features.map((f) => ({ label: label(f), coordinates: f.geometry.coordinates, properties: f.properties })).filter((f) => f.label && Array.isArray(f.coordinates));
    record('search', { label: query });
    res.json({ results });
  } catch (error) { next(error); }
});

app.post('/api/routes/snap', async (req, res, next) => {
  try {
    const { points, sessionId, stepFree = false, avoidStairs = false, name = '', eventId = 'uc-open-day-demo' } = req.body;
    ensure(Array.isArray(points) && points.length >= 2 && points.length <= 100, 'Draw at least two points.');
    const shape = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)).map((p) => ({ lat: p.lat, lon: p.lng }));
    ensure(shape.length >= 2, 'Route points must use latitude/longitude coordinates.');
    const matched = await valhalla('trace_route', {
      shape, costing: 'pedestrian', shape_match: 'map_snap', shape_format: 'geojson',
      costing_options: { pedestrian: { type: stepFree ? 'wheelchair' : 'foot', step_penalty: avoidStairs ? 7200 : stepFree ? 600 : 30 } },
      trace_options: { gps_accuracy: 20, search_radius: 60, breakage_distance: 2000 },
      directions_options: { units: 'kilometers' },
    });
    const trip = matched.trip;
    ensure(trip?.legs?.length, 'No walkable path matched that drawing. Try drawing closer to mapped paths.');
    const coordinates = trip.legs.flatMap((leg) => asGeometry(leg.shape).coordinates).reduce((all, point, index, points) => index && point[0] === points[index - 1][0] && point[1] === points[index - 1][1] ? all : [...all, point], []);
    const geometry = { type: 'LineString', coordinates };
    const distanceM = Number(trip.summary?.length || 0) * 1000;
    const durationS = Number(trip.summary?.time || 0);
    ensure(geometry.coordinates.length >= 2 && distanceM > 0, 'Walking service returned an incomplete route.');
    const id = randomUUID();
    const session = String(sessionId || randomUUID()).slice(0, 80);
    const routeName = String(name || 'Untitled walk').slice(0, 80);
    const existing = req.body.routeId ? db.prepare('SELECT * FROM routes WHERE id=? AND session_id=?').get(req.body.routeId, session) : null;
    if (existing) {
      db.prepare('UPDATE routes SET geometry=?,distance_m=?,duration_s=?,step_free=?,avoid_stairs=? WHERE id=?').run(JSON.stringify(geometry), distanceM, durationS, stepFree ? 1 : 0, avoidStairs ? 1 : 0, existing.id);
      record('route_edited', { eventId, lat: geometry.coordinates.at(-1)[1], lng: geometry.coordinates.at(-1)[0] });
    } else {
      db.prepare(`INSERT INTO routes(id,organisation_id,event_id,session_id,name,geometry,distance_m,duration_s,step_free,avoid_stairs,start_name,destination_name,route_kind,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, 'uc', eventId, session, routeName, JSON.stringify(geometry), distanceM, durationS, stepFree ? 1 : 0, avoidStairs ? 1 : 0, '', '', 'drawn', now());
    }
    const routeId = existing?.id || id;
    const first = geometry.coordinates[0], last = geometry.coordinates.at(-1);
    if (!existing) record('route_created', { eventId, lat: last[1], lng: last[0] });
    if (stepFree) record('step_free_requested', { eventId, lat: last[1], lng: last[0] });
    res.json({ route: routeSummary(db.prepare('SELECT * FROM routes WHERE id=?').get(routeId)), start: first, end: last });
  } catch (error) { next(error); }
});

app.post('/api/routes/point-to-point', async (req, res, next) => {
  try {
    const { start, end, sessionId, stepFree = false, avoidStairs = false, eventId = 'uc-open-day-demo' } = req.body;
    ensure(start && end && [start.lat, start.lng, end.lat, end.lng].every(Number.isFinite), 'Choose both a start and a destination.');
    const result = await valhalla('route', {
      locations: [{ lat: start.lat, lon: start.lng }, { lat: end.lat, lon: end.lng }], costing: 'pedestrian', shape_format: 'geojson',
      costing_options: { pedestrian: { type: stepFree ? 'wheelchair' : 'foot', step_penalty: avoidStairs ? 7200 : stepFree ? 600 : 30 } },
      directions_options: { units: 'kilometers' },
    });
    const leg = result.trip?.legs?.[0];
    ensure(leg, 'No walkable route found between those places.');
    const geometry = asGeometry(leg.shape);
    const id = randomUUID();
    db.prepare(`INSERT INTO routes(id,organisation_id,event_id,session_id,name,geometry,distance_m,duration_s,step_free,route_kind,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(id, 'uc', eventId, String(sessionId || randomUUID()).slice(0, 80), 'Point-to-point walk', JSON.stringify(geometry), result.trip.summary.length * 1000, result.trip.summary.time, stepFree ? 1 : 0, 'point_to_point', now());
    record('route_search', { eventId, lat: end.lat, lng: end.lng, label: end.label || '' });
    if (stepFree) record('step_free_requested', { eventId, lat: end.lat, lng: end.lng });
    res.json({ route: routeSummary(db.prepare('SELECT * FROM routes WHERE id=?').get(id)) });
  } catch (error) { next(error); }
});

app.get('/api/routes', (req, res) => {
  const session = String(req.query.sessionId || '').slice(0, 80);
  if (!session) return res.json({ routes: [] });
  const rows = db.prepare('SELECT * FROM routes WHERE session_id=? AND saved=1 ORDER BY created_at DESC').all(session);
  res.json({ routes: rows.map(routeSummary) });
});
app.get('/api/routes/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM routes WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Route not found.' });
  res.json({ route: routeSummary(row) });
});
app.patch('/api/routes/:id', (req, res, next) => {
  try {
    const row = db.prepare('SELECT * FROM routes WHERE id=?').get(req.params.id);
    ensure(row, 'Route not found.');
    if (typeof req.body.name === 'string') db.prepare('UPDATE routes SET name=? WHERE id=?').run(req.body.name.trim().slice(0, 80) || 'Untitled walk', row.id);
    if (typeof req.body.saved === 'boolean') {
      db.prepare('UPDATE routes SET saved=? WHERE id=?').run(req.body.saved ? 1 : 0, row.id);
      if (req.body.saved && !row.saved) record('route_saved', { eventId: row.event_id, lat: JSON.parse(row.geometry).coordinates.at(-1)[1], lng: JSON.parse(row.geometry).coordinates.at(-1)[0] });
    }
    if (req.body.shared === true && !row.shared) {
      db.prepare('UPDATE routes SET shared=1 WHERE id=?').run(row.id);
      record('route_shared', { eventId: row.event_id });
    }
    res.json({ route: routeSummary(db.prepare('SELECT * FROM routes WHERE id=?').get(row.id)) });
  } catch (error) { next(error); }
});
app.post('/api/routes/:id/pins', (req, res, next) => {
  try {
    const { lat, lng, label = 'Route pin', sessionId } = req.body;
    ensure(Number.isFinite(lat) && Number.isFinite(lng), 'Pin needs a geographic coordinate.');
    const route = db.prepare('SELECT * FROM routes WHERE id=?').get(req.params.id);
    ensure(route, 'Route not found.');
    const session = String(sessionId || '').slice(0, 80);
    ensure(route.session_id === session, 'Only the route owner can add pins.');
    const id = randomUUID();
    db.prepare('INSERT INTO route_pins(id,route_id,session_id,label,lat,lng,created_at) VALUES(?,?,?,?,?,?,?)').run(id, route.id, session, String(label).slice(0, 80), lat, lng, now());
    record('pin_dropped', { eventId: route.event_id, lat, lng });
    res.status(201).json({ id, label: String(label).slice(0, 80), lat, lng });
  } catch (error) { next(error); }
});

app.get('/api/features', (_req, res) => {
  const places = db.prepare('SELECT * FROM places WHERE organisation_id=? ORDER BY created_at DESC').all('uc');
  const paths = db.prepare("SELECT * FROM pedestrian_paths WHERE organisation_id=? AND status='published' ORDER BY created_at DESC").all('uc').map((p) => ({ ...p, geometry: JSON.parse(p.geometry), step_free: Boolean(p.step_free), verified: Boolean(p.verified) }));
  const closures = db.prepare("SELECT * FROM closures WHERE organisation_id=? AND status='published'").all('uc').map((c) => ({ ...c, geometry: c.geometry ? JSON.parse(c.geometry) : null }));
  res.json({ places, paths, closures });
});
app.post('/api/features', (req, res, next) => {
  try {
    const { name, type, description = '', lat, lng, accessibility = '', geometry, stepFree = false, eventId = null, verified = false } = req.body;
    ensure(String(name || '').trim() && String(type || '').trim(), 'A feature name and type are required.');
    const pathFeature = type === 'pedestrian_path' || type === 'indoor_path' || type === 'event_path';
    const id = randomUUID();
    if (pathFeature) {
      ensure(geometry?.type === 'LineString' && geometry.coordinates?.length >= 2, 'Draw a path on the map before saving it.');
      db.prepare(`INSERT INTO pedestrian_paths(id,organisation_id,event_id,name,path_type,geometry,step_free,verified,created_at) VALUES(?,?,?,?,?,?,?,?,?)`)
        .run(id, 'uc', eventId, String(name).slice(0, 120), type, JSON.stringify(geometry), stepFree ? 1 : 0, verified ? 1 : 0, now());
    } else {
      ensure(Number.isFinite(lat) && Number.isFinite(lng), 'Choose a location on the map before saving.');
      db.prepare(`INSERT INTO places(id,organisation_id,event_id,name,type,description,lat,lng,accessibility,verified,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id, 'uc', eventId, String(name).slice(0, 120), String(type).slice(0, 40), String(description).slice(0, 300), lat, lng, String(accessibility).slice(0, 120), verified ? 1 : 0, now());
    }
    res.status(201).json({ id, path: pathFeature });
  } catch (error) { next(error); }
});
app.delete('/api/features/:id', (req, res) => {
  const place = db.prepare('DELETE FROM places WHERE id=?').run(req.params.id);
  const path = db.prepare('DELETE FROM pedestrian_paths WHERE id=?').run(req.params.id);
  res.json({ deleted: Boolean(place.changes || path.changes) });
});

app.get('/api/events', (_req, res) => res.json({ events: db.prepare('SELECT * FROM events WHERE organisation_id=? ORDER BY created_at DESC').all('uc') }));
app.post('/api/events', (req, res, next) => {
  try {
    ensure(String(req.body.name || '').trim(), 'An event name is required.');
    const id = randomUUID();
    db.prepare('INSERT INTO events(id,organisation_id,name,starts_at,ends_at,status,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(id, 'uc', String(req.body.name).trim().slice(0, 120), req.body.startsAt || null, req.body.endsAt || null, 'draft', now());
    res.status(201).json({ event: db.prepare('SELECT * FROM events WHERE id=?').get(id) });
  } catch (error) { next(error); }
});
app.patch('/api/events/:id', (req, res, next) => {
  try {
    const status = req.body.status;
    ensure(['draft','published','archived'].includes(status), 'Choose draft, published, or archived.');
    const result = db.prepare('UPDATE events SET status=? WHERE id=? AND organisation_id=?').run(status, req.params.id, 'uc');
    ensure(result.changes, 'Event not found.');
    res.json({ event: db.prepare('SELECT * FROM events WHERE id=?').get(req.params.id) });
  } catch (error) { next(error); }
});
app.post('/api/closures', (req, res, next) => {
  try {
    ensure(String(req.body.name || '').trim(), 'A closure name is required.');
    const id = randomUUID();
    db.prepare('INSERT INTO closures(id,organisation_id,event_id,name,feature_id,starts_at,ends_at,geometry,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(id, 'uc', req.body.eventId || null, String(req.body.name).slice(0, 120), req.body.featureId || null, req.body.startsAt || null, req.body.endsAt || null, req.body.geometry ? JSON.stringify(req.body.geometry) : null, 'published', now());
    res.status(201).json({ id });
  } catch (error) { next(error); }
});

app.get('/api/analytics', (_req, res) => {
  const count = (kind) => db.prepare('SELECT COUNT(*) AS count FROM usage_events WHERE organisation_id=? AND kind=?').get('uc', kind).count;
  const destinations = db.prepare(`SELECT label AS name, COUNT(*) AS count FROM usage_events WHERE organisation_id=? AND kind IN ('search','route_search') AND label<>'' GROUP BY label ORDER BY count DESC LIMIT 8`).all('uc');
  const areas = db.prepare(`SELECT area_cell AS cell, COUNT(*) AS count FROM usage_events WHERE organisation_id=? AND area_cell<>'' GROUP BY area_cell ORDER BY count DESC LIMIT 80`).all('uc');
  const byHour = db.prepare(`SELECT strftime('%H',created_at) AS hour, COUNT(*) AS count FROM usage_events WHERE organisation_id=? AND kind IN ('route_created','route_search') GROUP BY hour ORDER BY hour`).all('uc');
  const eventActivity = db.prepare(`SELECT event_id AS eventId, kind, COUNT(*) AS count FROM usage_events WHERE organisation_id=? GROUP BY event_id,kind ORDER BY count DESC`).all('uc');
  const mapUsers = db.prepare("SELECT COUNT(DISTINCT session_id) AS count FROM usage_events WHERE organisation_id=? AND kind='map_open' AND session_id<>''").get('uc').count;
  res.json({ counts: { mapUsers, routeSearches: count('route_search'), routesCreated: count('route_created'), savedRoutes: count('route_saved'), sharedRoutes: count('route_shared'), stepFreeRequests: count('step_free_requested'), pins: count('pin_dropped') }, destinations, areas, byHour, eventActivity });
});
app.post('/api/usage', (req, res, next) => {
  try {
    const allowed = new Set(['map_open','search','route_search','route_created','route_edited','route_saved','route_shared','step_free_requested','pin_dropped']);
    ensure(allowed.has(req.body.kind), 'Unknown usage event.');
    record(req.body.kind, { eventId: req.body.eventId || 'uc-open-day-demo', label: req.body.label || '', sessionId: req.body.sessionId || '' });
    res.status(202).json({ recorded: true });
  } catch (error) { next(error); }
});
app.post('/api/pins', (req, res, next) => {
  try {
    const { lat, lng, label = '', sessionId } = req.body;
    ensure(Number.isFinite(lat) && Number.isFinite(lng), 'Pin needs a geographic coordinate.');
    const id = randomUUID();
    db.prepare('INSERT INTO route_pins(id,route_id,session_id,label,lat,lng,created_at) VALUES(?,NULL,?,?,?,?,?)').run(id, String(sessionId || randomUUID()).slice(0, 80), String(label).slice(0, 80), lat, lng, now());
    record('pin_dropped', { lat, lng, label });
    res.status(201).json({ id, label });
  } catch (error) { next(error); }
});
app.delete('/api/routes/:id', (req, res, next) => {
  try {
    const result = db.prepare('DELETE FROM routes WHERE id=? AND session_id=? AND saved=0').run(req.params.id, String(req.body?.sessionId || '').slice(0, 80));
    res.json({ deleted: Boolean(result.changes) });
  } catch (error) { next(error); }
});

const actionSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    action: { type: 'string', enum: ['closure', 'place', 'event', 'insight', 'other'] },
    title: { type: 'string' }, description: { type: 'string' }, name: { type: 'string' }, featureType: { type: 'string', enum: ['building', 'entrance', 'exit', 'room', 'bathroom', 'stairs', 'lift', 'ramp', 'pedestrian_path', 'indoor_path', 'event_location', 'restricted_area', 'other'] },
    startsAt: { type: ['string', 'null'] }, endsAt: { type: ['string', 'null'] }, eventId: { type: ['string', 'null'] }, insight: { type: ['string', 'null'] },
  }, required: ['action','title','description','name','featureType','startsAt','endsAt','eventId','insight'],
};
app.post('/api/ai/proposals', async (req, res, next) => {
  try {
    const client = assistantClient();
    const prompt = String(req.body.message || '').trim();
    ensure(prompt, 'Describe the map change or question.');
    const analytics = db.prepare('SELECT kind,COUNT(*) AS count FROM usage_events WHERE organisation_id=? GROUP BY kind').all('uc');
    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || 'gpt-6-luna', store: false,
      input: [
        { role: 'system', content: 'You are People Map, an assistant for UC map administrators. Interpret map updates into one safe proposed action or answer analytics questions from supplied aggregate counts only. Never invent or infer accessibility facts, coordinates, features, or verification. If a request needs a location not explicitly provided, leave the relevant name empty and explain that review is needed. Closures and map changes are proposals only; do not claim they are published. Convert relative times into ISO timestamps only when the request gives enough information; otherwise use null.' },
        { role: 'user', content: `Current aggregate usage counts: ${JSON.stringify(analytics)}\nRequest: ${prompt}` },
      ],
      text: { format: { type: 'json_schema', name: 'map_admin_proposal', strict: true, schema: actionSchema } },
    });
    const proposal = JSON.parse(response.output_text);
    const id = randomUUID();
    db.prepare('INSERT INTO ai_proposals(id,organisation_id,event_id,action,proposal,created_at) VALUES(?,?,?,?,?,?)').run(id, 'uc', proposal.eventId || null, proposal.action, JSON.stringify(proposal), now());
    res.json({ id, proposal, status: 'pending' });
  } catch (error) { next(error); }
});
app.post('/api/ai/proposals/:id/confirm', (req, res, next) => {
  try {
    const row = db.prepare("SELECT * FROM ai_proposals WHERE id=? AND status='pending'").get(req.params.id);
    ensure(row, 'Proposal is no longer pending.');
    const p = JSON.parse(row.proposal);
    if (p.action === 'closure') {
      ensure(p.name, 'Add the affected place/path name before confirming.');
      db.prepare('INSERT INTO closures(id,organisation_id,event_id,name,starts_at,ends_at,status,created_at) VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(), 'uc', p.eventId, p.name, p.startsAt, p.endsAt, 'published', now());
    } else if (p.action === 'event') {
      ensure(p.name, 'Add an event name before confirming.');
      db.prepare('INSERT INTO events(id,organisation_id,name,starts_at,ends_at,status,created_at) VALUES(?,?,?,?,?,?,?)').run(randomUUID(), 'uc', p.name, p.startsAt, p.endsAt, 'draft', now());
    } else if (p.action === 'place') {
      ensure(p.name, 'Add a place name and place it on the map before confirming.');
      // Accessibility is deliberately not filled by the model. Admin-entered verified data is kept separate.
      db.prepare('INSERT INTO places(id,organisation_id,name,type,description,source,created_at) VALUES(?,?,?,?,?,?,?)').run(randomUUID(), 'uc', p.name, p.featureType, p.description, 'ai-proposal-reviewed-unplaced', now());
    } else if (p.action !== 'insight') {
      ensure(false, 'This proposal needs administrator editing before it can be confirmed.');
    }
    db.prepare("UPDATE ai_proposals SET status='confirmed',confirmed_at=? WHERE id=?").run(now(), row.id);
    res.json({ status: 'confirmed', proposal: p });
  } catch (error) { next(error); }
});

const suggestionSchema = {
  type: 'object', additionalProperties: false,
  properties: { suggestions: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { name: { type: 'string' }, type: { type: 'string', enum: ['room','corridor','entrance','exit','stairs','lift','ramp','bathroom','pedestrian_path','other'] }, note: { type: 'string' }, page: { type: ['integer','null'] } }, required: ['name','type','note','page'] } } }, required: ['suggestions'],
};
app.post('/api/imports', upload.single('plan'), async (req, res, next) => {
  try {
    ensure(req.file, 'Upload a PNG, JPG, or PDF floor/site plan (12 MB maximum).');
    const id = randomUUID();
    let suggestions = [];
    let status = 'uploaded';
    if (process.env.OPENAI_API_KEY) {
      const client = assistantClient();
      const bytes = await readFile(req.file.path);
      const dataUrl = `data:${req.file.mimetype};base64,${bytes.toString('base64')}`;
      const content = req.file.mimetype === 'application/pdf' ? [{ type: 'input_file', filename: req.file.originalname, file_data: dataUrl }] : [{ type: 'input_image', image_url: dataUrl }];
      const response = await client.responses.create({
        model: process.env.OPENAI_MODEL || 'gpt-6-luna', store: false,
        input: [{ role: 'system', content: 'Review this uploaded floor or site plan and suggest only visible map features. Do not claim accessibility, scale, geographic placement, or route connectivity. All suggestions are unverified and require administrator placement/review.' }, { role: 'user', content: [...content, { type: 'input_text', text: 'List candidate rooms, corridors, entrances, exits, stairs, lifts, ramps, bathrooms, and pedestrian paths visible on this plan. Keep suggestions concise.' }] }],
        text: { format: { type: 'json_schema', name: 'floorplan_suggestions', strict: true, schema: suggestionSchema } },
      });
      suggestions = JSON.parse(response.output_text).suggestions;
      status = 'review_required';
    }
    db.prepare('INSERT INTO imports(id,organisation_id,file_name,mime_type,file_path,suggestions,status,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id, 'uc', req.file.originalname, req.file.mimetype, req.file.path, JSON.stringify(suggestions), status, now());
    res.status(201).json({ id, name: req.file.originalname, status, suggestions, aiEnabled: Boolean(process.env.OPENAI_API_KEY) });
  } catch (error) { next(error); }
});
app.post('/api/imports/:id/confirm', (req, res, next) => {
  try {
    const row = db.prepare('SELECT * FROM imports WHERE id=?').get(req.params.id);
    ensure(row, 'Import not found.');
    const accepted = Array.isArray(req.body.accepted) ? req.body.accepted : [];
    const available = JSON.parse(row.suggestions);
    const acceptedSuggestions = accepted.map((index) => available[Number(index)]).filter(Boolean);
    const insert = db.prepare('INSERT INTO places(id,organisation_id,name,type,description,source,created_at) VALUES(?,?,?,?,?,?,?)');
    const transaction = db.transaction((items) => items.forEach((s) => insert.run(randomUUID(), 'uc', s.name, s.type, s.note, 'ai-floorplan-suggestion-unverified', now())));
    transaction(acceptedSuggestions);
    db.prepare("UPDATE imports SET status='reviewed' WHERE id=?").run(row.id);
    res.json({ confirmedSuggestions: acceptedSuggestions.length, note: 'Accepted features are stored without geographic placement or accessibility verification.' });
  } catch (error) { next(error); }
});

app.get('/api/ai/status', (_req, res) => res.json({ enabled: Boolean(process.env.OPENAI_API_KEY), model: process.env.OPENAI_MODEL || 'gpt-6-luna' }));

const dist = path.join(root, 'dist');
app.use(express.static(dist));
app.use((req, res, next) => req.path.startsWith('/api/') ? next() : res.sendFile(path.join(dist, 'index.html'), (error) => error && next()));
app.use((error, _req, res, _next) => {
  const status = Number(error.status) || (error instanceof multer.MulterError ? 400 : 502);
  console.error(`[api] ${error.message}`);
  res.status(status).json({ error: status === 502 ? 'The requested service is temporarily unavailable. Try again in a moment.' : error.message });
});

app.listen(port, () => console.log(`People Map API and production app listening on http://localhost:${port}`));
