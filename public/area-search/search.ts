import { SearchResults } from "../types";
import { config } from "../config";

export async function searchArea(query: string): Promise<SearchResults | undefined> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5_000);

  try {
    const response = await fetch(
      new URL(`/geocode/search?q=${query}`, config.apiUrl),
      { signal: controller.signal },
    );
    if (!response.ok) {
      throw new Error(`Backend returned HTTP ${response.status}`);
    }
    return (await response.json()) as SearchResults;
  } catch (error) {
    const message = controller.signal.aborted
      ? "Timed out"
      : error instanceof Error
        ? error.message
        : String(error);
    console.error(`Failed to fetch search results: ${message}`);
    return undefined;
  } finally {
    window.clearTimeout(timeout);
  }
}
