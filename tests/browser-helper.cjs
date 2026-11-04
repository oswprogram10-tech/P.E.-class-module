const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

async function withBrowser(run, { setupTeacher = true, beforeApp = null, viewport = { width: 1280, height: 900 } } = {}) {
  const root = path.resolve(__dirname, '..');
  const mime = { '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    try {
      res.setHeader('Content-Type', mime[path.extname(file)] || 'text/html');
      res.end(fs.readFileSync(file));
    } catch { res.writeHead(404).end(); }
  });
  let browser;
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
      args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    });
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    if (beforeApp) await beforeApp(page, baseUrl);
    await page.goto(baseUrl);
    await page.waitForFunction(() => appReady);
    if (setupTeacher) {
    await page.locator('#teacherButton').click();
    await page.locator('#newPin').fill('123456');
    await page.locator('#confirmPin').fill('123456');
    await page.locator('#createPinButton').click();
    await page.locator('#teacherContentPanel').waitFor({ state: 'visible', timeout: 60000 });
    await page.locator('#teacherDialog .close-button').click();
    }
    await run(page, errors, baseUrl);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
module.exports = { withBrowser };
