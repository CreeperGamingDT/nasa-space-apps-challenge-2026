import { rgb } from "d3-color";
import { scaleSequential } from "d3-scale";
import { interpolateTurbo } from "d3-scale-chromatic";
import { config } from "./config";
import { currentHourUTC, fetchTempData } from "./fetch";
import { ScannerAudio } from "./scanner/scanner";
import type { SearchResults, TempData } from "./types";
import { searchArea } from "./area-search/search";
import { speak } from "./narrator/narrator";

const scannerToggle = document.getElementById("scanner-toggle") as HTMLButtonElement | null;
const searchInput = document.getElementById("search") as HTMLInputElement | null;
const searchDropdown = document.getElementById("search-dropdown") as HTMLDivElement | null;
const canvas = document.getElementById("map-canvas") as HTMLCanvasElement | null;
const scannerOverlay = document.getElementById("scanner-overlay") as HTMLCanvasElement | null;
const scannerOverlayContext = scannerOverlay?.getContext("2d") ?? null;
const legendGradient = document.getElementById("legend-gradient") as HTMLDivElement | null;
const timeReadout = document.getElementById("time-readout");

let currentData: TempData | null = null;
let scannerAbort: AbortController | null = null;
let loadingTempData = false;

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

// Build the legend gradient from the same LUT the map uses, so the scale
// bar exactly matches the rendered colors.
function buildLegend(): void {
  if (!legendGradient) return;
  const stops: string[] = [];
  const steps = 16;
  for (let i = 0; i <= steps; i++) {
    const index = Math.round((i / steps) * (LUT_SIZE - 1));
    const [r, g, b] = colorLut[index];
    stops.push(`rgb(${r}, ${g}, ${b}) ${((i / steps) * 100).toFixed(1)}%`);
  }
  legendGradient.style.background = `linear-gradient(90deg, ${stops.join(", ")})`;
}
buildLegend();

function updateTimeReadout(date: string): void {
  if (!timeReadout) return;
  timeReadout.textContent = `${date.slice(0, 16).replace("T", " ")} UTC`;
}

function drawTempData(tempData: TempData): void {
  if (!canvas) {
    throw new Error("Canvas element not found.");
  }
  if (!scannerOverlay || !scannerOverlayContext) {
    throw new Error("Scanner overlay element not found.");
  }
  const [height, width] = tempData.shape;

  canvas.width = width;
  canvas.height = height;
  scannerOverlay.width = width;
  scannerOverlay.height = height;

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
  scannerOverlayContext.clearRect(0, 0, width, height);
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
    speak("Playing "+ (searchInput?.value.trim() !== "" ? searchInput?.value.trim() : "global") + " temperature map");
    await ScannerAudio(currentData, controller.signal, drawScannerRow);
  } finally {
    scannerAbort = null;
    clearScannerRow();
    if (scannerToggle) {
      scannerToggle.textContent = "Play scanner";
    }
  }
}



async function findSearchResults(query: string, autofocus: boolean = false): Promise<void> {
  if (!query) return
  const results = await searchArea(query);
    if (!results) {
      if (searchDropdown) {
        searchDropdown.hidden = true;
      }
      return;
    }
    loadSearchResults(results, autofocus);
}

// populate and display search results
function loadSearchResults(list: SearchResults, autofocus: boolean = false): void {
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
    option.addEventListener("focus", () => {
      speak(result.name);
    });
    option.addEventListener("keydown", (event) => {
      if (event.key == "ArrowDown") {
        event.preventDefault();
        const nextOption = option.nextElementSibling as HTMLButtonElement | null;
        if (nextOption) {
          nextOption.focus();
        }
      } else if (event.key == "ArrowUp") {
        event.preventDefault();
        const prevOption = option.previousElementSibling as HTMLButtonElement | null;
        if (prevOption) {
          prevOption.focus();
        }
      }

    if ((event.key.length !== 1 ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey) &&
        event.key !== "Backspace" &&
        event.key !== "Delete"
    ) return; //not printable character

      searchInput.focus()

      searchInput.dispatchEvent(new KeyboardEvent("keydown", {
        key: event.key,
        code: event.code,
        keyCode: event.keyCode,
        which: event.which,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        repeat: event.repeat,
      }));
    });

    searchDropdown.appendChild(option);
  }
  
  searchDropdown.hidden = false;

  if (autofocus) {
    const firstOption = searchDropdown.querySelector(".search-option") as HTMLButtonElement | null;
    firstOption?.focus();
  }
}
let searchInputTimeout: number | null = null;
searchInput?.addEventListener("input", () => {
  if (searchInputTimeout) {
    clearTimeout(searchInputTimeout);
  }
  if (!searchInput.value.trim()) return;
  searchInputTimeout = window.setTimeout(async () => {
    findSearchResults(searchInput.value.trim(), true);
  }, config.search.timeoutDelayMs);
})
searchInput?.addEventListener("focus", () => {
  findSearchResults(searchInput.value.trim());
});

searchInput?.addEventListener("focus", () => {
  speak("Enter a location to search");
});

scannerToggle?.addEventListener("click", () => {
  if (loadingTempData) return;
  void toggleScanner();
});

scannerToggle?.addEventListener("focus", () => {
  speak("Play scanner");
});

window.addEventListener("keydown", (event) => {
  if (event.key === "p" && searchInput !== document.activeElement) {
    void toggleScanner();
  }
  if (event.key === "/") {
    event.preventDefault();
    searchInput?.select();
  }
});

async function refreshTempData(min_lat: number, max_lat: number, min_lon: number, max_lon: number, date: string, downscale: number, narratorEnabled: boolean = true): Promise<void> {
  scannerAbort?.abort();
  if (narratorEnabled) speak("Loading " + searchInput?.value.trim() + " temperature map");
  loadingTempData = true;
  clearCanvas();
  const tempData = await fetchTempData(min_lat, max_lat, min_lon, max_lon, date, downscale);

  if (tempData) {
    if (narratorEnabled) {
      speak("Temperature map loaded");
      speak("Press p to play the scanner");
    }
    currentData = tempData;
    drawTempData(tempData);
    updateTimeReadout(date);

    if (scannerToggle) {
      scannerToggle.disabled = false;
    }
  } else {
    if (narratorEnabled) speak("Error while loading temperature map");
  }
  loadingTempData = false;
}
refreshTempData(-90, 90, -180, 180, currentHourUTC().toISOString(),3, false);