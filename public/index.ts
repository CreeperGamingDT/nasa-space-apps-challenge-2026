import { fetchTempData } from "./fetch";
import { TempData } from "./types";
const status: HTMLElement | null = document.getElementById("status");

function drawTempData(tempData: TempData): void {
  const [height, width] = tempData.shape;
  const pixels = tempData.values.flat();
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to create a 2D canvas context.");
  }
  const image = context.createImageData(width, height);
  const minimum = pixels.reduce((min, value) => Math.min(min, value), Infinity);
  const maximum = pixels.reduce(
    (max, value) => Math.max(max, value),
    -Infinity,
  );

  canvas.width = width;
  canvas.height = height;

  pixels.forEach((value, index) => {
    const normalized = (value - minimum) / (maximum - minimum);
    const color = Math.round(normalized * 255);
    const pixel = index * 4;
    image.data[pixel] = color;
    image.data[pixel + 1] = 0;
    image.data[pixel + 2] = 255 - color;
    image.data[pixel + 3] = 255;
  });

  context.putImageData(image, 0, 0);
  if (status) {
    status.textContent = `Loaded ${width} x ${height} temperature values.`;
  }
  document.body.appendChild(canvas);
}

(async () => {
    console.log("hello")
  const tempData = await fetchTempData();
  if (tempData) {
    drawTempData(tempData);
  }
})();
