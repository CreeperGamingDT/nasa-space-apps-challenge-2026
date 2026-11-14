import { TempData } from "./types";
import { config } from "./config";

export async function fetchTempData(): Promise<TempData | undefined> {
  try {
    const response = await fetch(
      new URL("/global-temperature/data", config.apiUrl),
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
