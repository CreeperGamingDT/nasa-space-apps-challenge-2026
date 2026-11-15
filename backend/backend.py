import os
from datetime import datetime, timedelta, timezone
from threading import Lock
from time import monotonic

import numpy as np

import xarray as xr
from flask import Flask, jsonify, request

import requests

app = Flask(__name__)

URL = (
    "https://opendap.nccs.nasa.gov/dods/"
    "GEOS-5/fp/0.25_deg/fcast/"
    "tavg1_2d_slv_Nx.latest"
)
SEARCH_URL = "https://api.mapbox.com/search/geocode/v6/forward?"

# The full 721 x 1152 field is slow to pull from OPeNDAP. Step 3 keeps the
# image detailed enough for the canvas while cutting the transfer by 9x.
DEFAULT_STEP = 2
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
        # The OPeNDAP server reports time as "days since 1-1-1", which neither
        # pandas (int64 nanosecond overflow) nor cftime (exactness overflow) can
        # decode. So read the raw values and convert them ourselves.
        with xr.open_dataset(URL, engine="netcdf4", decode_times=False) as ds:
            # DODS sometimes returns fill values (e.g. 9.969e36) in the time
            # array. Drop those time steps with isel so every variable on the
            # time dimension stays consistent, then decode what remains.
            epoch = datetime(1, 1, 1, tzinfo=timezone.utc)
            mask = [0 <= float(t) < 3.7e6 for t in ds["time"].values]
            ds = ds.isel(time=mask)
            decoded_time = [epoch + timedelta(days=float(t)) for t in ds["time"].values]
            ds = ds.assign_coords(time=("time", decoded_time))

            # A mid-refresh read of the ".latest" file can return out-of-order
            # or duplicated time steps; selection requires a monotonic index.
            tvals = ds["time"].values
            if tvals.size > 1 and not all(tvals[i] < tvals[i + 1] for i in range(tvals.size - 1)):
                ds = ds.sortby("time")
            if ds["lat"].values.size > 1 and ds["lat"].values[1] < ds["lat"].values[0]:
                ds = ds.sortby("lat")
            if ds["lon"].values.size > 1 and ds["lon"].values[1] < ds["lon"].values[0]:
                ds = ds.sortby("lon")

            # pandas cannot compare tz-naive and tz-aware timestamps, so treat a
            # naive requested date as UTC, matching the decoded time coordinate.
            if date.tzinfo is None:
                date = date.replace(tzinfo=timezone.utc)

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

@app.route("/geocode/search")
def geocode():
    query = request.args.get("q")

    if not query:
        return jsonify({"error": "Missing query parameter"}), 400

    params = {
        "access_token": os.environ.get("MAPBOX_ACCESS_TOKEN") or "pk.eyJ1IjoiY3JlZXBlcmdhbWluZ2R0IiwiYSI6ImNtd2gzOHk1cDAzYTEzMHB6cm15d3ppNHMifQ.jrZjG5gelqEVYiPnfmDxJA", #some of you may be like "OH NO HES USING A PRIVATE API KEY IN PUBLIC" but this is actually just a public key that is rate limited and can be used by anyone
        "limit": 5,
        "types": "country,region",
        "q": query,
    }

    try:
        response = requests.get(
            SEARCH_URL,
            params=params,
            timeout=10
        )
        response.raise_for_status()
        results = response.json()
        print(results)

        if not results:
            return jsonify([])

        formatted_results = []

        for result in results["features"]:
            properties = result["properties"]
            print(properties)
            print(properties["bbox"])

            bbox = properties["bbox"]
            if not bbox:
                break

            formatted_results.append({
                "name": properties["name_preferred"] or properties["name"] or properties["full_address"],
                "bbox": bbox,
            })

        return jsonify(formatted_results)

    except requests.RequestException as e:
        return jsonify({"error": str(e)}), 502


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
