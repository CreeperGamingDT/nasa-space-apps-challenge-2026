import xarray as xr
import numpy as np
import matplotlib
matplotlib.use("Agg")
from flask import Flask, request, jsonify
from datetime import datetime, timezone

app = Flask(__name__)


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


@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    return response


url = (
    "https://opendap.nccs.nasa.gov/dods/"
    "GEOS-5/fp/0.25_deg/fcast/"
    "tavg1_2d_slv_Nx.latest"
)

ds = xr.open_dataset(url, engine="netcdf4")

@app.route("/global-temperature/data")
def data_endpoint():
    min_lat = request.args.get("min_lat", default=-90, type=float)
    max_lat = request.args.get("max_lat", default=90, type=float)
    min_lon = request.args.get("min_lon", default=-180, type=float)
    max_lon = request.args.get("max_lon", default=180, type=float)
    raw_date = request.args.get("date", type=str)
    date = parse_date(raw_date) if raw_date else current_hour_utc()

        # get global temp for 11/13
    temp = (
        ds["t2m"].sel(
            lat=slice(min_lat, max_lat),
            lon=slice(min_lon, max_lon),
        )
        .sel(
            time=date,
            method="nearest"
        )
    )

    # convert kelvin to celcius
    temp = temp - 273.15

    data = temp.values
    # returns a 2d array of the temp data in JSON format
    return jsonify({
        "values": data.tolist(),
        "shape": list(data.shape),
    })

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=3000, debug=False)