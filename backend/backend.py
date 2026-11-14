import xarray as xr
import numpy as np
import matplotlib
matplotlib.use("Agg")

import matplotlib.pyplot as plt
from flask import Flask, Response, jsonify
from io import BytesIO

app = Flask(__name__)


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

# get global temp for 11/13
temp = (
    ds["t2m"].sel(
        lat=slice(-90, 90),
        lon=slice(-90, 90),
    )
    .sel(
        time="2026-11-13T00:00:00",
        method="nearest"
    )
)

# convert kelvin to celcius
temp = temp - 273.15

data = temp.values


#generate graph image
fig, ax = plt.subplots()

img = ax.imshow(
    data,
    origin="lower",
    aspect="auto",
    cmap="turbo"
)

fig.colorbar(img, ax=ax, label="Temp (C)")
ax.set_title("Global temp")

# visual for testing purposes
@app.route("/global-temperature/visual")
def index():
    buf = BytesIO()
    fig.savefig(buf, format="png", bbox_inches="tight")
    buf.seek(0)

    return Response(buf.getvalue(), mimetype="image/png")

@app.route("/global-temperature/data")
def data_endpoint():
    # returns a 2d array of the temp data in JSON format
    return jsonify({
        "values": data.tolist(),
        "shape": list(data.shape),
    })

print("Grd dims:", data.shape)
print("Min:", np.nanmin(data))
print("Max:", np.nanmax(data))

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=3000, debug=False)