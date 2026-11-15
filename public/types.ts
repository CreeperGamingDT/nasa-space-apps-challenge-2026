export interface TempData {
  values: number[][];
  shape: number[]; // [height, width]
}
export interface SearchResult {
  bbox: [number, number, number, number]; // [lat_min, lat_max, lon_min, lon_max]
  name: string;
}
export type SearchResults = SearchResult[];