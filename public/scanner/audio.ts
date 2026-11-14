import workletUrl from "./scanner-processor.js?url&no-inline";
import { config } from "../config";

export interface Voice {
  frequency(hz: number): void;
  volume(level: number): void;
  pan(value: number): void;
}

export interface VoiceBank {
  readonly voices: readonly Voice[];
  dispose(): void;
}

const MIN_FREQ_HZ = 20;

let audioContext: AudioContext | null = null;
let workletReady: Promise<void> | null = null;

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  return audioContext;
}

function loadWorklet(context: AudioContext): Promise<void> {
  workletReady ??= context.audioWorklet.addModule(workletUrl);
  return workletReady;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

// creates a bank of oscillators/voices that get combined into one master output
export async function initVoices(count: number): Promise<VoiceBank> {
  const context = getAudioContext();
  await loadWorklet(context);

  if (context.state === "suspended") {
    // Fire-and-forget: the context resumes as soon as the browser allows it.
    void context.resume();
  }

  const node = new AudioWorkletNode(context, "scanner-processor", {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    processorOptions: { count },
  });

  const master = context.createGain();
  master.gain.value = config.scanner.masterVolume;

  // Prevents clipping when multiple voices are active at once.
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.knee.value = 6;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;

  node.connect(master).connect(limiter).connect(context.destination);

  // Targets live on the main thread; one batched message per row reaches the worklet.
  const frequencies = new Float32Array(count).fill(MIN_FREQ_HZ);
  const gains = new Float32Array(count);
  const pans = new Float32Array(count);

  let flushQueued = false;
  const flush = (): void => {
    flushQueued = false;
    node.port.postMessage({ type: "update", frequencies, gains, pans });
  };
  const scheduleFlush = (): void => {
    if (flushQueued) return;
    flushQueued = true;
    queueMicrotask(flush); //flushes after the next JS task/line of code
  };

  const maxFreq = context.sampleRate / 2 - 100;

  const voices: Voice[] = Array.from({ length: count }, (_, index) => ({
    frequency(hz: number): void {
      frequencies[index] = clamp(hz, MIN_FREQ_HZ, maxFreq);
      scheduleFlush();
    },
    volume(level: number): void {
      gains[index] = clamp(level, 0, 1);
      scheduleFlush();
    },
    pan(value: number): void {
      pans[index] = clamp(value, -1, 1);
      scheduleFlush();
    },
  }));

  let disposed = false;

  return {
    voices,
    dispose(): void {
      if (disposed) return;
      disposed = true;

      node.port.postMessage({ type: "stop" });

      const now = context.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setTargetAtTime(0, now, 0.05);

      window.setTimeout(() => {
        node.disconnect();
        master.disconnect();
        limiter.disconnect();
      }, 300);
    },
  };
}
