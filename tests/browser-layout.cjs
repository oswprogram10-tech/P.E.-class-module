const { withBrowser } = require('./browser-helper.cjs');
const assert = require('node:assert/strict');

const TOUCH_SELECTORS = [
  '#teacherButton',
  '#cameraButton',
  '#openClipButton',
  '#installButton',
  '#teacherDialog .close-button',
  '#clipDialog .close-button',
  '.teacher-tab',
  '.text-button',
  '#teacherLockButton',
  '#storagePersistButton',
  '#libraryRetryButton',
  '#cancelSaveButton',
  '#confirmDeleteButton',
  '#cancelDeleteButton',
  '#studentName',
  '#studentNumber',
  '#newPin',
  '#confirmPin',
  '#unlockPin',
  '.range-control input[type=range]',
  '.delay-setting input[type=range]',
  '#createPinButton',
  '#unlockButton',
  '#saveClipButton',
];

async function visibleTouchFailures(page) {
  return page.evaluate((selectors) => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const failures = [];
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        if (!visible(element)) continue;
        const rect = element.getBoundingClientRect();
        if (rect.width < 47.5 || rect.height < 47.5) {
          failures.push({
            selector,
            id: element.id || '',
            text: (element.textContent || '').trim().slice(0, 24),
            width: Math.round(rect.width * 10) / 10,
            height: Math.round(rect.height * 10) / 10,
          });
        }
      }
    }
    return failures;
  }, TOUCH_SELECTORS);
}

async function layoutMetrics(page) {
  return page.evaluate(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const value = element.getBoundingClientRect();
      return { left: value.left, right: value.right, top: value.top, bottom: value.bottom };
    };
    const video = rect('.video-card');
    const action = rect('.action-card');
    const intersects = (a, b) => a && b && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
    const shell = rect('.app-shell');
    const notes = rect('.bottom-notes');

    const parseColor = (value) => {
      const match = value.match(/rgba?\(([^)]+)\)/);
      if (!match) return null;
      const parts = match[1].split(',').map((part) => Number(part.trim()));
      return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
    };
    const luminance = ({ r, g, b }) => {
      const channel = (value) => {
        const v = value / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    const contrast = (foreground, background) => {
      const a = luminance(foreground);
      const b = luminance(background);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    const effectiveBackground = (element) => {
      let current = element;
      while (current) {
        const color = parseColor(getComputedStyle(current).backgroundColor);
        if (color && color.a >= 0.99) return color;
        current = current.parentElement;
      }
      return { r: 244, g: 244, b: 239, a: 1 };
    };

    const textChecks = ['.intro', '.action-copy', '.prep-item small', '.prep-status small', '.note-item small', '.install-hint', '.video-footer', '.view-title small', '.timeline-edge', '.app-footer', '.teacher-copy'];
    const textFailures = [];
    for (const selector of textChecks) {
      for (const element of document.querySelectorAll(selector)) {
        const style = getComputedStyle(element);
        const value = element.getBoundingClientRect();
        if (style.display === 'none' || style.visibility === 'hidden' || value.width === 0 || value.height === 0) continue;
        const size = Number.parseFloat(style.fontSize);
        const foreground = parseColor(style.color);
        if (!foreground) continue;
        const ratio = contrast(foreground, effectiveBackground(element));
        if (size < 11.5 || ratio < 4.5) {
          textFailures.push({
            selector,
            fontSize: size,
            contrast: Math.round(ratio * 100) / 100,
            color: style.color,
          });
        }
      }
    }

    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      shell: shell && { left: shell.left, right: shell.right },
      notes: notes && { left: notes.left, right: notes.right },
      videoActionOverlap: intersects(video, action),
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      textFailures,
    };
  });
}

async function checkViewport(page, viewport, label) {
  await page.setViewportSize(viewport);
  await page.waitForTimeout(180);
  const metrics = await layoutMetrics(page);
  assert.equal(metrics.horizontalOverflow, false, `${label}: horizontal scroll ${metrics.scrollWidth} > ${metrics.innerWidth}`);
  assert.equal(metrics.videoActionOverlap, false, `${label}: video and action cards overlap`);
  for (const key of ['shell', 'notes']) {
    if (!metrics[key]) continue;
    assert.ok(metrics[key].left >= -1, `${label}: ${key} clipped on the left`);
    assert.ok(metrics[key].right <= metrics.innerWidth + 1, `${label}: ${key} clipped on the right`);
  }
  assert.deepEqual(metrics.textFailures, [], `${label}: small or low-contrast text`);
  const touchFailures = await visibleTouchFailures(page);
  assert.deepEqual(touchFailures, [], `${label}: touch targets under 48 CSS px`);
  console.log(JSON.stringify({ viewport: label, ...metrics, touchTargets: '48px+', passed: true }));
}

withBrowser(async (page, errors) => {
  // Teacher PIN entry: close, inputs, submit and tabs must all be touchable.
  await page.locator('#teacherButton').click();
  await checkViewport(page, { width: 1280, height: 800 }, '1280x800 (teacher setup)');
  await page.locator('#newPin').focus();
  await page.evaluate(() => keepFocusedFieldVisible());
  const shortViewport = await page.evaluate(() => {
    const dialog = document.querySelector('dialog[open]').getBoundingClientRect();
    const input = document.activeElement.getBoundingClientRect();
    return { dialogTop: dialog.top, dialogBottom: dialog.bottom, inputTop: input.top, inputBottom: input.bottom, height: innerHeight };
  });
  assert.ok(shortViewport.dialogTop >= 0 && shortViewport.dialogBottom <= shortViewport.height + 1, 'teacher dialog must fit the viewport');
  assert.ok(shortViewport.inputTop >= 0 && shortViewport.inputBottom <= shortViewport.height + 1, 'focused PIN input must remain visible');
  await page.locator('#newPin').fill('123456');
  await page.locator('#confirmPin').fill('123456');
  await page.locator('#createPinButton').click();
  await page.locator('#teacherContentPanel').waitFor({ state: 'visible', timeout: 20000 });
  await page.locator('#teacherDialog .close-button').click();

  // Portrait tablet layout.
  await checkViewport(page, { width: 800, height: 1280 }, '800x1280');

  // Short landscape viewport: dialog must scroll instead of being cut off above the viewport.
  await page.setViewportSize({ width: 800, height: 480 });
  await page.locator('#teacherButton').click();
  await page.locator('#unlockPin').focus();
  await page.evaluate(() => keepFocusedFieldVisible());
  const compactDialog = await page.evaluate(() => {
    const dialog = document.querySelector('dialog[open]').getBoundingClientRect();
    const input = document.activeElement.getBoundingClientRect();
    return { dialogTop: dialog.top, dialogBottom: dialog.bottom, inputTop: input.top, inputBottom: input.bottom, height: innerHeight };
  });
  assert.ok(compactDialog.dialogTop >= 0 && compactDialog.dialogBottom <= compactDialog.height + 1, 'short viewport dialog must fit');
  assert.ok(compactDialog.inputTop >= 0 && compactDialog.inputBottom <= compactDialog.height + 1, 'focused field must stay visible in a short viewport');
  await page.locator('#teacherDialog .close-button').click();
  await page.waitForFunction(() => $('teacherDialog').style.maxHeight === '', {}, { timeout: 5000 });

  // Student save dialog: ranges and fields are 48px+ and the focused field stays reachable.
  await page.setViewportSize({ width: 800, height: 1280 });
  await page.evaluate(() => setDelay(1));
  await page.locator('#cameraButton').click();
  await page.waitForFunction(() => frameBuffer.duration >= 5500, {}, { timeout: 20000 });
  await page.locator('#openClipButton').click();
  const clipFailures = await visibleTouchFailures(page);
  assert.deepEqual(clipFailures, [], 'clip dialog touch targets under 48 CSS px');
  await page.setViewportSize({ width: 800, height: 480 });
  await page.locator('#studentNumber').focus();
  await page.evaluate(() => keepFocusedFieldVisible());
  const clipCompact = await page.evaluate(() => {
    const dialog = document.querySelector('dialog[open]').getBoundingClientRect();
    const input = document.activeElement.getBoundingClientRect();
    return { dialogTop: dialog.top, dialogBottom: dialog.bottom, inputTop: input.top, inputBottom: input.bottom, height: innerHeight };
  });
  assert.ok(clipCompact.dialogTop >= 0 && clipCompact.dialogBottom <= clipCompact.height + 1, 'clip dialog must fit the short viewport');
  assert.ok(clipCompact.inputTop >= 0 && clipCompact.inputBottom <= clipCompact.height + 1, 'focused student field must stay visible');
  await page.locator('#clipDialog .close-button').click();
  await page.locator('#cameraButton').click();
  assert.deepEqual(errors, []);
  console.log('Tablet layout, touch targets, text contrast and focused-field visibility checks passed');
}, { setupTeacher: false, viewport: { width: 1280, height: 800 } }).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
