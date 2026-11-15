export const config = {
  apiUrl: "http://localhost:3000",
  audioFreqRangeHz: [20, 5_000],
  tempRangeC: [-35, 35],
  scanner: {
    samples: 64,
    // one row per frame (50ms)
    delayMs: 1000 / 20,
    // peak gain for a single voice; scaled by temperature
    voiceVolume: 0.45,
    masterVolume: 0.7,
  },
  search: {
    timeoutDelayMs: 300,
  },
} as const;
