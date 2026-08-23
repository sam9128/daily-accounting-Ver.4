// Metrics offered on the home total card. Each id is `<scope>.<kind>`; the
// stored preference is an ordered list of ids, so order is the display order.
const scopes = [
  { key: 'day', label: '日' },
  { key: 'month', label: '月' },
  { key: 'year', label: '年' },
];

const kinds = [
  { key: 'expense', label: '支出', tone: 'out', read: stats => stats.expenseTotal },
  { key: 'income', label: '收入', tone: 'in', read: stats => stats.incomeTotal },
  { key: 'net', label: '結餘', tone: 'signed', read: stats => stats.total },
  { key: 'save', label: '儲蓄', tone: 'signed', read: stats => stats.save },
];

export const homeMetricDefinitions = scopes.flatMap(scope => kinds.map(kind => ({
  id: `${scope.key}.${kind.key}`,
  label: `${scope.label}${kind.label}`,
  scopeLabel: scope.label,
  kindLabel: kind.label,
  tone: kind.tone,
  read: ledger => kind.read(ledger[scope.key]),
})));

const byId = new Map(homeMetricDefinitions.map(item => [item.id, item]));

export const defaultHomeMetrics = ['day.expense', 'month.expense', 'month.income'];
export const maxHomeMetrics = 6;

export const findHomeMetric = id => byId.get(id) ?? null;

export function normalizeHomeMetrics(value) {
  const picked = [...new Set((Array.isArray(value) ? value : []).filter(id => byId.has(id)))].slice(0, maxHomeMetrics);
  return picked.length ? picked : defaultHomeMetrics;
}

export function moveHomeMetric(ids, id, direction) {
  const index = ids.indexOf(id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= ids.length) return ids;
  const next = [...ids];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

// Positive expense and income read as magnitudes, matching the 統計 dialog;
// anything signed is tinted by whether it lands above or below zero.
export function homeMetricTone(metric, value) {
  return metric.tone === 'signed' ? (value < 0 ? 'out' : 'in') : metric.tone;
}
