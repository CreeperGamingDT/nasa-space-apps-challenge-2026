// AudioWorklet DSP: a bank of sine oscillators with independent gain and pan.
// Kept in public/ as plain JS so Vite serves it untouched in dev and build.

const TABLE_SIZE = 2048;

class ScannerProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    const count = options.processorOptions?.count ?? 0;
    this.count = count;

    this.phase = new Float32Array(count);
    this.frequency = new Float32Array(count);
    this.targetFrequency = new Float32Array(count);
    this.gain = new Float32Array(count);
    this.targetGain = new Float32Array(count);
    this.pan = new Float32Array(count);
    this.leftPan = new Float32Array(count);
    this.rightPan = new Float32Array(count);

    this.running = true;

    // Sine lookup table so the per-sample loop avoids Math.sin.
    this.table = new Float32Array(TABLE_SIZE + 1);
    for (let i = 0; i <= TABLE_SIZE; i++) {
      this.table[i] = Math.sin((i / TABLE_SIZE) * Math.PI * 2);
    }

    this.port.onmessage = ({ data }) => {
      if (data.type === "update") {
        if (data.frequencies) this.targetFrequency.set(data.frequencies);
        if (data.gains) this.targetGain.set(data.gains);
        if (data.pans) this.pan.set(data.pans);
      } else if (data.type === "stop") {
        this.targetGain.fill(0);
        this.running = false;
      }
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    const left = output[0];
    const right = output[1] ?? output[0];
    const frames = left.length;
    const count = this.count;

    // One-pole smoothing per block (~20 ms), so 60 Hz target updates don't click.
    const smooth = 1 - Math.exp(-frames / sampleRate / 0.02);
    const norm = count > 0 ? 1 / Math.sqrt(count) : 0;

    for (let i = 0; i < count; i++) {
      this.frequency[i] += (this.targetFrequency[i] - this.frequency[i]) * smooth;
      this.gain[i] += (this.targetGain[i] - this.gain[i]) * smooth;

      // Equal-power pan: -1 hard left, 0 centre, +1 hard right.
      const angle = ((this.pan[i] + 1) * Math.PI) / 4;
      this.leftPan[i] = Math.cos(angle);
      this.rightPan[i] = Math.sin(angle);
    }

    const stereo = output.length > 1;

    for (let s = 0; s < frames; s++) {
      let l = 0;
      let r = 0;

      for (let i = 0; i < count; i++) {
        const position = this.phase[i] * TABLE_SIZE;
        const index = position | 0;
        const fraction = position - index;
        const sample =
          (this.table[index] +
            (this.table[index + 1] - this.table[index]) * fraction) *
          this.gain[i];

        l += sample * this.leftPan[i];
        r += sample * this.rightPan[i];

        let next = this.phase[i] + this.frequency[i] / sampleRate;
        if (next >= 1) next -= 1;
        this.phase[i] = next;
      }

      if (stereo) {
        left[s] = l * norm;
        right[s] = r * norm;
      } else {
        left[s] = (l + r) * 0.7071 * norm;
      }
    }

    if (!this.running) {
      let audible = false;
      for (let i = 0; i < count; i++) {
        if (Math.abs(this.gain[i]) > 1e-5) {
          audible = true;
          break;
        }
      }
      if (!audible) return false;
    }

    return true;
  }
}

registerProcessor("scanner-processor", ScannerProcessor);
