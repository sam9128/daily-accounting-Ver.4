import { chromium } from 'playwright-core';

const executablePath = process.env.CHROME_BIN;
if (!executablePath) throw new Error('Set CHROME_BIN to a Chromium/Chrome executable before running test:e2e.');
const browser = await chromium.launch({ headless: true, executablePath });
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
const consoleErrors = [];
page.on('console', message => {
  if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) consoleErrors.push(message.text());
});
page.on('pageerror', error => consoleErrors.push(error.message));
page.on('response', response => {
  if (response.status() >= 400) consoleErrors.push(`${response.status()} ${response.url()}`);
});

await page.goto(process.env.APP_URL || 'http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
await page.getByRole('heading', { name: '資料與同步' }).waitFor();
await page.getByText('這台裝置尚無帳目', { exact: false }).waitFor();
const safeBackup = {
  schema: 5,
  accounts: ['零用金', '郵局存款', '永豐存款', '台新存款', 'Line Bank', '口袋帳戶', '永豐金證券', '小姐姐VISA'],
  transactions: [{ id: 'browser-test-1', sequence: 1, date: '2026-07-21', account: '零用金', category: '存', reason: '自動測試資料', expense: 0, income: 500, updatedAt: '2026-07-21T00:00:00.000Z', revision: 1, deleted: false }],
};
await page.locator('input[type="file"]').setInputFiles({ name: 'safe-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(safeBackup)) });
await page.getByText('1 筆交易', { exact: true }).waitFor();
await page.getByRole('heading', { name: '財務總覽' }).waitFor();
await page.getByText(/500/, { exact: false }).first().waitFor();
await page.screenshot({ path: process.env.DESKTOP_SHOT || '.test-output/desktop.png', fullPage: true });

await page.setViewportSize({ width: 423, height: 822 });
await page.locator('input[name="date"]').waitFor();
await page.getByRole('button', { name: /總計餘額/ }).waitFor();
await page.getByRole('button', { name: /零用金/ }).first().waitFor();
await page.screenshot({ path: process.env.MOBILE_SHOT || '.test-output/mobile.png', fullPage: true });
for (const viewport of [{ width: 390, height: 844 }, { width: 360, height: 800 }]) {
  await page.setViewportSize(viewport);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) throw new Error(`Horizontal overflow at ${viewport.width}x${viewport.height}: ${overflow}px`);
}
if (process.env.MOBILE_NARROW_SHOT) await page.screenshot({ path: process.env.MOBILE_NARROW_SHOT, fullPage: true });

await page.setViewportSize({ width: 1366, height: 900 });
await page.locator('input[name="expense"]').fill('240');
await page.getByRole('button', { name: /確認送出/ }).click();
await page.getByText('已儲存到這台裝置。').waitFor();
await page.reload({ waitUntil: 'networkidle' });
await page.getByText('2 筆交易', { exact: true }).waitFor();
await page.getByText('240', { exact: false }).first().waitFor();
await page.getByRole('button', { name: /總計餘額/ }).click();
await page.getByRole('heading', { name: '統計與流水' }).waitFor();
await page.getByRole('button', { name: '流水', exact: true }).click();
await page.getByRole('button', { name: /未註記/ }).first().click();
await page.getByRole('heading', { name: '修改流水' }).waitFor();
await page.getByRole('button', { name: '關閉' }).click();
await page.getByRole('button', { name: '資料與同步' }).first().click();
await page.getByRole('heading', { name: '資料與同步' }).waitFor();
await page.getByRole('button', { name: '下載資料庫安全備份' }).waitFor();
await page.getByRole('button', { name: '關閉' }).click();
if (consoleErrors.length) throw new Error(`Browser console errors:\n${consoleErrors.join('\n')}`);
await browser.close();
