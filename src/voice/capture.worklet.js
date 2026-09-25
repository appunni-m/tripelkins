// A single bounded mono buffer. No recordings are persisted.
class ColonyMicrophone extends AudioWorkletProcessor {
  constructor() {
    super();
    this.audio = new Float32Array(Math.ceil(sampleRate * 15));
    this.length = 0;
    this.lastMeter = 0;
    this.finished = false;
    this.port.onmessage = ({ data }) => {
      if (data === "stop") this.finish();
    };
  }
  finish() {
    if (this.finished) return;
    this.finished = true;
    this.port.postMessage(
      { type: "audio", audio: this.audio, length: this.length, sampleRate },
      [this.audio.buffer],
    );
  }
  process(inputs) {
    if (this.finished) return false;
    const input = inputs[0]?.[0];
    if (!input) return true;
    const count = Math.min(input.length, this.audio.length - this.length);
    this.audio.set(input.subarray(0, count), this.length);
    this.length += count;
    if (this.length - this.lastMeter >= sampleRate / 10) {
      let energy = 0;
      for (const value of input) energy += value * value;
      this.port.postMessage({
        type: "level",
        level: Math.sqrt(energy / input.length),
        seconds: this.length / sampleRate,
      });
      this.lastMeter = this.length;
    }
    if (this.length === this.audio.length) this.finish();
    return !this.finished;
  }
}
registerProcessor("colony-microphone", ColonyMicrophone);
