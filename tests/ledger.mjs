import assert from 'node:assert/strict';
import { calculate, categories, defaultAccounts } from '../src/lib/ledger.js';

// Public-safe synthetic records cover the formulas without embedding private history.
const transactions = [
  { id: 'synthetic-3', sequence: 3, date: '2026-07-20', account: '郵局存款', category: '轉', reason: '轉Line bank', expense: 0, income: 300 },
  { id: 'synthetic-1', sequence: 1, date: '2026-07-21', account: '零用金', category: '食', reason: '測試餐費', expense: 100, income: 0 },
  { id: 'synthetic-6', sequence: 6, date: '2025-12-31', account: '零用金', category: '衣', reason: '跨年測試', expense: 50, income: 0 },
  { id: 'synthetic-2', sequence: 2, date: '2026-07-21', account: '郵局存款', category: '存', reason: '測試收入', expense: 0, income: 1000 },
  { id: 'synthetic-5', sequence: 5, date: '2026-06-01', account: '零用金', category: '住', reason: '測試住居', expense: 40, income: 0 },
  { id: 'synthetic-4', sequence: 4, date: '2026-06-01', account: '零用金', category: '轉', reason: '轉台新存款', expense: 200, income: 0 },
];

const ledger = calculate(transactions, defaultAccounts, '2026-07-21');

assert.deepEqual(ledger.rows.map(row => row.sequence), [1, 2, 3, 4, 5, 6]);
assert.equal(ledger.total, 910);
assert.deepEqual(ledger.balances, {
  零用金: -390,
  郵局存款: 700,
  永豐存款: 0,
  台新存款: 0,
  'Line Bank': 300,
  口袋帳戶: 0,
  永豐金證券: 0,
  小姐姐VISA: 0,
});
assert.deepEqual(ledger.categoryTotals, Object.assign(Object.fromEntries(categories.map(category => [category, 0])), {
  食: -100,
  衣: -50,
  住: -40,
  存: 1000,
  轉: 100,
}));
assert.deepEqual(ledger.day, { values: { 食: -100, 衣: 0, 住: 0, 行: 0, 育: 0, 樂: 0, 醫: 0, 用: 0, 送: 0 }, total: -100, save: 1000, diff: 900 });
assert.deepEqual(ledger.month, ledger.day);
assert.deepEqual(ledger.year, { values: { 食: -100, 衣: 0, 住: -40, 行: 0, 育: 0, 樂: 0, 醫: 0, 用: 0, 送: 0 }, total: -140, save: 1000, diff: 860 });

console.log('Ledger formula validation passed with privacy-safe synthetic transactions.');
