import { TempData } from "./types";
import { config } from "./config";

function currentHourUTC(): Date {
  const now = new Date();
  now.setUTCMinutes(0, 0, 0);
  return now;
}

export async function fetchTempData(min_lat: number = -90, max_lat: number = 90, min_lon: number = -180, max_lon: number = 180, date: string = currentHourUTC().toISOString()): Promise<TempData | undefined> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 90_000);

  try {
    const response = await fetch(
      new URL(`/global-temperature/data?min_lat=${min_lat}&max_lat=${max_lat}&min_lon=${min_lon}&max_lon=${max_lon}&date=${date}`, config.apiUrl),
      { signal: controller.signal },
    );
    if (!response.ok) {
      throw new Error(`Backend returned HTTP ${response.status}`);
    }
    return (await response.json()) as TempData;
  } catch (error) {
    const message = controller.signal.aborted
      ? "Timed out"
      : error instanceof Error
        ? error.message
        : String(error);
    console.error(`Failed to fetch temperature data: ${message}`);
    return undefined;
  } finally {
    window.clearTimeout(timeout);
  }
}
