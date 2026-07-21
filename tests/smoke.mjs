import { chromium } from 'playwright-core';

const executablePath = process.env.CHROME_BIN;
if (!executablePath) throw new Error('Set CHROME_BIN to a Chromium/Chrome executable before running test:e2e.');
const browser = await chromium.launch({ headless: true, executablePath });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const longPress = async locator => {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Cannot long-press an invisible flow row.');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
};
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
  transactions: [
    ...['食', '衣', '住', '行', '育', '樂', '醫', '用', '送'].map((category, index) => ({ id: `browser-expense-${index + 1}`, sequence: index + 1, date: '2026-07-21', account: '零用金', category, reason: `自動測試${category}`, expense: (index + 1) * 100, income: 0, updatedAt: '2026-07-21T00:00:00.000Z', revision: 1, deleted: false })),
    { id: 'browser-income-1', sequence: 10, date: '2026-07-21', account: '零用金', category: '存', reason: '自動測試收入', expense: 0, income: 5000, updatedAt: '2026-07-21T00:00:00.000Z', revision: 1, deleted: false },
  ],
};
await page.locator('input[type="file"]').setInputFiles({ name: 'safe-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(safeBackup)) });
await page.getByRole('button', { name: /總計餘額/ }).waitFor();
await page.getByText(/500/, { exact: false }).first().waitFor();
await page.locator('.accounts').getByRole('button', { name: /0050/ }).waitFor();
await page.locator('.accounts').getByRole('button', { name: /^轉/ }).waitFor();
const protrudingAccountText = await page.locator('.accounts > div > button').evaluateAll(buttons => buttons.flatMap((button, index) => {
  const card = button.getBoundingClientRect();
  const children = [...button.children].map(child => child.getBoundingClientRect());
  return children.some(child => child.left < card.left - .5 || child.right > card.right + .5 || child.top < card.top - .5 || child.bottom > card.bottom + .5) ? [index] : [];
}));
if (protrudingAccountText.length) throw new Error(`Account text protrudes outside cards: ${protrudingAccountText.join(', ')}`);
await page.getByText('分類項目', { exact: true }).last().waitFor();
await page.locator('.toast').waitFor({ state: 'detached', timeout: 5000 });
await page.screenshot({ path: process.env.DESKTOP_SHOT || '.test-output/desktop.png', fullPage: true });

await page.getByRole('button', { name: /總計餘額/ }).click();
await page.getByRole('heading', { name: '統計與流水' }).waitFor();
await page.getByRole('button', { name: '設定' }).click();
const settingsDialog = page.locator('.settings-dialog');
await settingsDialog.getByRole('heading', { name: '設定', exact: true }).waitFor();
await settingsDialog.getByRole('button', { name: '帳戶', exact: true }).click();
await settingsDialog.getByLabel('新增帳戶').fill('測試帳戶');
await settingsDialog.locator('.catalog-add').getByRole('button', { name: '新增', exact: true }).click();
let managedItem = settingsDialog.locator('.catalog-item').filter({ hasText: '測試帳戶' });
await managedItem.waitFor();
await managedItem.getByRole('button', { name: '編輯' }).click();
await managedItem.getByLabel('新的帳戶名稱').fill('測試現金');
await managedItem.locator('.catalog-editor').getByRole('button', { name: '儲存' }).click();
managedItem = settingsDialog.locator('.catalog-item').filter({ hasText: '測試現金' });
await managedItem.waitFor();
page.once('dialog', dialog => dialog.accept());
await managedItem.getByRole('button', { name: '隱藏' }).click();
await page.locator('.quick-form select[name="account"] option', { hasText: '測試現金' }).waitFor({ state: 'detached' });
await settingsDialog.locator('.hidden-catalog summary').filter({ hasText: '已隱藏的帳戶' }).click();
managedItem = settingsDialog.locator('.hidden-catalog .catalog-item').filter({ hasText: '測試現金' });
await managedItem.getByRole('button', { name: '重新開啟' }).click();
await page.locator('.quick-form select[name="account"] option', { hasText: '測試現金' }).waitFor({ state: 'attached' });

await settingsDialog.getByRole('button', { name: '分類', exact: true }).click();
await settingsDialog.getByLabel('新增分類').fill('測試投資');
await settingsDialog.getByLabel('設為投資項目').check();
await settingsDialog.locator('.catalog-add').getByRole('button', { name: '新增', exact: true }).click();
managedItem = settingsDialog.locator('.catalog-item').filter({ hasText: '測試投資' });
await managedItem.getByText('投資項目', { exact: false }).waitFor();
await settingsDialog.getByLabel('新增分類').fill('零資料分類');
await settingsDialog.locator('.catalog-add').getByRole('button', { name: '新增', exact: true }).click();
managedItem = settingsDialog.locator('.catalog-item').filter({ hasText: '零資料分類' });
page.once('dialog', dialog => dialog.accept());
await managedItem.getByRole('button', { name: '隱藏' }).click();
await settingsDialog.getByRole('button', { name: '關閉' }).click();

await page.locator('.quick-categories').getByRole('button', { name: '測試投資', exact: true }).click();
await page.locator('input[name="reason"]').fill('自訂投資測試');
await page.locator('input[name="expense"]').fill('25');
await page.getByRole('button', { name: /確認送出/ }).click();
await page.getByText('已儲存到這台裝置。').waitFor();
await page.getByRole('button', { name: /總計餘額/ }).click();
await page.getByRole('button', { name: '設定' }).click();
await settingsDialog.getByRole('button', { name: '分類', exact: true }).click();
managedItem = settingsDialog.locator('.catalog-item').filter({ hasText: '測試投資' });
await managedItem.getByText('1 筆流水', { exact: false }).waitFor();
await managedItem.getByRole('button', { name: '編輯' }).click();
await managedItem.getByLabel('新的分類名稱').fill('長期投資');
await managedItem.locator('.catalog-editor').getByRole('button', { name: '儲存' }).click();
managedItem = settingsDialog.locator('.catalog-item').filter({ hasText: '長期投資' });
page.once('dialog', dialog => dialog.accept());
await managedItem.getByRole('button', { name: '隱藏' }).click();
await settingsDialog.getByRole('button', { name: '關閉' }).click();
await page.locator('.quick-form select[name="category"] option', { hasText: '長期投資' }).waitFor({ state: 'detached' });
await page.getByRole('button', { name: /總計餘額/ }).click();
await page.locator('.investment-stats').getByRole('button', { name: /長期投資/ }).waitFor();
if (await page.locator('.stats-dialog .stat-row').filter({ hasText: '零資料分類' }).count()) throw new Error('Hidden zero-value category is visible in current-period statistics.');
await page.getByRole('button', { name: '設定' }).click();
await settingsDialog.getByRole('button', { name: '分類', exact: true }).click();
await settingsDialog.locator('.hidden-catalog summary').filter({ hasText: '已隱藏的分類' }).click();
await settingsDialog.locator('.hidden-catalog .catalog-item').filter({ hasText: '長期投資' }).getByRole('button', { name: '重新開啟' }).click();
await settingsDialog.locator('.hidden-catalog .catalog-item').filter({ hasText: '零資料分類' }).getByRole('button', { name: '重新開啟' }).click();
if (process.env.SETTINGS_SHOT) await page.screenshot({ path: process.env.SETTINGS_SHOT, fullPage: true });
await settingsDialog.getByRole('button', { name: '關閉' }).click();
await page.reload({ waitUntil: 'networkidle' });
await page.locator('.quick-form select[name="account"] option', { hasText: '測試現金' }).waitFor({ state: 'attached' });
await page.locator('.quick-form select[name="category"] option', { hasText: '長期投資' }).waitFor({ state: 'attached' });

await page.setViewportSize({ width: 900, height: 900 });
let overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
if (overflow > 1) throw new Error(`Horizontal overflow at 900x900: ${overflow}px`);

await page.setViewportSize({ width: 423, height: 822 });
await page.locator('input[name="date"]').waitFor();
await page.getByRole('button', { name: /總計餘額/ }).waitFor();
await page.getByRole('button', { name: /零用金/ }).first().waitFor();
await page.getByRole('button', { name: /總計餘額/ }).click();
await page.getByRole('button', { name: '設定' }).click();
await settingsDialog.getByRole('heading', { name: '設定', exact: true }).waitFor();
const mobileSettingsLayout = await settingsDialog.evaluate(element => ({
  width: element.getBoundingClientRect().width,
  height: element.getBoundingClientRect().height,
  overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  tabs: element.querySelectorAll('.settings-tabs button').length,
  actionOverflow: [...element.querySelectorAll('.catalog-item')].some(item => {
    const card = item.getBoundingClientRect();
    const actions = item.querySelector('.catalog-actions')?.getBoundingClientRect();
    return actions && (actions.top < card.top - 1 || actions.bottom > card.bottom + 1 || actions.right > card.right + 1);
  }),
  rowOverlap: [...element.querySelectorAll('.catalog-item')].some((item, index, items) => index < items.length - 1 && item.getBoundingClientRect().bottom > items[index + 1].getBoundingClientRect().top + 1),
}));
if (Math.abs(mobileSettingsLayout.width - 423) > 1 || Math.abs(mobileSettingsLayout.height - 822) > 1 || mobileSettingsLayout.overflow > 1 || mobileSettingsLayout.tabs !== 3 || mobileSettingsLayout.actionOverflow || mobileSettingsLayout.rowOverlap) throw new Error(`Mobile settings layout is not full-screen, categorized, and contained: ${JSON.stringify(mobileSettingsLayout)}`);
if (process.env.SETTINGS_MOBILE_SHOT) await page.screenshot({ path: process.env.SETTINGS_MOBILE_SHOT, fullPage: true });
await settingsDialog.getByRole('button', { name: '關閉' }).click();
const accountSelect = page.locator('.quick-form select[name="account"]');
await accountSelect.selectOption({ label: '小姐姐VISA' });
await page.waitForFunction(() => {
  const rail = document.querySelector('.accounts > div');
  const selected = rail?.querySelector('button.selected');
  if (!rail || !selected || !selected.textContent.includes('小姐姐VISA')) return false;
  const railBox = rail.getBoundingClientRect();
  const selectedBox = selected.getBoundingClientRect();
  return rail.scrollLeft > 0 && selectedBox.left >= railBox.left - 1 && selectedBox.right <= railBox.right + 1;
});
if (process.env.ACCOUNT_SYNC_SHOT) await page.screenshot({ path: process.env.ACCOUNT_SYNC_SHOT, fullPage: true });
await accountSelect.selectOption({ label: '零用金' });
await page.waitForFunction(() => {
  const rail = document.querySelector('.accounts > div');
  return rail?.querySelector('button.selected')?.textContent.includes('零用金') && rail.scrollLeft < 2;
});
const dateColorScheme = await page.locator('input[name="date"]').evaluate(element => getComputedStyle(element).colorScheme);
if (!dateColorScheme.includes('dark')) throw new Error(`Date picker does not use the dark color scheme: ${dateColorScheme}`);
const totalCardTop = await page.getByRole('button', { name: /總計餘額/ }).evaluate(element => element.getBoundingClientRect().top);
if (Math.abs(totalCardTop - 14) > 1) throw new Error(`Unexpected mobile content top spacing: ${totalCardTop}px`);
const totalCardAlignment = await page.getByRole('button', { name: /總計餘額/ }).evaluate(element => {
  const card = element.getBoundingClientRect();
  const title = element.querySelector(':scope > span')?.getBoundingClientRect();
  const number = element.querySelector(':scope > strong')?.getBoundingClientRect();
  const small = element.querySelector(':scope > small')?.getBoundingClientRect();
  return {
    numberOffset: number ? (number.top + number.height / 2) - (card.top + card.height / 2) : 999,
    rightOffset: small ? (small.top + small.height / 2) - (card.top + card.height / 2) : 999,
    contentAlignmentDelta: number && small ? Math.abs((number.top + number.height / 2) - (small.top + small.height / 2)) : 999,
    titleTop: title ? title.top - card.top : 999,
    titleGap: title && number ? number.top - title.bottom : -999,
  };
});
if (totalCardAlignment.numberOffset < 10 || totalCardAlignment.numberOffset > 17 || totalCardAlignment.rightOffset < 10 || totalCardAlignment.rightOffset > 17 || totalCardAlignment.contentAlignmentDelta > 2 || totalCardAlignment.titleTop < 6 || totalCardAlignment.titleTop > 16 || totalCardAlignment.titleGap < 9) throw new Error(`Total card visual balance is incorrect: ${JSON.stringify(totalCardAlignment)}`);
await page.screenshot({ path: process.env.MOBILE_SHOT || '.test-output/mobile.png', fullPage: true });
for (const viewport of [{ width: 390, height: 844 }, { width: 360, height: 800 }]) {
  await page.setViewportSize(viewport);
  overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) throw new Error(`Horizontal overflow at ${viewport.width}x${viewport.height}: ${overflow}px`);
}
if (process.env.MOBILE_NARROW_SHOT) await page.screenshot({ path: process.env.MOBILE_NARROW_SHOT, fullPage: true });

await page.setViewportSize({ width: 423, height: 822 });
await page.locator('input[name="reason"]').focus();
await page.setViewportSize({ width: 423, height: 500 });
await page.waitForFunction(() => document.documentElement.classList.contains('keyboard-open'));
const submitBox = await page.getByRole('button', { name: /確認送出/ }).boundingBox();
if (!submitBox || submitBox.y < 0 || submitBox.y + submitBox.height > 500) throw new Error(`Submit button is obscured by simulated keyboard viewport: ${JSON.stringify(submitBox)}`);
await page.getByRole('button', { name: /總計餘額/ }).evaluate(element => element.click());
await page.locator('.stats-dialog').waitFor();
const statsCoversSubmit = await page.evaluate(() => {
  const submit = document.querySelector('.quick-form .primary');
  const stats = document.querySelector('.stats-dialog');
  const box = submit?.getBoundingClientRect();
  if (!submit || !stats || !box) return false;
  const topElement = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  return Boolean(topElement && stats.contains(topElement));
});
if (!statsCoversSubmit) throw new Error('Submit button renders above the statistics page while the keyboard layout is active.');
await page.locator('.stats-dialog').getByRole('button', { name: '關閉' }).click();
await page.locator('input[name="reason"]').evaluate(element => element.blur());
await page.setViewportSize({ width: 423, height: 822 });
await page.waitForFunction(() => !document.documentElement.classList.contains('keyboard-open'));

await page.setViewportSize({ width: 1440, height: 960 });
await page.locator('input[name="expense"]').fill('240');
await page.getByRole('button', { name: /確認送出/ }).click();
await page.getByText('已儲存到這台裝置。').waitFor();
await page.reload({ waitUntil: 'networkidle' });
await page.getByText('240', { exact: false }).first().waitFor();
await page.getByRole('button', { name: /總計餘額/ }).click();
await page.getByRole('heading', { name: '統計與流水' }).waitFor();
await page.getByRole('button', { name: '上一月' }).waitFor();
await page.getByRole('button', { name: '下一月' }).waitFor();
await page.getByRole('button', { name: '年', exact: true }).click();
await page.getByRole('button', { name: '上一年' }).waitFor();
await page.getByRole('button', { name: '下一年' }).waitFor();
await page.getByRole('button', { name: '月', exact: true }).click();
await page.getByRole('heading', { name: /帳目項目/ }).waitFor();
await page.locator('.investment-stats').getByRole('button', { name: /0050/ }).waitFor();
await page.locator('.investment-stats').getByRole('button', { name: /^轉/ }).waitFor();
const statsColumns = await page.evaluate(() => {
  const expense = document.querySelector('.stat-list')?.getBoundingClientRect();
  const investments = document.querySelector('.investment-stats')?.getBoundingClientRect();
  const content = document.querySelector('.stats-content');
  return { separate: Boolean(expense && investments && investments.left > expense.right), contentOverflow: content && getComputedStyle(content).overflowY, expenseOverflow: expense && getComputedStyle(document.querySelector('.stat-list')).overflowY };
});
if (!statsColumns.separate || statsColumns.contentOverflow !== 'hidden' || statsColumns.expenseOverflow !== 'auto') throw new Error(`Wide statistics columns do not keep scrolling inside list regions: ${JSON.stringify(statsColumns)}`);
if (process.env.STATS_SHOT) await page.screenshot({ path: process.env.STATS_SHOT, fullPage: true });
const foodStats = page.locator('.stats-dialog .stat-row').filter({ hasText: '食' }).first();
await foodStats.click();
await page.locator('.stats-dialog .category-details').getByText('自動測試食', { exact: true }).waitFor();
await foodStats.click();
await page.locator('.stats-dialog .category-details').waitFor({ state: 'detached' });
await page.getByRole('button', { name: '流水', exact: true }).click();
await page.locator('.desktop-flow-head').getByText('帳戶餘額', { exact: true }).waitFor();
await page.locator('.desktop-flow-head').getByText('總額', { exact: true }).waitFor();
const flowScrolling = await page.evaluate(() => ({
  page: getComputedStyle(document.querySelector('.logs')).overflowY,
  list: getComputedStyle(document.querySelector('.desktop-flow-ledger')).overflowY,
}));
if (flowScrolling.page !== 'hidden' || flowScrolling.list !== 'auto') throw new Error(`Flow scrolling is not isolated to the ledger list: ${JSON.stringify(flowScrolling)}`);
if (process.env.FLOW_SHOT) await page.screenshot({ path: process.env.FLOW_SHOT, fullPage: true });
await page.getByRole('searchbox', { name: '查詢流水' }).fill('未註記');
const editableFlow = page.locator('.stats-dialog').getByRole('button', { name: /未註記.*長按修改/ }).first();
await editableFlow.click();
if (await page.getByRole('heading', { name: '修改流水' }).count()) throw new Error('A normal click unexpectedly opened flow editing.');
await longPress(editableFlow);
await page.getByRole('heading', { name: '修改流水' }).waitFor();
await page.getByRole('heading', { name: '統計與流水' }).waitFor();
await page.locator('.edit-dialog').getByRole('button', { name: '關閉' }).click();
await page.getByRole('heading', { name: '統計與流水' }).waitFor();
await longPress(editableFlow);
await page.getByRole('heading', { name: '修改流水' }).waitFor();
const editActionStyle = await page.locator('.edit-actions').evaluate(element => {
  const danger = element.querySelector('.danger');
  const save = element.querySelector('.primary');
  const dangerStyle = getComputedStyle(danger);
  return {
    heightDifference: Math.abs(danger.getBoundingClientRect().height - save.getBoundingClientRect().height),
    borderStyle: dangerStyle.borderStyle,
    borderRadius: parseFloat(dangerStyle.borderRadius),
    background: dangerStyle.backgroundColor,
    fontWeight: Number(dangerStyle.fontWeight),
  };
});
if (editActionStyle.heightDifference > 1 || editActionStyle.borderStyle !== 'solid' || editActionStyle.borderRadius < 14 || editActionStyle.background === 'rgba(0, 0, 0, 0)' || editActionStyle.fontWeight < 700) throw new Error(`Delete button does not match the edit dialog style: ${JSON.stringify(editActionStyle)}`);
if (process.env.EDIT_SHOT) await page.screenshot({ path: process.env.EDIT_SHOT, fullPage: true });
page.once('dialog', dialog => dialog.accept());
await page.getByRole('button', { name: '刪除這筆流水' }).click();
await page.getByRole('heading', { name: '修改流水' }).waitFor({ state: 'detached' });
await page.getByRole('heading', { name: '統計與流水' }).waitFor();
await page.getByText('流水已刪除', { exact: false }).waitFor();
await page.getByRole('button', { name: '設定' }).click();
await page.locator('.settings-dialog').getByRole('button', { name: '資料', exact: true }).click();
await page.getByRole('heading', { name: '資料與同步' }).waitFor();
await page.getByRole('button', { name: '下載安全備份' }).waitFor();
await page.getByRole('button', { name: '關閉' }).click();
if (consoleErrors.length) throw new Error(`Browser console errors:\n${consoleErrors.join('\n')}`);
await browser.close();
