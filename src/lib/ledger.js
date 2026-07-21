export const categories = ['食', '衣', '住', '行', '育', '樂', '醫', '用', '送', '美金', '日幣', '0050', '存', '轉'];
export const expenseCategories = categories.slice(0, 9);
export const investmentCategories = categories.slice(9, 12);
export const defaultAccounts = ['零用金', '郵局存款', '永豐存款', '台新存款', 'Line Bank', '口袋帳戶', '永豐金證券', '小姐姐VISA'];
export const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;

const normalized = value => String(value ?? '').trim().toLocaleLowerCase('en-US');
const sameText = (left, right) => normalized(left) === normalized(right);
const dateParts = value => {
  const [year, month, day] = String(value).slice(0, 10).split('-').map(Number);
  return { year, month, day };
};
const localToday = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

function periodStats(rows, targetDate, scope) {
  const target = dateParts(targetDate);
  const values = Object.fromEntries(expenseCategories.map(category => [category, 0]));
  const investments = Object.fromEntries(investmentCategories.map(category => [category, 0]));
  let save = 0;
  let transferTotal = 0;
  for (const row of rows) {
    const date = dateParts(row.date);
    const included = scope === 'day'
      ? date.year === target.year && date.month === target.month && date.day === target.day
      : scope === 'month'
        ? date.year === target.year && date.month === target.month
        : date.year === target.year;
    if (!included) continue;
    const delta = num(row.income) - num(row.expense);
    if (Object.hasOwn(values, row.category)) values[row.category] += delta;
    if (Object.hasOwn(investments, row.category)) investments[row.category] += delta;
    if (row.category === '存') save += delta;
    if (row.category === '轉') transferTotal += delta;
  }
  const total = Object.values(values).reduce((sum, value) => sum + value, 0);
  const investmentTotal = Object.values(investments).reduce((sum, value) => sum + value, 0);
  return { values, total, save, diff: total + save, investments, investmentTotal, transferTotal };
}

export function calculate(transactions, accounts = defaultAccounts, targetDate = localToday()) {
  const rows = transactions
    .filter(transaction => !transaction.deleted)
    .toSorted((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0));
  const balances = Object.fromEntries(accounts.map(account => [account, 0]));
  const categoryTotals = Object.fromEntries(categories.map(category => [category, 0]));
  const rowDetails = {};
  const accountKeys = new Map(accounts.map((account, index) => [normalized(account), { account, index }]));
  let total = 0;

  for (const transaction of rows) {
    const expense = num(transaction.expense);
    const income = num(transaction.income);
    const delta = income - expense;
    const source = accountKeys.get(normalized(transaction.account));
    const reason = String(transaction.reason ?? '').trim();
    total += delta;
    if (Object.hasOwn(categoryTotals, transaction.category)) categoryTotals[transaction.category] += delta;

    for (let index = 0; index < accounts.length; index += 1) {
      const account = accounts[index];
      if (source?.index === index) {
        balances[account] += normalized(reason).startsWith('轉') ? (index === 0 ? -expense : -income) : delta;
      } else if (sameText(reason, `轉${account}`)) {
        balances[account] += income;
      }
    }
    rowDetails[transaction.id] = {
      accountBalance: source ? balances[source.account] : delta,
      runningTotal: total,
      delta,
    };
  }

  return {
    rows,
    balances,
    categoryTotals,
    rowDetails,
    total,
    day: periodStats(rows, targetDate, 'day'),
    month: periodStats(rows, targetDate, 'month'),
    year: periodStats(rows, targetDate, 'year')
  };
}
