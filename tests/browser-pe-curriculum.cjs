'use strict';

const assert = require('node:assert/strict');
const { withBrowser } = require('./browser-helper.cjs');

async function openEvaluations(page) {
  await page.locator('#teacherButton').click();
  await page.locator('#unlockPin').fill('123456');
  await page.locator('#unlockButton').click();
  await page.locator('#teacherContentPanel').waitFor({ state: 'visible' });
  await page.locator('[data-panel="classroom"]').click();
  const panel = page.locator('.classroom-tool').filter({ has: page.locator('#createEvaluationButton') });
  await panel.locator(':scope > summary').click();
  return panel;
}

withBrowser(async (page, errors) => {
  await page.waitForFunction(() => !teacherUnlocked);
  const ids = await page.evaluate(async () => classroomUI.write(state => {
    const cls = ClassroomModel.add(state, 'classes', { name: '성취기준 점검용 학급' });
    const student = ClassroomModel.add(state, 'students', { classId: cls.id, name: '가상 학생' });
    const criteria = TeacherEvaluations.DIMENSIONS.map(dimension => ({ dimension, description: '교사 관찰 기준', levels: ['시작', '기초', '성장', '안정'] }));
    const current = TeacherEvaluations.createRubric({ classId: cls.id, title: '전략형 스포츠 관찰', schoolYear: 2026, criteria });
    const future = TeacherEvaluations.createRubric({ classId: cls.id, title: '중학교 전략형 스포츠', schoolYear: 2027, criteria });
    state.rubrics.push(current, future);
    const legacy = TeacherEvaluations.createEvaluation(state, {
      classId: cls.id, studentId: student.id, rubricId: current.id, ratings: {}, comment: '연결 전 평가',
    });
    return { student: student.id, current: current.id, future: future.id, legacy: legacy.id };
  }));
  let panel = await openEvaluations(page);
  await page.context().setOffline(true);
  await page.selectOption('#evaluationStudent', ids.student);
  await page.selectOption('#evaluationRubric', ids.current);
  await page.selectOption('#evaluationCurriculum-grade', 'middle-3');
  assert.equal(await page.locator('#evaluationCurriculum-code').isDisabled(), true);
  assert.match(await panel.textContent(), /2027학년도부터/);
  await page.selectOption('#evaluationRubric', ids.future);
  assert.equal(await page.locator('#evaluationCurriculum-code option[value="9체02-12"]').count(), 1);
  await page.selectOption('#evaluationCurriculum-code', '9체02-12');
  await page.selectOption('#evaluationRubric', ids.current);
  assert.equal(await page.locator('#evaluationCurriculum-code').inputValue(), '');
  assert.equal(await page.locator('#evaluationCurriculum-code').isDisabled(), true);

  await page.selectOption('#evaluationCurriculum-grade', 'elementary-5');
  await page.selectOption('#evaluationCurriculum-code', '6체02-06');
  assert.match(await panel.locator('fieldset').first().textContent(), /[[]6체02-06[\]]/);
  assert.match(await panel.locator('fieldset').first().getByRole('link', { name: '고시 원문 보기' }).getAttribute('href'), /^https:\/\/www\.moe\.go\.kr\//);
  for (const dimension of ['knowledge', 'skill', 'attitude']) await page.selectOption('#evaluationRating-' + dimension, '2');
  await page.locator('#createEvaluationButton').click();
  await page.waitForFunction(() => classroomUI.state.assessments.length === 2);
  const id = await page.evaluate(() => classroomUI.state.assessments[1].id);
  assert.equal(await page.evaluate(() => classroomUI.state.assessments[1].curriculumSnapshot.code), '6체02-06');

  await page.locator('#teacherLockButton').click();
  panel = await openEvaluations(page);
  const rows = panel.locator('#assessmentRows > details');
  assert.equal(await rows.filter({ hasText: '연결 전 평가' }).locator('section[id^="saved-curriculum-"]').count(), 0);
  const row = rows.filter({ has: page.locator('#saved-curriculum-' + id) });
  await row.locator(':scope > summary').click();
  const saved = row.locator('#saved-curriculum-' + id);
  assert.match(await saved.textContent(), /6체02-06.*2026학년도 초등학교 5학년/);
  assert.match(await saved.textContent(), /교육부 고시 제2022-33호.*별책 11/);

  await row.getByRole('button', { name: '교사 승인', exact: true }).click();
  await page.waitForFunction(id => classroomUI.state.assessments.find(item => item.id === id)?.status === 'approved', id);
  const approvedRow = panel.locator('#assessmentRows > details').filter({ has: page.locator('#saved-curriculum-' + id) });
  await approvedRow.locator(':scope > summary').click();
  await page.selectOption('#edit-curriculum-' + id + '-code', 'remove-reference');
  await approvedRow.getByRole('button', { name: '평가 수정 저장', exact: true }).click();
  await page.waitForFunction(id => classroomUI.state.assessments.find(item => item.id === id)?.status === 'draft', id);
  assert.deepEqual(await page.evaluate(id => {
    const record = classroomUI.state.assessments.find(item => item.id === id);
    return { current: record.curriculumSnapshot, previous: record.history.at(-1).before.curriculumSnapshot.code };
  }, id), { current: undefined, previous: '6체02-06' });
  const revised = panel.locator('#assessmentRows > details').filter({ hasText: '변경 전 성취기준 보기' });
  await revised.locator(':scope > summary').click();
  await revised.getByText('변경 전 성취기준 보기', { exact: true }).click();
  assert.match(await revised.getByRole('link', { name: '고시 원문 보기' }).getAttribute('href'), /boardSeq=93458/);
  assert.deepEqual(errors, []);
  console.log('PASS offline curriculum grade gating, teacher selection, saved citation, legacy record, history, and re-approval');
}).catch(error => { console.error(error); process.exitCode = 1; });
