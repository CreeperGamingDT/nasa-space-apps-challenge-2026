export const config = {
  apiUrl: "http://localhost:3000",
  audioFreqRangeHz: [2_0, 10_000],
  tempRangeC: [-45, 35],
  scanner: {
    samples: 12,
    // one row per frame (16.67ms)
    delayMs: 1000 / 60,
    // peak gain for a single voice; scaled by temperature
    voiceVolume: 0.15,
    masterVolume: 0.7,
  },
} as const;
