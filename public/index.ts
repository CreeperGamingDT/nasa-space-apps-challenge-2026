import { rgb } from "d3-color";
import { scaleSequential } from "d3-scale";
import { interpolateTurbo } from "d3-scale-chromatic";
import { config } from "./config";
import { currentHourUTC, fetchTempData } from "./fetch";
import { ScannerAudio } from "./scanner/scanner";
import type { SearchResults, TempData } from "./types";
import { searchArea } from "./area-search/search";

const status: HTMLElement | null = document.getElementById("status");
const scannerToggle = document.getElementById("scanner-toggle") as HTMLButtonElement | null;
const searchInput = document.getElementById("search") as HTMLInputElement | null;
const searchDropdown = document.getElementById("search-dropdown") as HTMLDivElement | null;
const canvas = document.getElementById("map-canvas") as HTMLCanvasElement | null;

let currentData: TempData | null = null;
let scannerAbort: AbortController | null = null;
let scannerOverlay: HTMLCanvasElement | null = null;
let scannerOverlayContext: CanvasRenderingContext2D | null = null;

// Fixed range so images from different dates are directly comparable.
const TEMP_RANGE = config.tempRangeC;
const LUT_SIZE = 256;

const color = scaleSequential(interpolateTurbo).domain(TEMP_RANGE).clamp(true);

// Precompute the colormap so pixels don't parse color strings on every frame.
const colorLut = Array.from({ length: LUT_SIZE }, (_, index): [number, number, number] => {
  const value = TEMP_RANGE[0] + (index / (LUT_SIZE - 1)) * (TEMP_RANGE[1] - TEMP_RANGE[0]);
  const { r, g, b } = rgb(color(value));
  return [r, g, b];
});

function drawScannerRow(row: number): void {
  if (!scannerOverlay || !scannerOverlayContext) return;

  const { width, height } = scannerOverlay;
  scannerOverlayContext.clearRect(0, 0, width, height);

  if (row < 0 || row >= height) return;

  // Data row 0 is south (bottom); canvas y grows downward.
  const y = height - 1 - row;
  const thickness = Math.max(1, Math.round(height / 300));

  scannerOverlayContext.fillStyle = "rgba(255, 255, 255, 0.95)";
  scannerOverlayContext.fillRect(0, y, width, thickness);

  // draw dots on the line to indicate where each sample is being played
  if (!currentData) return;
  const [dataHeight, dataWidth] = currentData.shape;
  const samples = config.scanner.samples;
  const lastIndex = samples - 1;

  for (let i = 0; i < samples; i++) {
    const x = (i / lastIndex) * width;
    scannerOverlayContext.fillStyle = "rgba(255, 0, 0, 0.8)";
    scannerOverlayContext.beginPath();
    scannerOverlayContext.arc(x, y, 1, 0, Math.PI * 2);
    scannerOverlayContext.fill();
  }
}

function clearScannerRow(): void {
  if (!scannerOverlay || !scannerOverlayContext) return;
  scannerOverlayContext.clearRect(0, 0, scannerOverlay.width, scannerOverlay.height);
}

function clearCanvas(): void {
  if (!canvas) return;

  const context = canvas.getContext("2d");
  if (!context) return;

  context.clearRect(0, 0, canvas.width, canvas.height);
}

function drawTempData(tempData: TempData): void {
  if (!canvas) {
    throw new Error("Canvas element not found.");
  }
  const [height, width] = tempData.shape;

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

  const overlay = document.createElement("canvas");
  overlay.className = "scanner-overlay";
  overlay.width = width;
  overlay.height = height;

  const overlayContext = overlay.getContext("2d");
  if (!overlayContext) {
    throw new Error("Unable to create a scanner overlay context.");
  }

  scannerOverlay = overlay;
  scannerOverlayContext = overlayContext;

  const map = document.createElement("div");
  map.className = "map";
  map.append(canvas, overlay);
  document.body.appendChild(map);

  if (status) {
    status.textContent = `Loaded ${width} x ${height} temperature values.`;
  }
}

async function toggleScanner(): Promise<void> {
  if (!currentData) return;

  // Second click stops the running scan.
  if (scannerAbort) {
    scannerAbort.abort();
    return;
  }

  const controller = new AbortController();
  scannerAbort = controller;

  if (scannerToggle) {
    scannerToggle.textContent = "Stop scanner";
  }

  drawScannerRow(0);

  try {
    await ScannerAudio(currentData, controller.signal, drawScannerRow);
  } finally {
    scannerAbort = null;
    clearScannerRow();
    if (scannerToggle) {
      scannerToggle.textContent = "Play scanner";
    }
  }
}

scannerToggle?.addEventListener("click", () => {
  void toggleScanner();
});

async function findSearchResults(query: string): Promise<void> {
  if (!query) return
  const results = await searchArea(query);
    if (!results) {
      if (searchDropdown) {
        searchDropdown.hidden = true;
      }
      return;
    }
    console.log(results)
    loadSearchResults(results);
}

// populate and display search results
function loadSearchResults(list: SearchResults): void {
  if (!searchDropdown || !searchInput) return;
  searchDropdown.replaceChildren();
  
  if (document.activeElement !== searchInput || list.length === 0) {
    searchDropdown.hidden = true;
    return;
  }
  
  for (const result of list) {
    const option = document.createElement("button");
    
    option.type = "button";
    option.className = "search-option";
    option.textContent = result.name;
    
    option.addEventListener("click", () => {
      searchInput.value = result.name;
      searchDropdown.hidden = true;
      
      refreshTempData(
        result.bbox[1],
        result.bbox[3],
        result.bbox[0],
        result.bbox[2],
        currentHourUTC().toISOString(),
        1
      );
    });
    
    searchDropdown.appendChild(option);
  }
  
  searchDropdown.hidden = false;
}
let searchInputTimeout: number | null = null;
searchInput?.addEventListener("input", (e) => {
  if (searchInputTimeout) {
    clearTimeout(searchInputTimeout);
  }
  if (!searchInput.value.trim()) return;
  searchInputTimeout = window.setTimeout(async () => {
    findSearchResults(searchInput.value.trim());
  }, config.search.timeoutDelayMs);
})
searchInput?.addEventListener("focus", () => {
  findSearchResults(searchInput.value.trim());
});

async function refreshTempData(min_lat: number, max_lat: number, min_lon: number, max_lon: number, date: string, downscale: number): Promise<void> {
  console.log(`Fetching temperature data for lat: ${min_lat} to ${max_lat}, lon: ${min_lon} to ${max_lon}, date: ${date}, downscale: ${downscale}`);
  clearCanvas();
  const tempData = await fetchTempData(min_lat, max_lat, min_lon, max_lon, date, downscale);
  if (tempData) {
    currentData = tempData;
    drawTempData(tempData);

    if (scannerToggle) {
      scannerToggle.disabled = false;
    }
  } else if (status) {
    status.textContent = "Unable to load temperature data.";
    status.style.color = "red";
  }
}
refreshTempData(-90, 90, -180, 180, currentHourUTC().toISOString(),4);