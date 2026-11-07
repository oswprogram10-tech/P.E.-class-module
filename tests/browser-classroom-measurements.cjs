const { withBrowser } = require('./browser-helper.cjs');
const assert = require('node:assert/strict');

withBrowser(async (page, errors) => {
  assert.deepEqual(await page.evaluate(() => ({
    status: window.PapsCriteria?.getAvailability('grip-strength').status,
    reason: window.PapsCriteria?.getAvailability('grip-strength').reason,
  })), { status: 'available', reason: 'scope-required' }, 'the app loads official criterion ranges but still requires an explicit scope');
  await page.locator('#teacherButton').click();
  await page.locator('#unlockPin').fill('123456');
  await page.locator('#unlockButton').click();
  await page.locator('#teacherContentPanel').waitFor({ state: 'visible' });
  await page.locator('[data-panel="classroom"]').click();
  await page.locator('#newClassName').waitFor();
  await page.locator('#newClassName').fill('측정 검증 학급');
  await page.locator('#addClassButton').click();
  await page.locator('#rosterName').waitFor();
  for (let i = 0; i < 2; i++) {
    await page.locator('#rosterName').fill('동명 학생');
    await page.locator('#rosterNumber').fill('7');
    await page.locator('#addStudentButton').click();
    await page.waitForFunction(count => classroomUI.state.students.length === count, i + 1);
  }
  const students = await page.evaluate(() => classroomUI.state.students.map(student => student.id));
  assert.notEqual(students[0], students[1]);
  await page.selectOption('#measurementStudent', students[0]);
  await page.selectOption('#measurementItem', 'grip-strength');
  await page.selectOption('#measurementCriteriaGrade', 'elementary-5');
  await page.locator('#measurementValue').fill('12.3');
  await page.locator('#saveMeasurementButton').click();
  assert.equal(await page.evaluate(() => classroomUI.state.measurements.length), 0, 'a partial criteria choice cannot be saved as a graded record');
  assert.match(await page.locator('#classroomStatus').textContent(), /학년과 평가표 구분을 모두 선택/);
  await page.selectOption('#measurementCriteriaTarget', 'male');
  await page.waitForFunction(() => document.querySelector('#measurementCriteriaResult')?.textContent.includes('개별 종목 5등급'));
  await page.locator('#saveMeasurementButton').click();
  await page.waitForFunction(() => classroomUI.state.measurements.length === 1);
  assert.deepEqual(await page.evaluate(() => ({
    studentId: classroomUI.state.measurements[0].studentId, value: classroomUI.state.measurements[0].value,
    unit: classroomUI.state.measurements[0].unit, gradeGroupId: classroomUI.state.measurements[0].criteriaGradeGroupId,
    targetGroupId: classroomUI.state.measurements[0].criteriaTargetGroupId, version: classroomUI.state.measurements[0].criteriaSourceVersion,
  })), { studentId: students[0], value: 12.3, unit: 'kg', gradeGroupId: 'elementary-5', targetGroupId: 'male', version: 'MOE-354-2025-03-10-annex4' });
  assert.equal(await page.evaluate(() => classroomUI.state.outbox.length), 0, 'local measurements are not placed in the sync outbox');
  assert.equal(await page.locator('#measurementStudent').inputValue(), students[1], 'saving advances to the next student for repeated class entry');
  assert.equal(await page.locator('#measurementCriteriaGrade').inputValue(), '', 'grade choice does not carry over to the next student');
  assert.equal(await page.locator('#measurementCriteriaTarget').inputValue(), '', 'target group choice does not carry over to the next student');
  await page.selectOption('#measurementStudent', students[0]);
  assert.match(await page.locator('.classroom-measurements').textContent(), /별표 4 개별 종목 5등급/);
  await page.selectOption('#measurementStudent', students[1]);

  await page.selectOption('#measurementMissingReason', 'absent');
  await page.locator('#saveMeasurementButton').click();
  await page.waitForFunction(() => classroomUI.state.measurements.length === 2);
  const records = await page.evaluate(() => classroomUI.state.measurements.map(record => ({ studentId: record.studentId, value: record.value, missingReason: record.missingReason })));
  assert.deepEqual(records[1], { studentId: students[1], value: null, missingReason: 'absent' });

  const raw = await page.evaluate(async () => repository.classroomRead(vaultConfig.revision));
  assert.equal(Object.hasOwn(raw, 'state'), false);
  assert.equal(JSON.stringify(raw).includes(students[0]), false, 'student IDs are inside the encrypted classroom payload');
  assert.equal(JSON.stringify(raw).includes('elementary-5'), false, 'criteria grade group is inside the encrypted classroom payload');
  assert.equal(JSON.stringify(raw).includes('MOE-354-2025-03-10-annex4'), false, 'criteria source version is inside the encrypted classroom payload');
  assert.equal(JSON.stringify(raw).includes('shuttle-run'), false);
  await page.evaluate(() => { window.confirm = () => true; });
  await page.selectOption('#measurementStudent', students[1]);
  const secondId = await page.evaluate(() => classroomUI.state.measurements[1].id);
  await page.locator(`#editMeasurement-${secondId}`).click();
  assert.equal(await page.locator('#measurementSchoolYear').isDisabled(), true, 'correction keeps the original school year');
  await page.selectOption('#measurementCriteriaGrade', 'elementary-5');
  await page.selectOption('#measurementCriteriaTarget', 'female');
  await page.selectOption('#measurementMissingReason', '');
  await page.locator('#measurementValue').fill('0');
  await page.locator('#saveMeasurementButton').click();
  await page.waitForFunction(id => classroomUI.state.measurements.find(record => record.id === id)?.changeHistory?.length === 1, secondId);
  const correction = await page.evaluate(id => {
    const record = classroomUI.state.measurements.find(item => item.id === id);
    return { value: record.value, reason: record.missingReason, criteriaGradeGroupId: record.criteriaGradeGroupId, criteriaTargetGroupId: record.criteriaTargetGroupId, inputAt: record.inputAt, modifiedAt: record.modifiedAt, event: record.changeHistory[0] };
  }, secondId);
  assert.equal(correction.value, 0); assert.equal(correction.reason, null); assert.ok(correction.modifiedAt >= correction.inputAt);
  assert.equal(correction.criteriaGradeGroupId, 'elementary-5'); assert.equal(correction.criteriaTargetGroupId, 'female');
  assert.equal(correction.event.actor, 'teacher'); assert.equal(correction.event.before.value, null); assert.equal(correction.event.before.missingReason, 'absent');
  assert.equal(correction.event.after.value, 0); assert.equal(correction.event.after.missingReason, null); assert.equal(correction.event.after.criteriaTargetGroupId, 'female');
  await page.locator('.classroom-measurements details summary').click();
  assert.match(await page.locator('.classroom-measurements details').textContent(), /결측.*결시.*0 kg/s);
  await page.locator(`#deleteMeasurement-${secondId}`).click();
  await page.waitForFunction(() => classroomUI.state.measurements.length === 1);
  await page.locator('#deleteClassButton').click();
  await page.waitForFunction(() => classroomUI.state.measurements.length === 0 && classroomUI.state.students.length === 0);
  assert.deepEqual(errors, []);
  console.log('Teacher PIN manual measurement input, correction history, duplicate-student separation, missing values, encrypted persistence and deletion passed');
}).catch(error => { console.error(error); process.exitCode = 1; });
