import { rgb } from "d3-color";
import { scaleSequential } from "d3-scale";
import { interpolateTurbo } from "d3-scale-chromatic";
import { fetchTempData } from "./fetch";
import type { TempData } from "./types";

const status: HTMLElement | null = document.getElementById("status");

// Fixed range so images from different dates are directly comparable.
const TEMP_RANGE: readonly [number, number] = [-45, 35];
const LUT_SIZE = 256;

const color = scaleSequential(interpolateTurbo).domain(TEMP_RANGE).clamp(true);

// Precompute the colormap so pixels don't parse color strings on every frame.
const colorLut = Array.from({ length: LUT_SIZE }, (_, index): [number, number, number] => {
  const value = TEMP_RANGE[0] + (index / (LUT_SIZE - 1)) * (TEMP_RANGE[1] - TEMP_RANGE[0]);
  const { r, g, b } = rgb(color(value));
  return [r, g, b];
});

function drawTempData(tempData: TempData): void {
  const [height, width] = tempData.shape;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to create a 2D canvas context.");
  }

  const image = context.createImageData(width, height);
  const span = TEMP_RANGE[1] - TEMP_RANGE[0];

  for (let y = 0; y < height; y++) {
    // since the canvas origin is top-left and the data origin is bottom-left, we need to flip the y-axis
    const sourceRow = tempData.values[height - 1 - y];

    for (let x = 0; x < width; x++) {
      const value = sourceRow[x];
      const pixel = (y * width + x) * 4;

      if (!Number.isFinite(value)) {
        image.data[pixel + 3] = 0; // transparent for missing data
        continue;
      }

      const lutIndex = Math.round(((value - TEMP_RANGE[0]) / span) * (LUT_SIZE - 1));
      const [r, g, b] = colorLut[Math.min(LUT_SIZE - 1, Math.max(0, lutIndex))];
      image.data[pixel] = r;
      image.data[pixel + 1] = g;
      image.data[pixel + 2] = b;
      image.data[pixel + 3] = 255; // fully opaque
    }
  }

  context.putImageData(image, 0, 0);
  
  document.body.appendChild(canvas);

  if (status) {
    status.textContent = `Loaded ${width} x ${height} temperature values.`;
  }
}

(async (): Promise<void> => {
  const tempData = await fetchTempData();
  if (tempData) {
    drawTempData(tempData);
  } else if (status) {
    status.textContent = "Unable to load temperature data.";
    status.style.color = "red";
  }
})();
