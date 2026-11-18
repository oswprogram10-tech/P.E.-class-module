(function (root) {
  'use strict';
  const model = Object.freeze({ name: 'Qwen2.5-3B-Instruct Q4_K_M', bytes: 2104932768, sha256: '626b4a6678b86442240e33df819e00132d3ba7dddfe1cdc4fbb18e0a9615c62d', revision: '7dabda4d13d513e3e842b20f0d435c732f172cbe', license: 'Qwen RESEARCH LICENSE: 비상업적 연구·평가 용도만 허용; 상업 사용에는 별도 허가 필요', licenseUrl: 'https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/blob/7dabda4d13d513e3e842b20f0d435c732f172cbe/LICENSE', url: 'https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/7dabda4d13d513e3e842b20f0d435c732f172cbe/qwen2.5-3b-instruct-q4_k_m.gguf' });
  const dirname = 'pe-tactics-model-v1', filename = 'model.gguf', marker = 'verified.json';
  const asset = new URL('./', document.currentScript.src); let engine = null, active = false, tokenizerPromise = null, lease = null, idleTimer = null, generation = 0, exitPromise = null, activeDone = null, releasePromise = null;
  const idleMs = 30000;
  function release() {
    if (releasePromise) return releasePromise;
    generation++; releasePromise = releaseResources().finally(() => { releasePromise = null; });
    return releasePromise;
  }
  async function releaseResources() {
    if (idleTimer) clearTimeout(idleTimer); idleTimer = null;
    const old = engine; engine = null;
    if (old) exitPromise = Promise.resolve().then(() => old.exit()).catch(() => {});
    if (exitPromise) { await exitPromise; exitPromise = null; }
    if (activeDone) await activeDone;
    if (lease) { const held = lease; lease = null; held.release(); await held.done; }
  }
  function scheduleRelease() { clearTimeout(idleTimer); idleTimer = setTimeout(() => { void release(); }, idleMs); }
  async function acquireLease() {
    if (releasePromise) await releasePromise;
    clearTimeout(idleTimer); idleTimer = null; if (lease) return;
    let notify, unlock; const ready = new Promise(resolve => { notify = resolve; });
    const done = Promise.resolve().then(() => navigator.locks.request('pe-tactics-local-model-v1', { ifAvailable: true }, async lock => {
      if (!lock) { notify({ acquired: false }); return; }
      await new Promise(resolve => { unlock = resolve; notify({ acquired: true }); });
    })).then(() => null, error => { notify({ error }); return error; });
    const outcome = await ready;
    if (outcome.error) { await done; throw outcome.error; }
    if (!outcome.acquired) { await done; throw new Error('다른 탭에서 모델 작업이 진행 중입니다.'); }
    lease = { release: unlock, done };
  }
  function getTokenizer() {
    if (!tokenizerPromise) {
      tokenizerPromise = Promise.all([import('./vendor/hf-tokenizers/tokenizers.mjs'), fetch(new URL('vendor/qwen-tokenizer/tokenizer.json', asset)).then(r => { if (!r.ok) throw new Error('토큰화 자료를 읽지 못했습니다.'); return r.json(); }), fetch(new URL('vendor/qwen-tokenizer/tokenizer_config.json', asset)).then(r => { if (!r.ok) throw new Error('토큰화 설정을 읽지 못했습니다.'); return r.json(); })]).then(([{ Tokenizer }, data, config]) => new Tokenizer(data, config)).catch(error => { tokenizerPromise = null; throw error; });
    }
    return tokenizerPromise;
  }
  document.addEventListener?.('visibilitychange', () => { if (document.hidden) void release(); });
  root.addEventListener?.('pagehide', () => { void release(); });
  const abortError = () => new DOMException('작업을 취소했습니다.', 'AbortError');
  const check = signal => { if (signal?.aborted) throw abortError(); };
  async function directory() { return (await navigator.storage.getDirectory()).getDirectoryHandle(dirname, { create: true }); }
  async function removeEntry(dir, name) { try { await dir.removeEntry(name); } catch (e) { if (e.name !== 'NotFoundError') throw e; } }
  function engineMode() { try { if (!WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,10,1,8,0,65,0,253,15,253,98,11])) || !WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,1,4,1,96,0,0,3,2,1,0,10,8,1,6,0,6,64,25,11,11]))) return 'unsupported'; if (WebAssembly.Suspending) { try { new WebAssembly.Memory({address:'i64',initial:BigInt(1)}); return 'default'; } catch {} } return 'compat'; } catch { return 'unsupported'; } }
  function support() { if (!root.isSecureContext || !navigator.storage?.getDirectory || !navigator.locks?.request || !root.WebAssembly || !root.Worker) return '이 기기는 보안 연결, 파일 저장 또는 WebAssembly를 지원하지 않습니다. 브라우저와 Android System WebView를 업데이트해 주세요.'; if (engineMode() === 'unsupported') return '이 기기의 WebAssembly 기능이 부족합니다. 브라우저와 Android System WebView를 업데이트해 주세요.'; return ''; }
  async function status() {
    const reason = support(); if (reason) return { installed: false, supported: false, reason, model, state: 'unsupported' };
    try { const d = await directory(); const saved = JSON.parse(await (await (await d.getFileHandle(marker)).getFile()).text()); const file = await (await d.getFileHandle(filename)).getFile(); const installed = saved.sha256 === model.sha256 && file.size === model.bytes; return { installed, supported: true, reason: installed ? '' : '설치가 완료되지 않았습니다. 다시 설치해 주세요.', model, engineMode: engineMode(), warm: installed && !!engine && !!lease, state: installed ? 'installed' : 'incomplete' }; }
    catch (e) { if (e.name === 'NotFoundError' || e instanceof SyntaxError) return { installed: false, supported: true, reason: '', model, engineMode: engineMode(), state: 'not-installed' }; return { installed: false, supported: false, reason: '기기 저장소를 사용할 수 없습니다.', model, state: 'unsupported' }; }
  }
  async function installImpl({ signal, onProgress = () => {} } = {}) {
    if (active) throw new Error('다른 모델 작업이 진행 중입니다.'); active = true; let d, writer, reader;
    try {
      check(signal); const current = await status(); if (!current.supported) throw new Error(current.reason); if (current.installed) return current;
      const estimate = await navigator.storage.estimate(); if (Number.isFinite(estimate.quota) && Number.isFinite(estimate.usage) && estimate.quota - estimate.usage < model.bytes + 64 * 1024 * 1024) throw new Error('모델 설치를 위한 저장 공간이 부족합니다.');
      d = await directory(); await removeEntry(d, marker); await removeEntry(d, filename);
      const [{ sha256 }, response] = await Promise.all([import('./vendor/noble-hashes/sha256.js'), fetch(model.url, { signal, credentials: 'omit' })]);
      if (!response.ok || !response.body) throw new Error('모델 파일을 내려받지 못했습니다. 네트워크를 확인해 주세요.');
      const hasher = sha256.create(); reader = response.body.getReader(); writer = await (await d.getFileHandle(filename, { create: true })).createWritable(); let received = 0;
      for (;;) { check(signal); const { done, value } = await reader.read(); if (done) break; received += value.length; if (received > model.bytes) throw new Error('모델 파일 크기가 올바르지 않습니다.'); hasher.update(value); await writer.write(value); onProgress({ phase: 'download', received, total: model.bytes, message: '모델 다운로드 및 무결성 확인 중' }); }
      check(signal); const digest = [...hasher.digest()].map(b => b.toString(16).padStart(2, '0')).join('');
      if (received !== model.bytes || digest !== model.sha256) throw new Error('모델 파일의 크기 또는 무결성이 맞지 않습니다. 다시 설치해 주세요.');
      await writer.close(); writer = null; check(signal);
      const commit = await (await d.getFileHandle(marker, { create: true })).createWritable(); await commit.write(JSON.stringify({ sha256: digest, bytes: received, revision: model.revision })); await commit.close();
      try { await navigator.storage.persist?.(); } catch {} onProgress({ phase: 'installed', received, total: model.bytes, message: '모델 설치 완료' }); return await status();
    } catch (error) { if (reader) try { await reader.cancel(); } catch {} if (writer) try { await writer.abort(); } catch {} if (d) { await removeEntry(d, marker); await removeEntry(d, filename); } throw error; }
    finally { active = false; }
  }
  async function removeImpl() { if (active) throw new Error('모델 작업을 먼저 취소해 주세요.'); if (engine) { await engine.exit(); engine = null; } const d = await directory(); await removeEntry(d, marker); await removeEntry(d, filename); return status(); }
  function prepare(input) {
    const advisor = root.TacticsLocalSearch.createLocalAdvisor();
    return input && Object.prototype.hasOwnProperty.call(input, 'board') ? advisor.prepare(input) : advisor.prepareText(input);
  }
  function cards(references) {
    return references.map(row => ({ ...row, similarity: row.scopes?.length ? `자료에서 확인된 비교 범위: ${[...new Set(row.scopes.map(scope => scope.supported))].join(' · ')}` : `자료에 기록된 내용: ${row.observed}`, similarityOrigin: 'source' }));
  }
  function resultFor(references, kind, modelUsed) {
    const cases = cards(references);
    return { summary: cases.length ? `${cases.length}개의 비교할 경기 자료를 찾았습니다.` : '요청과 가까운 경기 자료를 찾지 못했습니다.', cases, comparisonLimit: '자료에 기록된 조건만 비교할 수 있습니다. 빠진 조건과 수업 규칙의 차이를 확인하세요.', model: model.name, modelUsed, resultKind: kind, generatedAt: Date.now() };
  }
  async function search(input, { signal } = {}) { check(signal); const prepared = prepare(input); check(signal); return resultFor(prepared.references, 'retrieval', false); }
  async function suggestImpl(input, { signal, onProgress = () => {} } = {}) {
    if (active) throw new Error('다른 모델 작업이 진행 중입니다.'); active = true;
    let finishActive; activeDone = new Promise(resolve => { finishActive = resolve; });
    let stop, succeeded = false; const ownGeneration = generation; try {
      check(signal); const prepared = prepare(input);
      if (!prepared.references.length) return resultFor([], 'retrieval', false);
      onProgress({ phase: 'tokenizing', message: '검색 후보의 입력 길이를 확인하는 중' });
      const tokenizer = await getTokenizer(); check(signal);
      const tokenCount = value => { check(signal); return tokenizer.encode(value, { add_special_tokens: false }).ids.length + 4; };
      const plan = root.TacticsLocalPrompt.planCandidates({ request: prepared.input.request, sport: prepared.input.sport, references: prepared.references, tokenCount });
      const { prompt, tokens } = plan, refs = plan.references;
      const ready = await status(); if (!ready.installed) throw new Error(ready.reason || '먼저 기기에 모델을 설치해 주세요.');
      stop = () => { void release(); }; signal?.addEventListener('abort', stop, { once: true }); check(signal);
      if (!engine) {
        const { Wllama } = await import('./vendor/wllama-v3/index.js'); check(signal);
        if (ownGeneration !== generation) throw abortError();
        engine = new Wllama({ default: new URL('vendor/wllama-v3/wasm/wllama.wasm', asset).href });
        engine.setCompat({ wasm: new URL('vendor/wllama-v3/compat/wllama.wasm', asset).href, worker: new URL('vendor/wllama-v3/compat/wllama.js', asset).href });
        onProgress({ phase: 'loading', message: '모델을 기기 메모리에 여는 중' });
        const d = await directory(), file = await (await d.getFileHandle(filename)).getFile();
        try { await engine.loadModel([file], { n_ctx: 1024, n_batch: 128, n_ubatch: 64, n_threads: root.crossOriginIsolated ? Math.min(4, Math.max(1, navigator.hardwareConcurrency || 1)) : 1 }); } catch (error) { if (signal?.aborted || ownGeneration !== generation) throw abortError(); throw new Error('이 기기에서 모델을 열지 못했습니다. 메모리와 WebAssembly 지원 상태를 확인해 주세요.'); }
      } else onProgress({ phase: 'warm', message: '메모리에 열린 모델을 다시 사용하는 중' });
      check(signal); if (ownGeneration !== generation) throw abortError();
      onProgress({ phase: 'prefill', message: '모델이 입력을 처리하는 중', received: tokens, total: 512 });
      let generated = 0, answer = '', finishReason; const grammar = root.TacticsLocalPrompt.responseGrammar(refs.map(row => row[0]));
      await engine.createCompletion({ prompt, max_tokens: 96, temperature: 0.2, grammar, cache_prompt: true, id_slot: 0, abortSignal: signal, stream: true, return_progress: true, onData(chunk) { if (chunk.prompt_progress) onProgress({ phase: 'prefill', message: '모델이 입력을 처리하는 중', received: chunk.prompt_progress.processed, total: chunk.prompt_progress.total }); const choice = chunk.choices?.[0]; if (choice?.text) { answer += choice.text; generated++; onProgress({ phase: 'generating', message: '기기에서 사례를 선택하는 중', received: generated }); } if (choice?.finish_reason) finishReason = choice.finish_reason; } }); check(signal); if (ownGeneration !== generation) throw abortError();
      if (finishReason === 'length') throw new Error('기기 모델의 선택이 길이 제한 안에 끝나지 않았습니다. 검색된 자료를 직접 확인해 주세요.');
      let parsed; try { parsed = JSON.parse(answer.trim()); } catch { throw new Error('기기 모델의 선택 형식을 확인하지 못했습니다. 검색된 자료를 직접 확인해 주세요.'); }
      const selected = root.TacticsLocalPrompt.validateSelection(parsed, prepared.references.filter(row => refs.some(ref => ref[0] === row.id)));
      const result = resultFor(selected, 'model-selection', true);
      if (!selected.length) result.summary = '모델이 검토한 후보에서 사례를 선택하지 않았습니다. 검색된 자료를 직접 확인해 주세요.';
      result.comparisonLimit += ` 모델은 제한적인 근거 프로파일로 검색 후보 ${plan.totalCount}개 중 ${refs.length}개를 검토했습니다. 모델 입력에는 원문 전체와 다른 비교 범위 및 제한이 생략될 수 있으므로 전체 자료와 빠진 조건을 확인하세요.`;
      succeeded = true; return { ...result, modelAttempted: true, modelCoverage: { retrieved: plan.totalCount, shown: refs.length, omittedIds: plan.omittedIds } }; 
    } catch (e) { if (signal?.aborted) throw abortError(); throw e; }
    finally { signal?.removeEventListener('abort', stop); active = false; activeDone = null; finishActive(); if (!succeeded || ownGeneration !== generation) await release(); }
  }

  async function locked(work) {
    const reason = support(); if (reason) throw new Error(reason);
    return navigator.locks.request('pe-tactics-local-model-v1', { ifAvailable: true }, async lock => { if (!lock) throw new Error('다른 탭에서 모델 작업이 진행 중입니다.'); return work(); });
  }
  const install = async options => { await release(); return locked(() => installImpl(options)); };
  const remove = async () => { await release(); return locked(removeImpl); };
  let pending = false;
  const suggest = async (input, options) => {
    const found = await search(input, options); if (!found.cases.length) return found;
    if (pending || active) throw new Error('다른 모델 작업이 진행 중입니다.');
    pending = true; const requestedGeneration = generation;
    try { const reason = support(); if (reason) throw new Error(reason); await acquireLease(); if (requestedGeneration !== generation || document.hidden || options?.signal?.aborted) { await release(); throw abortError(); } const result = await suggestImpl(input, options); if (engine && lease) scheduleRelease(); return result; }
    finally { pending = false; }
  };
  root.TacticsLocalAdvisor = { status, install, remove, search, suggest, release };
})(globalThis);
