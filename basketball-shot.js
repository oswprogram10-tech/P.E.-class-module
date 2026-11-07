/* Experimental 2D movement cues, not shot success or technique assessment. */
(function (root) {
  'use strict';
  const Presence = typeof module !== 'undefined' && module.exports ? require('./pose-presence.js') : root.PosePresence;
  const LEVELS = Object.freeze({
    low: Object.freeze({ readyAngle: 130, shootAngle: 165, wristAboveEar: .18 }),
    normal: Object.freeze({ readyAngle: 140, shootAngle: 160, wristAboveEar: .10 }),
    high: Object.freeze({ readyAngle: 150, shootAngle: 155, wristAboveEar: .04 }),
  });
  const GAP_MS = 1000, HOLD_MS = 250, MIN_FRAMES = 2;
  function settings(value) {
    if (!value || !['left', 'right'].includes(value.side) || !Object.prototype.hasOwnProperty.call(LEVELS, value.sensitivity)) throw new TypeError('Invalid shot settings');
    return { side: value.side, sensitivity: value.sensitivity };
  }
  function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function angle(a, b, c) {
    const ax = a.x - b.x, ay = a.y - b.y, cx = c.x - b.x, cy = c.y - b.y;
    const product = Math.hypot(ax, ay) * Math.hypot(cx, cy);
    if (product < 1e-8) return null;
    return Math.acos(Math.max(-1, Math.min(1, (ax * cx + ay * cy) / product))) * 180 / Math.PI;
  }
  class Detector {
    constructor(options = { side: 'right', sensitivity: 'normal' }) { this.options = settings(options); this.reset(); }
    reset(reason = 'reset') {
      this.state = 'waiting'; this.phase = null; this.lastTime = null; this.lastBody = null;
      return { state: 'waiting', angle: null, event: false, reason };
    }
    configure(options) { this.options = settings(options); return this.reset('settings'); }
    update({ landmarks, timestamp, width, height } = {}) {
      if (!Number.isFinite(timestamp) || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return this.reset('invalid-frame');
      const presence = Presence.analyze(landmarks);
      if (!presence.usable) return this.reset(presence.reason);
      if (this.lastTime !== null && (timestamp <= this.lastTime || timestamp - this.lastTime > GAP_MS)) this.reset('gap');
      const point = index => ({ x: landmarks[index].x * width / height, y: landmarks[index].y });
      const leftShoulder = point(11), rightShoulder = point(12), leftHip = point(23), rightHip = point(24);
      const center = { x: (leftShoulder.x + rightShoulder.x + leftHip.x + rightHip.x) / 4, y: (leftShoulder.y + rightShoulder.y + leftHip.y + rightHip.y) / 4 };
      const torso = distance({ x: (leftShoulder.x + rightShoulder.x) / 2, y: (leftShoulder.y + rightShoulder.y) / 2 }, { x: (leftHip.x + rightHip.x) / 2, y: (leftHip.y + rightHip.y) / 2 });
      const direction = Math.sign(rightShoulder.x - leftShoulder.x);
      if (torso < .05 || !direction) return this.reset('body-geometry');
      if (this.lastBody && (direction !== this.lastBody.direction || distance(center, this.lastBody.center) > Math.min(torso, this.lastBody.torso))) this.reset('tracking-change');
      this.lastTime = timestamp; this.lastBody = { center, torso, direction };
      const [ear, shoulder, elbow, wrist] = this.options.side === 'left' ? [7, 11, 13, 15] : [8, 12, 14, 16];
      const e = point(ear), s = point(shoulder), a = angle(s, point(elbow), point(wrist)), w = point(wrist);
      if (a === null) return this.reset('arm-geometry');
      const level = LEVELS[this.options.sensitivity];
      const wristToEar = (e.y - w.y) / torso, wristToShoulder = (s.y - w.y) / torso;
      let candidate = null;
      if (this.state === 'waiting') {
        // A wider continuation band avoids losing a hold on a noisy boundary.
        const continuing = this.phase?.kind === 'ready';
        if (wristToShoulder >= (continuing ? -.25 : -.15) && wristToEar <= (continuing ? .05 : 0) && a <= level.readyAngle + (continuing ? 5 : 0)) candidate = 'ready';
      } else if (this.state === 'ready') {
        const continuing = this.phase?.kind === 'shoot';
        if (wristToEar >= level.wristAboveEar - (continuing ? .04 : 0) && a >= level.shootAngle - (continuing ? 5 : 0)) candidate = 'shoot';
        else if (wristToShoulder < -.35) { this.state = 'waiting'; this.phase = null; }
      } else {
        // A distinct lowered-arm hold is required before another ready pose.
        const continuing = this.phase?.kind === 'lower';
        if (wristToShoulder <= (continuing ? -.25 : -.35)) candidate = 'lower';
      }
      let event = false;
      if (!candidate) this.phase = null;
      else if (this.phase?.kind !== candidate) this.phase = { kind: candidate, start: timestamp, frames: 1 };
      else {
        this.phase.frames++;
        if (this.phase.frames >= MIN_FRAMES && timestamp - this.phase.start >= HOLD_MS) {
          if (candidate === 'ready') this.state = 'ready';
          else if (candidate === 'shoot') { this.state = 'shoot'; event = true; }
          else this.state = 'waiting';
          this.phase = null;
        }
      }
      return { state: this.state, angle: a, event, reason: null, ...(event ? { wristToEar, wristToShoulder } : {}) };
    }
  }
  const api = { Detector, LEVELS, GAP_MS, HOLD_MS, MIN_FRAMES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BasketballShot = api;
})(globalThis);
