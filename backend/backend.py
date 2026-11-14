import os
from datetime import datetime, timezone
from threading import Lock
from time import monotonic

import xarray as xr
from flask import Flask, jsonify, request

app = Flask(__name__)

URL = (
    "https://opendap.nccs.nasa.gov/dods/"
    "GEOS-5/fp/0.25_deg/fcast/"
    "tavg1_2d_slv_Nx.latest"
)

# The full 721 x 1152 field is slow to pull from OPeNDAP. Step 3 keeps the
# image detailed enough for the canvas while cutting the transfer by 9x.
DEFAULT_STEP = 4
MAX_STEP = 8

# how long until a cached entry expires (technically, the data doesnt get automatically removed after this time, but it will be treated as expired)
CACHE_TTL_SECONDS = 30 * 60 # 30 minutes
MAX_CACHE_ENTRIES = 32 # how many entries until we start removing the oldest entry

_cache: dict[tuple, tuple[float, dict]] = {}
_cache_lock = Lock()

# netCDF4/HDF5 is not safe for concurrent OPeNDAP access. Without this,
# simultaneous requests can deadlock inside the C library.
_dataset_lock = Lock()


def current_hour_utc() -> datetime:
    # current hour in ISO UTC
    return datetime.now(timezone.utc).replace(
        minute=0, second=0, microsecond=0, tzinfo=None
    )


def parse_date(value: str) -> datetime:
    # parse ISO date into naive UTC
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed

# clamp the step range
def clamp_step(value: int | None) -> int:
    if value is None:
        return DEFAULT_STEP
    return max(1, min(MAX_STEP, value))

# gets a cache payload from a key
def cache_get(key: tuple) -> dict | None:
    now = monotonic()
    with _cache_lock:
        entry = _cache.get(key)
        if entry is None:
            return None
        cached_at, payload = entry
        if now - cached_at >= CACHE_TTL_SECONDS:
            _cache.pop(key, None)
            return None
        return payload

# stores a key and payload in cache storage
def cache_put(key: tuple, payload: dict) -> None:
    now = monotonic()
    with _cache_lock:
        _cache[key] = (now, payload)
        if len(_cache) > MAX_CACHE_ENTRIES:
            oldest = min(_cache, key=lambda item: _cache[item][0])
            _cache.pop(oldest, None)


def load_temperature(
    date: datetime,
    min_lat: float,
    max_lat: float,
    min_lon: float,
    max_lon: float,
    step: int,
) -> dict:
    # Open per request so a long-running server always sees the latest file.
    # Serialize access because netCDF4/HDF5 cannot handle concurrent remote reads.
    with _dataset_lock:
        with xr.open_dataset(URL, engine="netcdf4") as ds:
            temp = (
                ds["t2m"]
                .sel(time=date, method="nearest")
                .sel(lat=slice(min_lat, max_lat), lon=slice(min_lon, max_lon))
            )

            # downsample the data
            if step > 1:
                temp = temp.isel(
                    lat=slice(None, None, step),
                    lon=slice(None, None, step),
                )

            # convert kelvin to celsius
            values = (temp - 273.15).values

    return {
        "values": values.tolist(),
        "shape": list(values.shape),
        "step": step,
    }


@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    return response

@app.route("/health")
def health():
    return jsonify({"status": "ok"})

@app.route("/global-temperature/data")
def response():
    min_lat = request.args.get("min_lat", default=-90, type=float)
    max_lat = request.args.get("max_lat", default=90, type=float)
    min_lon = request.args.get("min_lon", default=-180, type=float)
    max_lon = request.args.get("max_lon", default=180, type=float)
    step = clamp_step(request.args.get("step", type=int))
    raw_date = request.args.get("date", type=str)

    # validate the date param
    try:
        date = parse_date(raw_date) if raw_date else current_hour_utc()
    except ValueError:
        return jsonify({"error": "Invalid date; expected ISO 8601."}), 400

    # return cached response if available
    key = (date.isoformat(), min_lat, max_lat, min_lon, max_lon, step)
    cached = cache_get(key)
    if cached is not None:
        return jsonify(cached)

    # else load from OPeNDAP
    try:
        payload = load_temperature(
            date,
            min_lat,
            max_lat,
            min_lon,
            max_lon,
            step,
        )
    except Exception as error:
        app.logger.exception("Failed to load temperature data")
        return jsonify({"error": f"Failed to load temperature data: {error}"}), 502

    # cache the new response
    cache_put(key, payload)

    return jsonify(payload)


if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=3000,
        debug=False,
    )
