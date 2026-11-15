# Sonora

An app that helps people who cannot see or have difficulties seeing hear the world.

## Overview

Sonora turns surface temperature data into an audio experience so people who are blind can visualize the data:

## What it does

- Loads the latest hourly global temperature at 2 meters data
    - From NASA's GEOS-5 FP forecast through their NCCS OPeNDAP endpoint
- Draws the temperature data onto a canvas (Turbo color scale)
    - min -35 C
    - max 35 C
- Searches for countries and regions and returns their bounding box (min_lon,min_lat,max_lon,max_lat)
- Scans each latitude row and plays a sound for each longitude
    - Scans south to north
    - Colder temps produce lower pitches (min 20 Hz)
    - Warmer temps produce higher pitches (max 5 kHz)
    - 128 samples of longitude to prevent lag
- Provides spoken instructions and narrates user interaction
    - Uses Speech Synthesis API

## How to Use Sonora

1. Wait for the global temperature map to load.
2. Search for a country or region, then select a result to load its map.
3. Select **Play scanner**, or press `p`, to scan the map.
    - The scanner can be stopped by selecting **Stop scanner** or pressing `p` again.
4. Press `/` to focus the location search.
5. Press `Alt+N` to turn the narrator on or off.

## Architecture

The project is split into 2 parts
- `public`
- `backend`

### Frontend
- **[Typescript](https://www.typescriptlang.org/)** - Typescript 5.9.3
- **[Vite](https://vite.dev/)** - Bundles and builds typescript
- **[D3](https://d3js.org/)** - Accurate color scale for temperature data

### Backend
- **[Python](https://python.org/)** - Python 3.14.2
- **[Flask](https://flask.palletsprojects.com/en/stable/)** - Hosts the Python API port
- **[NASA GEOS-5 FP](https://opendap.nccs.nasa.gov/dods/GEOS-5/fp)** - The live dataset for retrieving temperature from 2 meters data
- **[Mapbox API](https://www.mapbox.com/)** - Used for geocoding and searching locations


## Initilization

### Prerequisites
- [Node.js](https://nodejs.org/) (latest version recommended)
- [npm](https://www.npmjs.com/) package manager
- [Python](https://python.org/) 3.10 or newer
- A browser with 
    - HTML Canvas
    - Web Audio (including AudioWorklet)
    - Speech Synthesis

### 1. Install frontend dependencies

```bash
npm install
```

### 2. Install backend dependencies

```bash
python -m pip install flask numpy xarray netCDF4 requests
```

### 3. Configure the backend URL

The frontend reads the backend URL from
[`public/config.ts`](public/config.ts). For local development, set `apiUrl`
to:

```ts
apiUrl: "http://localhost:3000/",
```

### 5. Start backend

From the repo root:

```bash
python backend/backend.py
```

The Flask API listens on `http://localhost:3000`.

### 6. Start frontend

In a second terminal:

```bash
npm run dev
```

Open the local URL printed by Vite, defaulting to
`http://localhost:5173`.

## API endpoints

### `GET /health`

Returns a simple health response:

```json
{"status": "ok"}
```

### `GET /global-temperature/data`

Returns temperature values for the requested region and time. Supported
parameters are `min_lat`, `max_lat`, `min_lon`, `max_lon`, `date` (ISO 8601),
and `step` (from `1` to `8`, default `2`).

### `GET /geocode/search?q=<location>`

Returns up to five Mapbox country or region results with names and bounding
boxes.