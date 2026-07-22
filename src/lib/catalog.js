import { defaultAccounts, defaultCategoryDefinitions } from './ledger.js';

const clean = value => String(value ?? '').trim();
const key = value => clean(value).toLocaleLowerCase('zh-TW');
const uniqueNames = items => items.filter((item, index, all) => item.name && all.findIndex(candidate => key(candidate.name) === key(item.name)) === index);
const legacyId = (type, name, index) => `legacy-${type}-${index}-${encodeURIComponent(key(name))}`;

function normalizeAccounts(items) {
  const source = Array.isArray(items) && items.length ? items : defaultAccounts;
  return uniqueNames(source.map((item, index) => {
    const value = typeof item === 'string' ? { name: item } : item || {};
    const name = clean(value.name);
    return { id: value.id || legacyId('account', name, index), name, aliases: [...new Set((value.aliases || []).map(clean).filter(Boolean))], hidden: Boolean(value.hidden) };
  }));
}

function normalizeCategories(items) {
  const source = Array.isArray(items) && items.length ? items : defaultCategoryDefinitions;
  return uniqueNames(source.map((item, index) => {
    const value = typeof item === 'string' ? { name: item } : item || {};
    const fallback = defaultCategoryDefinitions.find(candidate => key(candidate.name) === key(value.name));
    const name = clean(value.name);
    return {
      id: value.id || legacyId('category', name, index),
      name,
      aliases: [...new Set((value.aliases || []).map(clean).filter(Boolean))],
      investment: value.investment ?? fallback?.investment ?? false,
      systemRole: value.systemRole ?? fallback?.systemRole ?? null,
      hidden: Boolean(value.hidden),
    };
  }));
}

export function normalizeCatalog(value, legacy = {}) {
  return {
    updatedAt: clean(value?.updatedAt || legacy.updatedAt),
    accounts: normalizeAccounts(value?.accounts || legacy.accounts),
    categories: normalizeCategories(value?.categories || legacy.categories),
  };
}

export function catalogFromBackup(payload, transactionRows = []) {
  const transactionCategories = transactionRows.map(record => clean(record.category)).filter(Boolean);
  const suppliedCategories = Array.isArray(payload?.categories) ? payload.categories : [];
  const known = new Set(suppliedCategories.map(item => key(typeof item === 'string' ? item : item?.name)));
  const categories = [...suppliedCategories];
  for (const name of transactionCategories) {
    if (!known.has(key(name))) { categories.push({ name, investment: false, systemRole: null }); known.add(key(name)); }
  }
  return normalizeCatalog(payload?.catalog, {
    accounts: payload?.accounts,
    categories: categories.length ? categories : defaultCategoryDefinitions,
    updatedAt: payload?.catalogUpdatedAt || payload?.exportedAt,
  });
}

export function mergeCatalog(local, remote) {
  if (!remote) return local;
  if (!local) return remote;
  return String(remote.updatedAt || '') > String(local.updatedAt || '') ? remote : local;
}

const aliasesFor = item => [item.name, ...(item.aliases || [])];
const nameMap = items => new Map(items.flatMap(item => aliasesFor(item).map(alias => [key(alias), item.name])));

function updatedRecord(record, patch, timestamp) {
  return { ...record, ...patch, updatedAt: timestamp, revision: (record.revision || 0) + 1 };
}

export function renameTransactionReferences(records, field, from, to, timestamp = new Date().toISOString()) {
  const source = key(from);
  return records.map(record => {
    const patch = {};
    if (key(record[field]) === source) patch[field] = to;
    if (field === 'account' && key(record.reason) === key(`轉${from}`)) patch.reason = `轉${to}`;
    return Object.keys(patch).length ? updatedRecord(record, patch, timestamp) : record;
  });
}

export function alignTransactionsToCatalog(records, catalog, timestamp = new Date().toISOString()) {
  const accounts = nameMap(catalog.accounts);
  const categories = nameMap(catalog.categories);
  const transferTargets = new Map(catalog.accounts.flatMap(item => aliasesFor(item).map(alias => [key(`轉${alias}`), `轉${item.name}`])));
  return records.map(record => {
    const account = accounts.get(key(record.account));
    const category = categories.get(key(record.category));
    const reason = transferTargets.get(key(record.reason));
    const patch = {};
    if (account && account !== record.account) patch.account = account;
    if (category && category !== record.category) patch.category = category;
    if (reason && reason !== record.reason) patch.reason = reason;
    return Object.keys(patch).length ? updatedRecord(record, patch, timestamp) : record;
  });
}

export const catalogUsage = (records, field, name, aliases = []) => {
  const names = new Set([name, ...aliases].map(key));
  return records.filter(record => {
    if (record.deleted) return false;
    if (names.has(key(record[field]))) return true;
    return field === 'account' && [...names].some(accountName => key(record.reason) === key(`轉${accountName}`));
  }).length;
};
export const sameCatalogName = (left, right) => key(left) === key(right);
export const cleanCatalogName = clean;
