(function (root) {
  'use strict';

  // Conservative front-facing full-body availability precondition: nose, both
  // ears, shoulders/elbows/wrists, hips/knees/ankles, and foot-index points.
  // It does not classify a shot or make an educational/accuracy judgment.
  const REQUIRED_INDICES = Object.freeze([0, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 31, 32]);
  const MIN_CONFIDENCE = 0.6;
  const FRAME_MARGIN = Object.freeze({ min: 0.02, max: 0.98 });
  const MIN_TORSO_HEIGHT = 0.12;
  const MIN_BODY_HEIGHT = 0.4;
  const MESSAGES = Object.freeze({
    missing: '전신 관절 정보를 충분히 찾지 못했어요. 화면 안에 한 명이 보이도록 해 주세요.',
    confidence: '관절이 가려졌거나 확신이 낮아요. 카메라와 몸 사이를 비우고 다시 서 주세요.',
    'out-of-frame': '몸의 일부가 화면 밖에 있어요. 전신이 화면 안에 들어오도록 조정해 주세요.',
    'too-small': '화면에서 몸이 너무 작게 보여요. 카메라에 조금 더 가까이 서 주세요.',
  });

  function result(reason) { return { usable: false, reason, message: MESSAGES[reason] }; }
  function midpointY(a, b) { return (a.y + b.y) / 2; }

  function analyze(landmarks) {
    if (!Array.isArray(landmarks)) return result('missing');
    for (const index of REQUIRED_INDICES) {
      if (!landmarks[index] || typeof landmarks[index] !== 'object') return result('missing');
    }
    for (const index of REQUIRED_INDICES) {
      const point = landmarks[index];
      if (![point.x, point.y, point.visibility].every(Number.isFinite) || point.visibility < MIN_CONFIDENCE) return result('confidence');
      if (Object.prototype.hasOwnProperty.call(point, 'presence') &&
          (!Number.isFinite(point.presence) || point.presence < MIN_CONFIDENCE)) return result('confidence');
    }
    for (const index of REQUIRED_INDICES) {
      const point = landmarks[index];
      if (point.x < FRAME_MARGIN.min || point.x > FRAME_MARGIN.max ||
          point.y < FRAME_MARGIN.min || point.y > FRAME_MARGIN.max) return result('out-of-frame');
    }

    const leftShoulder = landmarks[11], rightShoulder = landmarks[12];
    const leftHip = landmarks[23], rightHip = landmarks[24];
    const torsoHeight = Math.abs(midpointY(leftHip, rightHip) - midpointY(leftShoulder, rightShoulder));
    const bodyYs = REQUIRED_INDICES.map(index => landmarks[index].y);
    const bodyHeight = Math.max(...bodyYs) - Math.min(...bodyYs);
    if (torsoHeight < MIN_TORSO_HEIGHT || bodyHeight < MIN_BODY_HEIGHT) return result('too-small');
    return { usable: true, reason: null, message: '전신 관절을 확인했어요.' };
  }

  const api = { analyze, REQUIRED_INDICES, MIN_CONFIDENCE, FRAME_MARGIN, MIN_TORSO_HEIGHT, MIN_BODY_HEIGHT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PosePresence = api;
})(globalThis);
