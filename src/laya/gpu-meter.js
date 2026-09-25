// Verification only. Counts requested buffer bytes; GPU driver/pipeline memory
// and WASM/JS heaps are separate. Keeps counters, never references to buffers.
export function meterGpuBuffers(device) {
  const stats = { liveBytes: 0, peakBytes: 0, allocatedBytes: 0,
    createdBuffers: 0, liveBuffers: 0 };
  const create = device.createBuffer.bind(device);
  device.createBuffer = (descriptor) => {
    const buffer = create(descriptor), bytes = Number(descriptor.size);
    stats.liveBytes += bytes; stats.allocatedBytes += bytes;
    stats.liveBuffers++; stats.createdBuffers++;
    stats.peakBytes = Math.max(stats.peakBytes, stats.liveBytes);
    const destroy = buffer.destroy.bind(buffer);
    let destroyed = false;
    buffer.destroy = () => {
      if (!destroyed) { stats.liveBytes -= bytes; stats.liveBuffers--; destroyed = true; }
      return destroy();
    };
    return buffer;
  };
  return () => ({ ...stats });
}
