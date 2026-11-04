(function (root) {
  class FrameBuffer {
    constructor({ durationMs = 300000, maxBytes = 80 * 1024 * 1024, maxFrames = 3001 } = {}) {
      this.durationMs = durationMs;
      this.maxBytes = maxBytes;
      this.maxFrames = maxFrames;
      this.frames = [];
      this.bytes = 0;
      this.capacityLimited = false;
    }

    add(frame) {
      if (!frame?.blob || !Number.isFinite(frame.time) || frame.blob.size > this.maxBytes) return false;
      if (this.frames.length && frame.time <= this.frames.at(-1).time) return false;
      this.frames.push(frame);
      this.bytes += frame.blob.size;
      while (this.frames.length && this.frames[0].time < frame.time - this.durationMs) this.removeOldest();
      this.capacityLimited = this.bytes > this.maxBytes || this.frames.length > this.maxFrames;
      while (this.frames.length && (this.bytes > this.maxBytes || this.frames.length > this.maxFrames)) this.removeOldest();
      return true;
    }

    removeOldest() {
      this.bytes -= this.frames.shift().blob.size;
    }

    clear() {
      this.frames.length = 0;
      this.bytes = 0;
      this.capacityLimited = false;
    }

    snapshot() { return this.frames.slice(); }

    get duration() {
      return this.frames.length ? this.frames.at(-1).time - this.frames[0].time : 0;
    }
  }
  if (typeof module !== 'undefined') module.exports = FrameBuffer;
  else root.FrameBuffer = FrameBuffer;
})(globalThis);
