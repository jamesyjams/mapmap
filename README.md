# People Map

People Map is the pedestrian layer for physical spaces. This MVP makes **draw a walking route** the public map's main interaction. It opens on the real University of Canterbury campus, snaps the visitor's hand-drawn path to mapped pedestrian ways, and stores routes as GeoJSON-backed records that can be edited, reopened, saved, and shared.

> Organisations manage the map. People manage their journey.

## Run locally

Requires Node.js 20 or newer.

```sh
cp .env.example .env
npm install
npm run dev
```

Open <http://localhost:5173>. The map tiles, Photon search, and Valhalla walking route service use public OpenStreetMap-based endpoints and do not need keys. A local SQLite database is created under `data/` the first time the server starts. Add `OPENAI_API_KEY` to `.env` to enable the real AI review assistant and floor-plan image suggestions. The app remains usable without that optional key.

## Main flows

- **Public map:** Search real OSM places; select Draw Route and sketch with mouse, trackpad, or touch. Valhalla's pedestrian map matcher snaps the geometry to mapped ways and returns route geometry, distance, and time. Undo, redo, redraw, add pins, save and share routes.
- **Accessibility:** Step-free preference requests Valhalla's wheelchair costing. It is limited to accessibility tags available in OpenStreetMap and is not a guarantee; organisation-verified data is not inferred.
- **Organisation workspace:** Create events, places, pedestrian paths, and temporary closures. Floor plans are uploaded privately to the local data folder; AI can suggest features for review when configured. Suggestions stay pending until an administrator confirms them.
- **AI assistant:** Uses OpenAI's Responses API with schema-constrained output. It only proposes a structured change; a separate confirm action applies it. The API key is server-only.
- **Analytics:** Counts actual route creation/search/save/share, pins, and step-free requests as aggregated usage events. Coarse area cells are retained instead of raw user locations in analytics. New installations start with zero real activity.

## Geographic data and limits

The base map tiles come directly from OpenStreetMap; place search uses Photon, an OpenStreetMap geocoder. Walking routes use Valhalla's public OpenStreetMap-backed pedestrian routing service. Public services can rate-limit and do not provide a production availability promise. Configure a hosted/self-managed service through `MAP_TILE_URL`, `PHOTON_URL`, and `VALHALLA_URL` before production use. Follow the services' attribution and acceptable-use terms.

No UC indoor paths, entrances, rooms, lift locations, or accessibility claims are preloaded. The organisation editor stores only information supplied and confirmed by an administrator. The initial UC Open Day record is clearly a demo event; analytics are real counts from this app, not fabricated activity.

Organisation paths and closures are stored and displayed as a separate verified layer, but the public Valhalla service cannot be taught this workspace's custom graph. They do not yet change the snapped route; route matching currently follows the external OpenStreetMap pedestrian network. Authentication and organisation role controls are not included, so keep this MVP on trusted demo data.

## Configuration

See [`.env.example`](.env.example). `OPENAI_API_KEY` is optional for map and route features and required only for live AI assistance and image-based floor-plan suggestions. No Mapbox token is used.
