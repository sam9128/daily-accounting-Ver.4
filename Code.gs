/**
 * 核心優化：合併所有初始化所需的數據請求
 */

function getInitialData() {
  const ss = SpreadsheetApp.openById('1pTxMEtTQ1J7NdfUThTUeORtv7cbZyZ7BWBnjD20VGX0');
  const sheet = ss.getSheetByName('存款');
  const cache = PropertiesService.getScriptProperties();
  
  // 快速取得最後一列
  let lastRow = parseInt(cache.getProperty('LAST_ROW'));
  if (!lastRow || sheet.getRange(lastRow, 1).isBlank()) {
    lastRow = getLastDataRowOptimized(sheet);
    cache.setProperty('LAST_ROW', lastRow.toString());
  }

  // 一次性讀取整行數據 (1~58欄) 減少 API 呼叫次數
  const fullRowData = sheet.getRange(lastRow, 1, 1, 58).getDisplayValues()[0];
  const headers = sheet.getRange(1, 1, 1, 58).getValues()[0];

  // --- 處理餘額與帳戶 ---
  const accounts = [];
  // J 到 Q 欄 (索引 9-16)
  for (let i = 9; i <= 16; i++) {
    if (headers[i]) {
      accounts.push({ name: headers[i], balance: fullRowData[i] });
    }
  }
  // 特定新增欄位 BB, BC, BD, BF
  const extraCols = [53, 54, 55, 57]; 
  extraCols.forEach(idx => {
    if (headers[idx]) accounts.push({ name: headers[idx], balance: fullRowData[idx] });
  });

  // --- 處理流水帳：初次只抓最近一頁，後續再用載入更多補齊 ---
  const logPage = getTransactionLogPage(sheet, {
    limit: 30,
    beforeRow: lastRow + 1
  });

  const monthPage = getStatsPageByMode(sheet, 'month');
  const yearPage = getStatsPageByMode(sheet, 'year');

  return {
    summary: {
      balance: fullRowData[7],
      totalExpense: fullRowData[18],
      totalIncome: fullRowData[41],
      accounts: accounts
    },
    stats: {
      month: {
        total: monthPage.stats.total, food: monthPage.stats.food, cloth: monthPage.stats.cloth, live: monthPage.stats.live,
        travel: monthPage.stats.travel, edu: monthPage.stats.edu, fun: monthPage.stats.fun, med: monthPage.stats.med,
        use: monthPage.stats.use, gift: monthPage.stats.gift, diff: monthPage.stats.diff, save: monthPage.stats.save
      },
      year: {
        total: yearPage.stats.total, food: yearPage.stats.food, cloth: yearPage.stats.cloth, live: yearPage.stats.live,
        travel: yearPage.stats.travel, edu: yearPage.stats.edu, fun: yearPage.stats.fun, med: yearPage.stats.med,
        use: yearPage.stats.use, gift: yearPage.stats.gift, diff: yearPage.stats.diff, save: yearPage.stats.save
      },
    },
    statsPager: {
      month: monthPage.page,
      year: yearPage.page
    },
    logs: logPage
  };
}

function loadStatsPage(data) {
  const ss = SpreadsheetApp.openById('1pTxMEtTQ1J7NdfUThTUeORtv7cbZyZ7BWBnjD20VGX0');
  const sheet = ss.getSheetByName('存款');
  const mode = data && data.mode === 'year' ? 'year' : 'month';
  const cursorRow = parseInt(data && data.cursorRow, 10);
  const direction = parseInt(data && data.direction, 10) || 0;

  return getStatsPageByMode(sheet, mode, {
    cursorRow: Number.isFinite(cursorRow) && cursorRow > 1 ? cursorRow : null,
    direction: direction
  });
}

function getStatsPageByMode(sheet, mode, options) {
  const anchors = getPeriodAnchors(sheet, mode);
  if (!anchors.length) {
    return {
      stats: getEmptyStatsData(),
      page: null
    };
  }

  const cursorRow = parseInt(options && options.cursorRow, 10);
  const direction = parseInt(options && options.direction, 10) || 0;
  let index = anchors.length - 1;

  if (Number.isFinite(cursorRow) && cursorRow > 1) {
    const foundIndex = anchors.findIndex(anchor => anchor.row === cursorRow);
    if (foundIndex >= 0) {
      index = foundIndex;
    }
  }

  if (direction < 0) {
    index = Math.max(0, index - 1);
  } else if (direction > 0) {
    index = Math.min(anchors.length - 1, index + 1);
  }

  const targetAnchor = anchors[index];
  return buildStatsPageFromAnchor(sheet, targetAnchor, mode, index, anchors.length);
}

function buildStatsPageFromAnchor(sheet, anchor, mode, pageIndex, pageCount) {
  const rowData = sheet.getRange(anchor.row, 1, 1, 58).getDisplayValues()[0];
  const stats = extractStatsData(rowData, mode);

  return {
    stats: stats,
    page: {
      row: anchor.row,
      label: formatStatsPeriodLabel(anchor.date, mode),
      hasPrev: pageIndex > 0,
      hasNext: pageIndex < pageCount - 1
    }
  };
}

function extractStatsData(rowData, mode) {
  const statsRow = rowData.slice(18, 43);

  if (mode === 'year') {
    return {
      total: statsRow[11], food: statsRow[12], cloth: statsRow[13], live: statsRow[14],
      travel: statsRow[15], edu: statsRow[16], fun: statsRow[17], med: statsRow[18],
      use: statsRow[19], gift: statsRow[20], diff: statsRow[22], save: statsRow[24]
    };
  }

  return {
    total: statsRow[1], food: statsRow[2], cloth: statsRow[3], live: statsRow[4],
    travel: statsRow[5], edu: statsRow[6], fun: statsRow[7], med: statsRow[8],
    use: statsRow[9], gift: statsRow[10], diff: statsRow[21], save: statsRow[23]
  };
}

function getPeriodAnchors(sheet, mode) {
  const lastRow = getLastDataRowOptimized(sheet);
  if (lastRow < 2) return [];

  const dateValues = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  const anchors = [];
  let currentAnchor = null;

  for (let i = dateValues.length - 1; i >= 0; i--) {
    const date = parseSheetDate(dateValues[i][0]);
    if (!date) continue;

    const rowNumber = i + 2;
    const periodKey = getPeriodKey(date, mode);

    if (!currentAnchor) {
      currentAnchor = { row: rowNumber, key: periodKey, date: date };
      continue;
    }

    if (currentAnchor.key !== periodKey) {
      anchors.unshift({
        row: currentAnchor.row,
        key: currentAnchor.key,
        date: currentAnchor.date
      });
      currentAnchor = { row: rowNumber, key: periodKey, date: date };
      continue;
    }
  }

  if (currentAnchor) {
    anchors.unshift({
      row: currentAnchor.row,
      key: currentAnchor.key,
      date: currentAnchor.date
    });
  }

  return anchors;
}

function getPeriodKey(date, mode) {
  if (mode === 'year') {
    return String(date.getFullYear());
  }

  const month = String(date.getMonth() + 1).padStart(2, '0');
  return date.getFullYear() + '-' + month;
}

function formatStatsPeriodLabel(date, mode) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return '';

  if (mode === 'year') {
    return String(date.getFullYear());
  }

  const month = String(date.getMonth() + 1).padStart(2, '0');
  return date.getFullYear() + '/' + month;
}

function parseSheetDate(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  if (value === null || value === undefined || value === '') return null;

  const parsed = new Date(value);
  if (parsed instanceof Date && !isNaN(parsed.getTime())) return parsed;
  return null;
}

function getEmptyStatsData() {
  return {
    total: '0', food: '0', cloth: '0', live: '0',
    travel: '0', edu: '0', fun: '0', med: '0',
    use: '0', gift: '0', diff: '0', save: '0'
  };
}

function loadMoreLogs(data) {
  const ss = SpreadsheetApp.openById('1pTxMEtTQ1J7NdfUThTUeORtv7cbZyZ7BWBnjD20VGX0');
  const sheet = ss.getSheetByName('存款');
  const limit = Math.min(Math.max(parseInt(data && data.limit, 10) || 30, 1), 100);
  const beforeRow = parseInt(data && data.beforeRow, 10);

  return getTransactionLogPage(sheet, {
    limit: limit,
    beforeRow: Number.isFinite(beforeRow) && beforeRow > 1 ? beforeRow : sheet.getLastRow() + 1,
    account: data && data.account ? data.account : 'all',
    category: data && data.category ? data.category : 'all'
  });
}

function getTransactionLogPage(sheet, options) {
  const limit = Math.min(Math.max(parseInt(options && options.limit, 10) || 30, 1), 100);
  const beforeRow = Math.min(parseInt(options && options.beforeRow, 10) || (sheet.getLastRow() + 1), sheet.getLastRow() + 1);
  const accountFilter = normalizeLogFilterValue(options && options.account, ['all', '所有帳戶', '']);
  const categoryFilter = normalizeLogFilterValue(options && options.category, ['all', '所有分類', '']);
  const minRow = 2;
  const items = [];
  let stoppedEarly = false;
  let cursor = beforeRow - 1;

  while (cursor >= minRow && items.length < limit) {
    const chunkEnd = cursor;
    const chunkStart = Math.max(minRow, chunkEnd - 199);
    const rawRows = sheet.getRange(chunkStart, 1, chunkEnd - chunkStart + 1, 6).getDisplayValues();

    for (let i = rawRows.length - 1; i >= 0 && items.length < limit; i--) {
      const row = rawRows[i];
      if (isEmptyTransactionRow(row)) continue;

      const log = buildLogItem(row, chunkStart + i);
      const logAccount = String(log.account || '').trim();
      const logCategory = String(log.category || '').trim();

      if (accountFilter !== 'all' && logAccount !== accountFilter) continue;
      if (categoryFilter !== 'all' && logCategory !== categoryFilter) continue;

      items.push(log);

      if (items.length >= limit && i > 0) {
        stoppedEarly = true;
      }
    }

    cursor = chunkStart - 1;
  }

  const oldestRow = items.length ? items[items.length - 1].row : null;
  return {
    items: items,
    hasMore: items.length >= limit ? (stoppedEarly || cursor >= minRow) : false,
    nextBeforeRow: oldestRow
  };
}

function buildLogItem(row, rowNumber) {
  const clean = (v) => String(v || '').replace(/[^\d.-]/g, '');
  const text = (v) => String(v || '').replace(/\u3000/g, ' ').trim();

  return {
    row: rowNumber,
    date: text(row[0]),
    account: text(row[1]),
    category: text(row[2]),
    reason: text(row[3]),
    expense: clean(row[4]),
    income: clean(row[5])
  };
}

function isEmptyTransactionRow(row) {
  const text = (v) => String(v || '').replace(/\u3000/g, ' ').trim();
  const amount = (v) => text(v).replace(/,/g, '').replace(/[^\d.-]/g, '');

  const hasText = text(row[0]) || text(row[1]) || text(row[2]) || text(row[3]);
  const expense = amount(row[4]);
  const income = amount(row[5]);
  const hasAmount = expense !== '' && expense !== '0' && expense !== '0.0' && expense !== '0.00'
    || income !== '' && income !== '0' && income !== '0.0' && income !== '0.00';

  return !hasText && !hasAmount;
}

function addTransaction(data) {
  const ss = SpreadsheetApp.openById('1pTxMEtTQ1J7NdfUThTUeORtv7cbZyZ7BWBnjD20VGX0');
  const sheet = ss.getSheetByName('存款');
  const lastRow = getLastDataRowOptimized(sheet);
  const targetRow = lastRow + 1;
  
  // 直接從 data 讀取 expense 與 income，若無則填 0 或空字串
  const values = [[
    data.date || new Date(),
    data.account,
    data.category,
    data.reason,
    data.expense || "", // 第 5 欄：支出
    data.income || ""   // 第 6 欄：收入
  ]];
  
  sheet.getRange(targetRow, 1, 1, 6).setValues(values);
  PropertiesService.getScriptProperties().setProperty('LAST_ROW', targetRow.toString());
  return "成功同步！";
}

function updateTransaction(data) {
  const ss = SpreadsheetApp.openById('1pTxMEtTQ1J7NdfUThTUeORtv7cbZyZ7BWBnjD20VGX0');
  const sheet = ss.getSheetByName('存款');
  const row = parseInt(data && data.row, 10);
  const lastRow = getLastDataRowOptimized(sheet);

  if (!Number.isFinite(row) || row < 2 || row > lastRow) {
    throw new Error('找不到要修改的流水資料');
  }

  const values = [[
    data.date || new Date(),
    data.account || '',
    data.category || '',
    data.reason || '未註記',
    data.expense || '',
    data.income || ''
  ]];

  sheet.getRange(row, 1, 1, 6).setValues(values);
  PropertiesService.getScriptProperties().setProperty('LAST_ROW', String(Math.max(lastRow, row)));
  return {
    ok: true,
    row: row
  };
}

function getLastDataRowOptimized(sheet) {
  const values = sheet.getRange("A1:A2000").getValues();
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i][0] !== "" && values[i][0] !== null) return i + 1;
  }
  return 1;
}

function doGet() {
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle('日常記帳 Ver.4')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1');
}

function normalizeLogFilterValue(value, allAliases) {
  const normalized = String(value || '').trim();
  return allAliases.indexOf(normalized) >= 0 ? 'all' : normalized;
}
