import { TempData } from "./types";
import { config } from "./config";

export async function fetchTempData(min_lat: number = -90, max_lat: number = 90, min_lon: number = -180, max_lon: number = 180, date: string = new Date().toISOString()): Promise<TempData | undefined> {
  try {
    const response = await fetch(
      new URL(`/global-temperature/data?min_lat=${min_lat}&max_lat=${max_lat}&min_lon=${min_lon}&max_lon=${max_lon}&date=${date}`, config.apiUrl),
    );
    if (!response.ok) {
      throw new Error(`Backend returned HTTP ${response.status}`);
    }
    return (await response.json()) as TempData;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to fetch temperature data: ${message}`);
    return undefined;
  }
}
