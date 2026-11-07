const { withBrowser } = require('./browser-helper.cjs');
const assert = require('node:assert/strict');
(async () => {
  await withBrowser(async (page, errors, baseUrl) => {
    await page.addScriptTag({ url: baseUrl + '/classroom-model.js' });
    await page.addScriptTag({ url: baseUrl + '/classroom-repository.js' });
    const result = await page.evaluate(async () => {
      const clips = new ClipRepository('classroom-reset-guard-test');
      const first = await LocalVault.create('123456');
      await clips.initialize(first.config);
      const classroom = new ClassroomRepository(clips);
      const initial = await classroom.load(first.key, first.config.revision);
      ClassroomModel.add(initial.state, 'classes', { name: '가상 학급' });
      const version = await classroom.save(initial.state, first.key, first.config.revision, initial.version);
      let collision = false;
      try { await classroom.save(initial.state, first.key, first.config.revision, 0); } catch { collision = true; }
      const next = await LocalVault.create('654321');
      await clips.reset(next.config);
      let oldReadRejected = false, oldWriteRejected = false;
      try { await classroom.load(first.key, first.config.revision); } catch { oldReadRejected = true; }
      try { await classroom.save(initial.state, first.key, first.config.revision, version); } catch { oldWriteRejected = true; }
      const clean = await classroom.load(next.key, next.config.revision);
      return { collision, oldReadRejected, oldWriteRejected, version: clean.version, classCount: clean.state.classes.length };
    });
    assert.deepEqual(result, { collision: true, oldReadRejected: true, oldWriteRejected: true, version: 0, classCount: 0 });
    assert.deepEqual(errors, []);
    console.log('Classroom reset blocks stale reads, stale writes and version conflicts');
  }, { setupTeacher: false });
})().catch(error => { console.error(error); process.exitCode = 1; });
