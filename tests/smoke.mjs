import { chromium } from 'playwright-core';

const executablePath = process.env.CHROME_BIN;
if (!executablePath) throw new Error('Set CHROME_BIN to a Chromium/Chrome executable before running test:e2e.');
const browser = await chromium.launch({ headless: true, executablePath });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
let driveUploads = 0;
const waitForNode = async (predicate, message, timeout = 5000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await page.waitForTimeout(50);
  }
  throw new Error(message);
};
await page.addInitScript(() => {
  window.__driveTokenRequests = [];
  window.google = { accounts: { oauth2: { initTokenClient: config => ({
    requestAccessToken: options => {
      window.__driveTokenRequests.push(options?.prompt ?? '(default)');
      queueMicrotask(() => config.callback({ access_token: 'browser-test-token', expires_in: 3600 }));
    },
  }) } } };
});
await page.route('https://www.googleapis.com/**', async route => {
  const request = route.request();
  if (request.method() === 'GET' && request.url().includes('/drive/v3/files?')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ files: [] }) });
  if (request.url().includes('/upload/drive/v3/files')) {
    driveUploads += 1;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'browser-backup' }) });
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
});
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
const desktopHomePalette = await page.evaluate(() => {
  const style = selector => getComputedStyle(document.querySelector(selector));
  const daily = document.querySelector('.total-card .daily').getBoundingClientRect();
  const dailyValue = document.querySelector('.total-card .daily > span').getBoundingClientRect();
  const monthlyValue = document.querySelector('.total-card .monthly > span').getBoundingClientRect();
  return {
    totalBackground: style('.total-card').backgroundColor,
    totalBorder: style('.total-card').borderColor,
    accountBackground: style('.accounts > div > button').backgroundColor,
    formBackground: style('.quick-form').backgroundColor,
    formBorder: style('.quick-form').borderColor,
    fieldBackground: style('.quick-form input').backgroundColor,
    fieldBorder: style('.quick-form input').borderColor,
    expenseLabel: style('.quick-form .expense').color,
    incomeLabel: style('.quick-form .income').color,
    dailyColor: style('.total-card .daily').color,
    monthlyColor: style('.total-card .monthly').color,
    dailyDisplay: style('.total-card .daily').display,
    valueAlignment: Math.abs(dailyValue.right - monthlyValue.right),
    rowWidth: daily.width,
  };
});
if (desktopHomePalette.dailyDisplay !== 'grid' || desktopHomePalette.valueAlignment > 1 || desktopHomePalette.rowWidth < 100 || desktopHomePalette.dailyColor !== 'rgb(255, 59, 92)' || desktopHomePalette.monthlyColor !== 'rgb(19, 214, 160)') throw new Error(`Desktop total-card rows do not match the mobile format: ${JSON.stringify(desktopHomePalette)}`);
await page.getByText('分類項目', { exact: true }).last().waitFor();
await page.locator('.toast').waitFor({ state: 'detached', timeout: 5000 });
await page.screenshot({ path: process.env.DESKTOP_SHOT || '.test-output/desktop.png', fullPage: true });

await page.getByRole('button', { name: /總計餘額/ }).click();
await page.getByRole('heading', { name: '統計與流水' }).waitFor();
await page.getByRole('button', { name: '設定' }).click();
const settingsDialog = page.locator('.settings-dialog');
await settingsDialog.getByRole('heading', { name: '設定', exact: true }).waitFor();
await page.getByRole('heading', { name: '統計與流水' }).waitFor();
const settingsLayer = await settingsDialog.evaluate(element => {
  const box = element.getBoundingClientRect();
  const top = document.elementFromPoint(box.left + box.width / 2, box.top + 8);
  return { statsStillMounted: Boolean(document.querySelector('.stats-dialog')), settingsIsTopmost: Boolean(top && element.contains(top)) };
});
if (!settingsLayer.statsStillMounted || !settingsLayer.settingsIsTopmost) throw new Error(`Settings did not stay above the originating statistics page: ${JSON.stringify(settingsLayer)}`);
await settingsDialog.getByRole('button', { name: '帳戶', exact: true }).click();
await settingsDialog.getByLabel('新增帳戶').fill('測試帳戶');
await settingsDialog.locator('.catalog-add').getByRole('button', { name: '新增', exact: true }).click();
let managedItem = settingsDialog.locator('.catalog-item').filter({ hasText: '測試帳戶' });
await managedItem.waitFor();
await managedItem.getByRole('button', { name: '編輯' }).click();
let catalogEditor = settingsDialog.locator('.catalog-edit-layer');
await catalogEditor.getByLabel('新的帳戶名稱').fill('測試現金');
const desktopEditorLayer = await catalogEditor.evaluate(element => {
  const layer = element.getBoundingClientRect();
  const settings = element.closest('.settings-dialog').getBoundingClientRect();
  const panel = element.querySelector('.catalog-edit-panel').getBoundingClientRect();
  const top = document.elementFromPoint(panel.left + panel.width / 2, panel.top + 10);
  return { coversSettings: Math.abs(layer.left - settings.left) <= 2 && Math.abs(layer.top - settings.top) <= 2 && Math.abs(layer.right - settings.right) <= 2 && Math.abs(layer.bottom - settings.bottom) <= 2, panelContained: panel.left >= layer.left && panel.right <= layer.right && panel.top >= layer.top && panel.bottom <= layer.bottom, panelIsTopmost: element.contains(top) };
});
if (!desktopEditorLayer.coversSettings || !desktopEditorLayer.panelContained || !desktopEditorLayer.panelIsTopmost) throw new Error(`Catalog editor is not an isolated top layer: ${JSON.stringify(desktopEditorLayer)}`);
await catalogEditor.getByRole('button', { name: '儲存變更' }).click();
await catalogEditor.waitFor({ state: 'detached' });
managedItem = settingsDialog.locator('.catalog-item').filter({ hasText: '測試現金' });
await managedItem.waitFor();
page.once('dialog', dialog => dialog.accept());
await managedItem.getByRole('button', { name: '隱藏' }).click();
await page.locator('.quick-form select[name="account"] option', { hasText: '測試現金' }).waitFor({ state: 'detached' });
await settingsDialog.locator('.hidden-catalog summary').filter({ hasText: '已隱藏的帳戶' }).click();
managedItem = settingsDialog.locator('.hidden-catalog .catalog-item').filter({ hasText: '測試現金' });
await managedItem.getByRole('button', { name: '重新開啟' }).click();
await page.locator('.quick-form select[name="account"] option', { hasText: '測試現金' }).waitFor({ state: 'attached' });
await settingsDialog.getByLabel('新增帳戶').fill('待刪帳戶');
await settingsDialog.locator('.catalog-add').getByRole('button', { name: '新增', exact: true }).click();
managedItem = settingsDialog.locator('.catalog-item').filter({ hasText: '待刪帳戶' });
page.once('dialog', dialog => dialog.accept());
await managedItem.getByRole('button', { name: '隱藏' }).click();
await settingsDialog.locator('.hidden-catalog summary').filter({ hasText: '已隱藏的帳戶' }).click();
managedItem = settingsDialog.locator('.hidden-catalog .catalog-item').filter({ hasText: '待刪帳戶' });
await managedItem.getByRole('button', { name: '永久刪除' }).waitFor();
page.once('dialog', dialog => dialog.accept());
await managedItem.getByRole('button', { name: '永久刪除' }).click();
await managedItem.waitFor({ state: 'detached' });

await settingsDialog.getByRole('button', { name: '分類', exact: true }).click();
const clothingCategory = settingsDialog.locator('.catalog-item').filter({ hasText: /^衣/ });
await longPress(clothingCategory);
await clothingCategory.getByRole('button', { name: '上移衣' }).waitFor();
await clothingCategory.getByRole('button', { name: '上移衣' }).click();
await settingsDialog.locator('[aria-label="使用中的分類"]').locator('.catalog-item').first().getByText('衣', { exact: true }).waitFor();
if (process.env.ORDER_SETTINGS_SHOT) await page.screenshot({ path: process.env.ORDER_SETTINGS_SHOT, fullPage: true });
await clothingCategory.getByRole('button', { name: '完成' }).click();
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
await settingsDialog.getByRole('button', { name: '資料', exact: true }).click();
await settingsDialog.getByRole('button', { name: '登入並同步' }).click();
await settingsDialog.waitFor({ state: 'detached' });
await page.getByRole('heading', { name: '統計與流水' }).waitFor();
await page.locator('.stats-dialog').getByRole('button', { name: '關閉' }).click();
await waitForNode(() => driveUploads === 1, 'Initial Drive sync did not upload a backup.');
const initialTokenPrompts = await page.evaluate(() => window.__driveTokenRequests);
if (initialTokenPrompts.length !== 1 || initialTokenPrompts[0] !== 'select_account') throw new Error(`Manual Drive connection did not use one account-selection request: ${JSON.stringify(initialTokenPrompts)}`);

await page.locator('.quick-categories').getByRole('button', { name: '測試投資', exact: true }).click();
await page.locator('input[name="reason"]').fill('自訂投資測試');
await page.locator('input[name="expense"]').fill('25');
await page.getByRole('button', { name: /確認送出/ }).click();
await page.getByText(/已儲存到這台裝置/).waitFor();
await waitForNode(() => driveUploads === 2, 'Submitting a transaction did not trigger automatic Drive sync.');
const reusedTokenPrompts = await page.evaluate(() => window.__driveTokenRequests);
if (reusedTokenPrompts.length !== 1) throw new Error(`A fresh Drive token was not reused for automatic sync: ${JSON.stringify(reusedTokenPrompts)}`);
const uploadsBeforeOnlineRetry = driveUploads;
await page.evaluate(() => window.dispatchEvent(new Event('online')));
await waitForNode(() => driveUploads > uploadsBeforeOnlineRetry, 'Returning online did not trigger a background Drive sync with the fresh token.');
const backgroundTokenPrompts = await page.evaluate(() => window.__driveTokenRequests);
if (backgroundTokenPrompts.length !== 1) throw new Error(`Background sync did not reuse the in-memory Drive token: ${JSON.stringify(backgroundTokenPrompts)}`);
await page.getByRole('button', { name: /總計餘額/ }).click();
const statsDialog = page.locator('.stats-dialog');
await statsDialog.getByRole('heading', { name: '統計與流水' }).waitFor();
await statsDialog.getByRole('button', { name: '設定' }).click();
await settingsDialog.getByRole('button', { name: '分類', exact: true }).click();
managedItem = settingsDialog.locator('.catalog-item').filter({ hasText: '測試投資' });
await managedItem.getByText('1 筆流水', { exact: false }).waitFor();
await managedItem.getByRole('button', { name: '編輯' }).click();
catalogEditor = settingsDialog.locator('.catalog-edit-layer');
await catalogEditor.getByLabel('新的分類名稱').fill('長期投資');
await catalogEditor.getByRole('button', { name: '儲存變更' }).click();
managedItem = settingsDialog.locator('.catalog-item').filter({ hasText: '長期投資' });
page.once('dialog', dialog => dialog.accept());
await managedItem.getByRole('button', { name: '隱藏' }).click();
await settingsDialog.getByRole('button', { name: '關閉' }).click();
await page.getByRole('heading', { name: '統計與流水' }).waitFor();
await page.locator('.quick-form select[name="category"] option', { hasText: '長期投資' }).waitFor({ state: 'detached' });
await page.locator('.investment-stats').getByRole('button', { name: /長期投資/ }).waitFor();
if (await page.locator('.stats-dialog .stat-row').filter({ hasText: '零資料分類' }).count()) throw new Error('Hidden zero-value category is visible in current-period statistics.');
await page.getByRole('button', { name: '設定' }).click();
await settingsDialog.getByRole('button', { name: '分類', exact: true }).click();
await settingsDialog.locator('.hidden-catalog summary').filter({ hasText: '已隱藏的分類' }).click();
const usedHiddenCategory = settingsDialog.locator('.hidden-catalog .catalog-item').filter({ hasText: '長期投資' });
if (await usedHiddenCategory.getByRole('button', { name: '永久刪除' }).count()) throw new Error('A hidden category referenced by transactions can be permanently deleted.');
await usedHiddenCategory.getByRole('button', { name: '重新開啟' }).click();
const unusedHiddenCategory = settingsDialog.locator('.hidden-catalog .catalog-item').filter({ hasText: '零資料分類' });
await unusedHiddenCategory.getByRole('button', { name: '永久刪除' }).waitFor();
page.once('dialog', dialog => dialog.accept());
await unusedHiddenCategory.getByRole('button', { name: '永久刪除' }).click();
await unusedHiddenCategory.waitFor({ state: 'detached' });
if (process.env.SETTINGS_SHOT) await page.screenshot({ path: process.env.SETTINGS_SHOT, fullPage: true });
await settingsDialog.getByRole('button', { name: '關閉' }).click();
await page.reload({ waitUntil: 'networkidle' });
await page.locator('.quick-form select[name="account"] option', { hasText: '測試現金' }).waitFor({ state: 'attached' });
await page.locator('.quick-form select[name="category"] option', { hasText: '長期投資' }).waitFor({ state: 'attached' });
const loadTokenPrompts = await page.evaluate(() => window.__driveTokenRequests);
if (loadTokenPrompts.length) throw new Error(`Page-load background sync unexpectedly opened Google authorization: ${JSON.stringify(loadTokenPrompts)}`);
await page.getByRole('button', { name: /總計餘額/ }).click();
await page.getByRole('button', { name: '設定' }).click();
await settingsDialog.getByRole('button', { name: '帳戶', exact: true }).click();
if (await settingsDialog.getByText('待刪帳戶', { exact: true }).count()) throw new Error('Permanently deleted account returned after reload.');
await settingsDialog.getByRole('button', { name: '分類', exact: true }).click();
await settingsDialog.locator('[aria-label="使用中的分類"]').locator('.catalog-item').first().getByText('衣', { exact: true }).waitFor();
if (await settingsDialog.getByText('零資料分類', { exact: true }).count()) throw new Error('Permanently deleted category returned after reload.');
await settingsDialog.getByRole('button', { name: '資料', exact: true }).click();
await settingsDialog.getByText('等待下次送出或手動同步以續權', { exact: true }).waitFor();
await settingsDialog.getByRole('button', { name: '關閉' }).click();
await statsDialog.getByRole('heading', { name: '統計與流水' }).waitFor();
await statsDialog.getByRole('button', { name: '關閉' }).click();

await page.setViewportSize({ width: 900, height: 900 });
let overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
if (overflow > 1) throw new Error(`Horizontal overflow at 900x900: ${overflow}px`);

await page.setViewportSize({ width: 423, height: 822 });
await page.locator('input[name="date"]').waitFor();
await page.getByRole('button', { name: /總計餘額/ }).waitFor();
await page.getByRole('button', { name: /零用金/ }).first().waitFor();
await page.mouse.move(422, 821);
const mobileHomePalette = await page.evaluate(() => {
  const style = selector => getComputedStyle(document.querySelector(selector));
  return {
    totalBackground: style('.total-card').backgroundColor,
    totalBorder: style('.total-card').borderColor,
    accountBackground: style('.accounts > div > button').backgroundColor,
    formBackground: style('.quick-form').backgroundColor,
    formBorder: style('.quick-form').borderColor,
    fieldBackground: style('.quick-form input').backgroundColor,
    fieldBorder: style('.quick-form input').borderColor,
    expenseLabel: style('.quick-form .expense').color,
    incomeLabel: style('.quick-form .income').color,
    dailyColor: style('.total-card .daily').color,
    monthlyColor: style('.total-card .monthly').color,
  };
});
for (const key of Object.keys(mobileHomePalette)) if (mobileHomePalette[key] !== desktopHomePalette[key]) throw new Error(`Desktop/mobile home palette differs for ${key}: ${desktopHomePalette[key]} vs ${mobileHomePalette[key]}`);
await page.locator('.total-card').click();
await page.getByRole('button', { name: '設定' }).click();
await settingsDialog.getByRole('heading', { name: '設定', exact: true }).waitFor();
await settingsDialog.getByRole('button', { name: '分類', exact: true }).click();
const mobileCategoryLayout = await settingsDialog.evaluate(element => {
  const cards = [...element.querySelectorAll('.catalog-list .catalog-item')].filter(card => card.offsetParent !== null);
  return {
    cards: cards.length,
    listToggles: cards.filter(card => card.querySelector('.investment-toggle')).length,
    overlappingCards: cards.flatMap((card, index) => index < cards.length - 1 && card.getBoundingClientRect().bottom > cards[index + 1].getBoundingClientRect().top + 1 ? [index] : []),
  };
});
if (!mobileCategoryLayout.cards || mobileCategoryLayout.listToggles || mobileCategoryLayout.overlappingCards.length) throw new Error(`Mobile category list still exposes investment checkboxes or overlaps: ${JSON.stringify(mobileCategoryLayout)}`);
const mobileSortCard = settingsDialog.locator('.catalog-item').filter({ hasText: /^住/ });
await longPress(mobileSortCard);
const mobileOrderLayout = await mobileSortCard.evaluate(element => {
  const card = element.getBoundingClientRect();
  const controlsElement = element.querySelector('.catalog-order-controls');
  const controls = controlsElement.getBoundingClientRect();
  return { contained: controls.left >= card.left && controls.right <= card.right && controls.top >= card.top && controls.bottom <= card.bottom, buttons: controlsElement.querySelectorAll('button').length };
});
if (!mobileOrderLayout.contained || mobileOrderLayout.buttons !== 3) throw new Error(`Mobile reorder controls overflow: ${JSON.stringify(mobileOrderLayout)}`);
if (process.env.ORDER_MOBILE_SHOT) await page.screenshot({ path: process.env.ORDER_MOBILE_SHOT, fullPage: true });
await mobileSortCard.getByRole('button', { name: '完成' }).click();
const foodCategoryCard = settingsDialog.locator('.catalog-item').filter({ hasText: /^食/ });
await foodCategoryCard.getByRole('button', { name: '編輯' }).click();
catalogEditor = settingsDialog.locator('.catalog-edit-layer');
const foodInvestmentToggle = catalogEditor.getByRole('checkbox', { name: '設為投資項目' });
await foodInvestmentToggle.check();
const editInvestmentLayout = await catalogEditor.evaluate(element => {
  const panel = element.querySelector('.catalog-edit-panel').getBoundingClientRect();
  const control = element.querySelector('.edit-investment').getBoundingClientRect();
  return { contained: control.left >= panel.left && control.right <= panel.right && control.top >= panel.top && control.bottom <= panel.bottom, height: control.height };
});
if (!editInvestmentLayout.contained || editInvestmentLayout.height < 44) throw new Error(`Investment option is not contained in the category editor: ${JSON.stringify(editInvestmentLayout)}`);
if (process.env.CATEGORY_SETTINGS_MOBILE_SHOT) await page.screenshot({ path: process.env.CATEGORY_SETTINGS_MOBILE_SHOT, fullPage: true });
await catalogEditor.getByRole('button', { name: '儲存變更' }).click();
await foodCategoryCard.getByText('投資項目', { exact: false }).waitFor();
await foodCategoryCard.getByRole('button', { name: '編輯' }).click();
catalogEditor = settingsDialog.locator('.catalog-edit-layer');
if (!await catalogEditor.getByRole('checkbox', { name: '設為投資項目' }).isChecked()) throw new Error('Saved category investment state was not restored in the editor.');
await catalogEditor.getByRole('checkbox', { name: '設為投資項目' }).uncheck();
await catalogEditor.getByRole('button', { name: '儲存變更' }).click();
await settingsDialog.getByRole('button', { name: '帳戶', exact: true }).click();
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
await settingsDialog.locator('.catalog-item').first().getByRole('button', { name: '編輯' }).click();
catalogEditor = settingsDialog.locator('.catalog-edit-layer');
await catalogEditor.getByRole('heading', { name: '編輯帳戶' }).waitFor();
const mobileEditorLayer = await catalogEditor.evaluate(element => {
  const layer = element.getBoundingClientRect();
  const panel = element.querySelector('.catalog-edit-panel').getBoundingClientRect();
  return { layerWidth: layer.width, layerHeight: layer.height, panelContained: panel.left >= layer.left && panel.right <= layer.right && panel.top >= layer.top && panel.bottom <= layer.bottom, bottomGap: layer.bottom - panel.bottom };
});
if (Math.abs(mobileEditorLayer.layerWidth - 423) > 1 || Math.abs(mobileEditorLayer.layerHeight - 822) > 1 || !mobileEditorLayer.panelContained || mobileEditorLayer.bottomGap < 11) throw new Error(`Mobile catalog editor is clipped or not presented as a bottom sheet: ${JSON.stringify(mobileEditorLayer)}`);
if (process.env.SETTINGS_MOBILE_SHOT) await page.screenshot({ path: process.env.SETTINGS_MOBILE_SHOT, fullPage: true });
await catalogEditor.getByLabel('新的帳戶名稱').focus();
await page.setViewportSize({ width: 423, height: 500 });
await page.waitForFunction(() => document.documentElement.classList.contains('keyboard-open'));
const keyboardEditorLayout = await catalogEditor.evaluate(element => {
  const settings = element.closest('.settings-dialog').getBoundingClientRect();
  const panel = element.querySelector('.catalog-edit-panel').getBoundingClientRect();
  const input = element.querySelector('input').getBoundingClientRect();
  const actions = element.querySelector('.catalog-edit-actions').getBoundingClientRect();
  return { settingsTop: settings.top, settingsBottom: settings.bottom, panelTop: panel.top, panelBottom: panel.bottom, inputTop: input.top, inputBottom: input.bottom, actionsTop: actions.top, actionsBottom: actions.bottom };
});
if (keyboardEditorLayout.settingsTop < -1 || keyboardEditorLayout.settingsBottom > 501 || keyboardEditorLayout.panelTop < -1 || keyboardEditorLayout.panelBottom > 501 || keyboardEditorLayout.inputTop < 0 || keyboardEditorLayout.inputBottom > 500 || keyboardEditorLayout.actionsTop < 0 || keyboardEditorLayout.actionsBottom > 500) throw new Error(`Settings editor content is obscured by the simulated keyboard: ${JSON.stringify(keyboardEditorLayout)}`);
if (process.env.SETTINGS_KEYBOARD_SHOT) await page.screenshot({ path: process.env.SETTINGS_KEYBOARD_SHOT, fullPage: true });
await catalogEditor.getByRole('button', { name: '取消' }).click();
await page.setViewportSize({ width: 423, height: 822 });
await page.waitForFunction(() => !document.documentElement.classList.contains('keyboard-open'));
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
const uploadsBeforeReloadedSubmit = driveUploads;
await page.getByRole('button', { name: /確認送出/ }).click();
await page.getByText(/已儲存到這台裝置/).waitFor();
await waitForNode(() => driveUploads > uploadsBeforeReloadedSubmit, 'Automatic Drive sync did not renew authorization after reload.');
const renewedTokenPrompts = await page.evaluate(() => window.__driveTokenRequests);
if (renewedTokenPrompts.length !== 1 || renewedTokenPrompts[0] !== '') throw new Error(`Reloaded automatic sync did not request a returning-user token from the submit gesture: ${JSON.stringify(renewedTokenPrompts)}`);
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
await page.locator('.settings-dialog').getByRole('button', { name: '關閉' }).click();
await page.getByRole('heading', { name: '統計與流水' }).waitFor();
if (consoleErrors.length) throw new Error(`Browser console errors:\n${consoleErrors.join('\n')}`);
await browser.close();
