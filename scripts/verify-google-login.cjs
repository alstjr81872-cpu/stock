// Google provider contract check against the local Auth Emulator only.
// TLS verification stays enabled; Chromium must be able to open its NSS trust DB.
const assert = require('node:assert/strict');
const { chromium } = require('@playwright/test');

(async () => {
  const base = 'http://127.0.0.1:3000';
  const health = await (await fetch(base + '/api/health')).json();
  assert.equal(health.mode, 'emulator', 'This check is for local emulators only');
  assert.equal(health.ready, true);
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
  });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(20000);
    const certificateErrors = [];
    page.on('requestfailed', request => {
      if (request.failure()?.errorText?.includes('ERR_CERT')) certificateErrors.push(new URL(request.url()).hostname);
    });
    await page.goto(base);
    const popupPending = page.waitForEvent('popup', { timeout: 20000 });
    await page.getByRole('button', { name: 'Google 계정으로 시작하기' }).click();
    const popup = await popupPending;
    await popup.waitForLoadState('domcontentloaded');
    assert.equal(new URL(popup.url()).hostname, '127.0.0.1');
    assert.equal(new URL(popup.url()).port, '9099');
    const email = 'popup-check@novelforge.test';
    const mePending = page.waitForResponse(response => new URL(response.url()).pathname === '/api/me' && response.status() === 200);
    if (await popup.getByText(email, { exact: false }).count()) {
      await popup.getByText(email, { exact: false }).first().click();
    } else {
      await popup.getByText('Add new account', { exact: false }).click();
      await popup.locator('#email-input').fill(email);
      await popup.locator('#display-name-input').fill('Google 팝업 검증');
      await popup.getByRole('button', { name: 'Sign in with Google.com', exact: true }).click();
    }
    const me = await (await mePending).json();
    assert.equal(me.mode, 'emulator');
    assert.ok(me.uid);
    await page.getByRole('heading', { name: '이야기를 이어갈 시간이에요.' }).waitFor();
    await page.locator('.user-block').filter({ hasText: email }).waitFor();
    assert.equal(certificateErrors.length, 0, 'Certificate verification must succeed');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '로그아웃', exact: true }).click();
    await page.getByRole('button', { name: 'Google 계정으로 시작하기' }).waitFor();
    console.log('PASS: Google provider popup → Auth Emulator token → authenticated API → dashboard → logout; TLS verification enabled.');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
