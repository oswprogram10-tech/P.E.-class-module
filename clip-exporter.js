(function (root) {
  function checkAbort(signal) { signal?.throwIfAborted(); }

  async function exportClip({ frames, start, durationSeconds, signal, onProgress = () => {} }) {
    checkAbort(signal);
    if (!root.VideoEncoder || !root.VideoFrame) throw new Error('이 Chrome에서는 클립 생성을 지원하지 않아요. Chrome을 업데이트해 주세요.');
    if (!frames.length || !Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 30) throw new Error('유효한 저장 구간을 선택해 주세요.');
    const config = { codec: 'vp8', width: 640, height: 360, bitrate: 650000, framerate: 10 };
    const supported = await VideoEncoder.isConfigSupported(config);
    checkAbort(signal);
    if (!supported.supported) throw new Error('이 기기에서 영상 인코더를 시작할 수 없어요.');
    const canvas = document.createElement('canvas');
    canvas.width = config.width; canvas.height = config.height;
    const context = canvas.getContext('2d', { alpha: false });
    const chunks = [];
    let encoderError = null;
    let colorSpace = null;
    const encoder = new VideoEncoder({
      output(chunk, metadata) {
        if (metadata?.decoderConfig?.colorSpace) colorSpace = metadata.decoderConfig.colorSpace;
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        chunks.push({ timestamp: chunk.timestamp, key: chunk.type === 'key', data });
      },
      error(error) { encoderError = error; },
    });
    const abort = () => { if (encoder.state !== 'closed') encoder.close(); };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      encoder.configure(config);
      const count = durationSeconds * config.framerate;
      for (let index = 0; index < count; index++) {
        checkAbort(signal);
        if (encoderError) throw encoderError;
        const timestamp = index * 100000;
        const source = Timeline.frameAt(frames, start + timestamp / 1000);
        let bitmap;
        try {
          bitmap = await createImageBitmap(source.blob);
          checkAbort(signal);
          context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        } finally { bitmap?.close(); }
        const frame = new VideoFrame(canvas, { timestamp, duration: 100000 });
        try { encoder.encode(frame, { keyFrame: index % 10 === 0 }); }
        finally { frame.close(); }
        if (encoder.encodeQueueSize >= 4) await encoder.flush();
        onProgress(Math.round((index + 1) / count * 100));
        // Let cancel, visibility and camera-interruption events run during encoding.
        if (index % 5 === 0) await new Promise(resolve => setTimeout(resolve, 0));
      }
      await encoder.flush();
      checkAbort(signal);
      if (encoderError) throw encoderError;
      const blob = WebMMuxer.mux({ chunks, width: canvas.width, height: canvas.height, durationMs: durationSeconds * 1000, colorSpace });
      checkAbort(signal);
      return { blob, durationSeconds, colorSpace };
    } catch (error) {
      checkAbort(signal);
      throw error;
    } finally {
      signal?.removeEventListener('abort', abort);
      if (encoder.state !== 'closed') encoder.close();
      canvas.width = canvas.height = 0;
    }
  }
  root.ClipExporter = { export: exportClip };
})(globalThis);
