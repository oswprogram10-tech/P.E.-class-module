(function (root) {
  const Timeline = {
    select(frames, end, durationSeconds) {
      const start = end - durationSeconds * 1000;
      const invalid = reason => ({ start, end, frames: [], valid: false, reason });
      if (!Number.isFinite(end) || !Number.isInteger(durationSeconds) || durationSeconds < 5 || durationSeconds > 30 || durationSeconds % 5) return invalid('저장 길이는 5~30초에서 선택해 주세요.');
      if (!frames.length || frames[0].time > start + 150 || frames.at(-1).time < end - 150) return invalid('이 구간에는 영상이 충분하지 않아요. 더 짧은 길이나 다른 장면을 선택해 주세요.');
      const first = Timeline.frameAt(frames, start);
      const selected = frames.filter(frame => frame.time >= first.time && frame.time <= end);
      if (!selected.length) return invalid('선택할 영상이 없어요.');
      for (let index = 1; index < selected.length; index++) {
        if (selected[index].time - selected[index - 1].time > 500) return invalid('중간 영상이 끊긴 구간이에요. 다른 장면을 선택해 주세요.');
      }
      if (end - selected.at(-1).time > 500) return invalid('구간 끝 영상이 부족해요. 다른 장면을 선택해 주세요.');
      return { start, end, frames: selected, valid: true, reason: '' };
    },
    // Hold the last available frame across capture gaps without changing duration.
    frameAt(frames, time) {
      let low = 0;
      let high = frames.length - 1;
      if (high < 0) return null;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (frames[middle].time <= time) low = middle;
        else high = middle - 1;
      }
      return frames[low];
    },
  };
  if (typeof module !== 'undefined') module.exports = Timeline;
  else root.Timeline = Timeline;
})(globalThis);
