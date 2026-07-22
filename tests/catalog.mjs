import assert from 'node:assert/strict';
import { alignTransactionsToCatalog, catalogFromBackup, catalogUsage, mergeCatalog, normalizeCatalog, renameTransactionReferences } from '../src/lib/catalog.js';

const legacy = normalizeCatalog(null, { accounts: ['現金'], categories: [{ name: '餐飲', investment: false }] });
assert.equal(legacy.accounts[0].name, '現金');
assert.equal(legacy.accounts[0].hidden, false);
assert.equal(legacy.categories[0].investment, false);

const transaction = { id: 'catalog-1', account: '現金', category: '餐飲', reason: '轉現金', updatedAt: '2026-01-01T00:00:00.000Z', revision: 1 };
const renamedAccountRows = renameTransactionReferences([transaction], 'account', '現金', '生活帳戶', '2026-02-01T00:00:00.000Z');
assert.equal(renamedAccountRows[0].account, '生活帳戶');
assert.equal(renamedAccountRows[0].reason, '轉生活帳戶');
assert.equal(renamedAccountRows[0].revision, 2);

const catalog = normalizeCatalog({
  updatedAt: '2026-03-01T00:00:00.000Z',
  accounts: [{ id: 'account-1', name: '生活帳戶', aliases: ['現金'], hidden: true }],
  categories: [{ id: 'category-1', name: '日常餐飲', aliases: ['餐飲'], investment: true, systemRole: null, hidden: true }],
});
const aligned = alignTransactionsToCatalog([transaction], catalog, '2026-03-02T00:00:00.000Z');
assert.equal(aligned[0].account, '生活帳戶');
assert.equal(aligned[0].category, '日常餐飲');
assert.equal(aligned[0].reason, '轉生活帳戶');
assert.equal(catalog.accounts[0].hidden, true);
assert.equal(catalog.categories[0].investment, true);
assert.equal(catalogUsage([transaction], 'account', '生活帳戶', ['現金']), 1);
assert.equal(catalogUsage([{ ...transaction, account: '其他帳戶' }], 'account', '生活帳戶', ['現金']), 1, 'Transfer targets must block account deletion.');
assert.equal(catalogUsage([{ ...transaction, account: '其他帳戶', reason: '', deleted: true }], 'account', '生活帳戶', ['現金']), 0, 'Deleted rows must not block catalog cleanup.');
assert.equal(catalogUsage([transaction], 'category', '日常餐飲', ['餐飲']), 1);

const older = { ...catalog, updatedAt: '2026-02-01T00:00:00.000Z' };
assert.equal(mergeCatalog(catalog, older), catalog);
assert.equal(mergeCatalog(older, catalog), catalog);

const backupCatalog = catalogFromBackup({ schema: 5, accounts: ['現金'], exportedAt: '2026-04-01T00:00:00.000Z' }, [transaction]);
assert.ok(backupCatalog.categories.some(item => item.name === '餐飲'));
assert.equal(backupCatalog.updatedAt, '2026-04-01T00:00:00.000Z');

console.log('Catalog migration and reversible visibility validation passed.');
