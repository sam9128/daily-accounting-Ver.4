const DB_NAME = 'daily-book-ver4';
const DB_VERSION = 3;

let databasePromise;
let initializationPromise;

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
  });
}

function ensureIndex(store, name, keyPath, options = {}) {
  if (!store.indexNames.contains(name)) store.createIndex(name, keyPath, options);
}

function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      const transactionStore = database.objectStoreNames.contains('transactions')
        ? request.transaction.objectStore('transactions')
        : database.createObjectStore('transactions', { keyPath: 'id' });
      ensureIndex(transactionStore, 'by_date', 'date');
      ensureIndex(transactionStore, 'by_account', 'account');
      ensureIndex(transactionStore, 'by_category', 'category');
      ensureIndex(transactionStore, 'by_sequence', 'sequence');
      ensureIndex(transactionStore, 'by_updated_at', 'updatedAt');
      if (!database.objectStoreNames.contains('settings')) database.createObjectStore('settings', { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      databasePromise = undefined;
      reject(request.error);
    };
  });
  return databasePromise;
}

export async function all(storeName) {
  const database = await openDatabase();
  return requestResult(database.transaction(storeName).objectStore(storeName).getAll());
}

export async function put(storeName, value) {
  const database = await openDatabase();
  const transaction = database.transaction(storeName, 'readwrite');
  transaction.objectStore(storeName).put(value);
  await transactionDone(transaction);
}

export async function putMany(storeName, values) {
  if (!values.length) return;
  const database = await openDatabase();
  const transaction = database.transaction(storeName, 'readwrite');
  const store = transaction.objectStore(storeName);
  for (const value of values) store.put(value);
  await transactionDone(transaction);
}

async function initialize() {
  const database = await openDatabase();
  const transactionCount = await requestResult(database.transaction('transactions').objectStore('transactions').count());
  const transaction = database.transaction('settings', 'readwrite');
  transaction.objectStore('settings').put({ key: 'dataSchema', value: 5 });
  await transactionDone(transaction);
  return { transactionCount };
}

export function initializeDatabase() {
  if (!initializationPromise) initializationPromise = initialize().catch(error => {
    initializationPromise = undefined;
    throw error;
  });
  return initializationPromise;
}

export const settingsObject = entries => Object.fromEntries(entries.map(({ key, value }) => [key, value]));
