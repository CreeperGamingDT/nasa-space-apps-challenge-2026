import { initVoices } from "./audio";
import { config } from "../config";
import type { TempData } from "../types";
import { clamp, delay } from "../utils";

const [TEMP_MIN, TEMP_MAX] = config.tempRangeC;
const [FREQ_MIN_HZ, FREQ_MAX_HZ] = config.audioFreqRangeHz;

function normalizeTemp(temp: number): number {
  if (!Number.isFinite(temp)) return Number.NaN;
  return clamp((temp - TEMP_MIN) / (TEMP_MAX - TEMP_MIN), 0, 1);
}

/** Map C to a freq (cold = low, hot = high). */
function mapTempToFreq(temp: number): number {
  const normalized = normalizeTemp(temp);
  if (Number.isNaN(normalized)) return FREQ_MIN_HZ;
  return FREQ_MIN_HZ + normalized * (FREQ_MAX_HZ - FREQ_MIN_HZ);
}

/** Map C to a per-voice gain; a small floor keeps cold rows audible. */
function mapTempToVol(temp: number): number {
  const normalized = normalizeTemp(temp);
  if (Number.isNaN(normalized)) return 0;
  return config.scanner.voiceVolume * (0.05 + 0.95 * normalized);
}

/**
 * Scans from bottom-top (south to north) and plays each row as a chord of sine voices.
*/ 
export async function ScannerAudio(
  data: TempData,
  signal?: AbortSignal,
  onRow?: (row: number, totalRows: number) => void,
): Promise<void> {
  const { samples, delayMs } = config.scanner;
  const [height, width] = data.shape;

  if (samples <= 0 || height <= 0 || width <= 0) return;

  //create the oscillators/voices used in each column per row
  const bank = await initVoices(samples);
  const { voices } = bank;
  const lastIndex = samples - 1;

  try {
    for (let y = 0; y < height; y++) {
      if (signal?.aborted) break;

      const row = data.values[y];

      for (let i = 0; i < samples; i++) {
        // Spread the samples evenly across the row's width.
        const x = lastIndex === 0 ? 0 : Math.round((i * (width - 1)) / lastIndex);
        const temp = row[x];

        voices[i].frequency(mapTempToFreq(temp));
        voices[i].volume(mapTempToVol(temp));
        voices[i].pan(lastIndex === 0 ? 0 : (i / lastIndex) * 2 - 1);
      }

      onRow?.(y, height);

      // wait a small delay before playing the next row
      await delay(delayMs, signal);
    }
  } finally {
    // kill the oscillators/voices when done or aborted
    bank.dispose();
  }
}
