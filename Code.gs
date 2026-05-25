// ============================================================
// JAG App - Google Apps Script Backend
// Spreadsheet: https://docs.google.com/spreadsheets/d/1Cg9m7lUu536JlSXbY4HifWQpOw9nQ2DtBRDZRzIXIn4
// Version: 1.37.9 (2026-05-25)
// ============================================================

const VERSION      = '1.37.9';
const VERSION_DATE = '2026-05-25';

const SPREADSHEET_ID    = '1Cg9m7lUu536JlSXbY4HifWQpOw9nQ2DtBRDZRzIXIn4';
const SCHEDULE_SHEET_NAME = 'Schedule';
const MEMBERS_SHEET_NAME = 'Members';
const LYRICS_SHEET_NAME  = 'Lyrics';
const APP_NOTICE      = '⚠️  Please use the JAG App to make changes — do not edit this sheet directly.\n🔗  https://tinyurl.com/JAG-App';

// ---- Entry Point ----

function doGet() {
  const template = HtmlService.createTemplateFromFile('Index');
  try {
    // Inject pre-loaded data so the page renders immediately — no second round-trip needed.
    // Escape </script so the JSON literal can't break the surrounding <script> tag.
    template.initialData = JSON.stringify(getAllData()).replace(/<\/script/gi, '<\\/script');
  } catch(e) {
    template.initialData = 'null'; // fallback: client calls loadData() instead
    Logger.log('doGet data load error: ' + e);
  }
  return template.evaluate()
    .setTitle('JAG App')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getVersion() {
  return { version: VERSION, date: VERSION_DATE };
}

// ---- Data Fetching ----

function getAllData() {
  // C: serve from cache when available — avoids opening the spreadsheet on every load.
  // Cache is cleared by _clearDataCache() on every write, so it never serves stale data after saves.
  const cache = CacheService.getScriptCache();
  try {
    const hit = cache.get('allData');
    if (hit) return JSON.parse(hit);
  } catch(e) {}

  // B: open spreadsheet once and share it — avoids two separate openById calls
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const data = {
    entries:     getRosterEntries(ss),
    members:     getMembers(ss),
    lyrics:      getLyrics(ss),
    version:     VERSION,
    versionDate: VERSION_DATE
  };
  try { cache.put('allData', JSON.stringify(data), 60); } catch(e) {} // 60s TTL; silent if >100KB
  return data;
}

function _normalizeStr(s) { return String(s == null ? '' : s).toLowerCase().trim(); }

// Maps header text → column index so reads are schema-version-agnostic.
// Adding/reordering columns in the sheet never breaks existing reads.
function _rosterColMap(headers) {
  const m = {};
  headers.forEach(function(h, i) {
    switch (_normalizeStr(h)) {
      case 'date':             m.date = i;        break;
      case 'group':            m.group = i;       break;
      case 'event type':       m.eventType = i;   break;
      case 'venue':            m.venue = i;       break;
      case 'organiser':        m.organiser = i;   break;
      case 'p&w':              m.pw = i;          break;
      case 'facilitator':      m.facilitator = i; break;
      case 'food preparation':
      case 'food':             m.food = i;        break;
      case 'reporting':        m.reporting = i;   break;
      case 'notes':            m.notes = i;       break;
      case 'ice breaker':      m.iceBreaker = i;  break;
      case 'last updated':     m.updatedAt = i;   break;
      case 'time':             m.time = i;        break;
    }
  });
  return m;
}

function getRosterEntries(ss) {
  const sheet = (ss || SpreadsheetApp.openById(SPREADSHEET_ID)).getSheetByName(SCHEDULE_SHEET_NAME);
  if (!sheet || sheet.getLastRow() <= 1) return [];

  const data = sheet.getDataRange().getValues();
  // Auto-detect header row: if row 1 has no recognized column names, it's the notice row
  const firstRowMap  = _rosterColMap(data[0]);
  const headerRowIdx = Object.keys(firstRowMap).length > 0 ? 0 : 1;
  const col          = headerRowIdx === 0 ? firstRowMap : _rosterColMap(data[headerRowIdx]);
  const tz   = Session.getScriptTimeZone();
  const g    = function(row, key) { return col[key] !== undefined ? row[col[key]] : ''; };
  const entries = [];

  for (let i = headerRowIdx + 1; i < data.length; i++) {
    const row = data[i];
    if (!g(row, 'date')) continue;
    const dateObj = new Date(g(row, 'date'));

    const rawUpdatedAt = g(row, 'updatedAt');
    const rawTime      = g(row, 'time');
    // Sheets stores time-only values as fractions of a day in the script's local timezone.
    // Format using the script timezone so 18:30 Perth reads back as 18:30, not 10:30.
    const timeStr      = rawTime instanceof Date
                         ? Utilities.formatDate(rawTime, tz, 'HH:mm')
                         : String(rawTime || '');
    entries.push({
      rowIndex:    i + 1,
      date:        Utilities.formatDate(dateObj, tz, 'yyyy-MM-dd'),
      group:       String(g(row, 'group')       || ''),
      eventType:   String(g(row, 'eventType')   || ''),
      venue:       String(g(row, 'venue')       || ''),
      organiser:   String(g(row, 'organiser')   || ''),
      pw:          String(g(row, 'pw')          || ''),
      facilitator: String(g(row, 'facilitator') || ''),
      food:        String(g(row, 'food')        || ''),
      reporting:   String(g(row, 'reporting')   || ''),
      notes:       String(g(row, 'notes')       || ''),
      iceBreaker:  String(g(row, 'iceBreaker')  || ''),
      updatedAt:   rawUpdatedAt ? Utilities.formatDate(new Date(rawUpdatedAt), tz, "yyyy-MM-dd'T'HH:mm:ss") : '',
      time:        timeStr
    });
  }

  return entries;
}

function getMembers(ss) {
  const sheet = (ss || SpreadsheetApp.openById(SPREADSHEET_ID)).getSheetByName(MEMBERS_SHEET_NAME);
  if (!sheet || sheet.getLastRow() <= 1) return [];

  const data = sheet.getDataRange().getValues();
  // Auto-detect: if row 1 col A is 'Name', headers are in row 1 — members start at index 1.
  // Otherwise row 1 is the notice row — skip to index 2.
  const memberStartIdx = _normalizeStr(data[0][0]) === 'name' ? 1 : 2;
  const members = [];

  const tz = Session.getScriptTimeZone();
  for (let i = memberStartIdx; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;
    const rawUpdatedAt = row[9];
    const rawBirthday  = row[10];
    members.push({
      rowIndex:      i + 1,
      name:          String(row[0]),
      group:         String(row[1]),
      canOrganise:   row[2] === true,
      canPW:         row[3] === true,
      canFacilitate: row[4] === true,
      canReport:     row[5] === true,
      active:        row[6] === true,
      roleType:      String(row[7] || 'Adult'),
      canDrive:      row[8] === true,
      updatedAt:     rawUpdatedAt ? Utilities.formatDate(new Date(rawUpdatedAt), tz, "yyyy-MM-dd'T'HH:mm:ss") : '',
      birthday:      rawBirthday instanceof Date
                       ? Utilities.formatDate(rawBirthday, tz, 'yyyy-MM-dd')
                       : String(rawBirthday || '')
    });
  }

  return members;
}

// ---- Roster CRUD ----

function saveRosterEntry(entry) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SCHEDULE_SHEET_NAME);
    if (!sheet) return { success: false, error: 'Roster sheet not found' };

    const dateObj = _parseDate(entry.date);

    // Read sheet once: serves both header mapping and row write.
    // Building rowData by column position makes writes column-order agnostic —
    // reordering columns in the sheet never breaks saves.
    const data         = sheet.getDataRange().getValues();
    const firstRowMap  = _rosterColMap(data[0]);
    const headerRowIdx = Object.keys(firstRowMap).length > 0 ? 0 : 1;
    const col          = headerRowIdx === 0 ? firstRowMap : _rosterColMap(data[headerRowIdx]);
    const numCols      = data[headerRowIdx].length;

    // Sort only when the row order can change: new row or date edited.
    const needsSort = !entry.rowIndex || (function() {
      const oldCell = data[entry.rowIndex - 1] && data[entry.rowIndex - 1][col.date];
      if (!oldCell) return true;
      return _dateChanged(new Date(oldCell), dateObj);
    })();

    const rowData = new Array(numCols).fill('');
    const s = function(key, val) { if (col[key] !== undefined) rowData[col[key]] = val; };
    s('date',        dateObj);
    s('group',       entry.group);
    s('eventType',   entry.eventType);
    s('venue',       entry.venue       || '');
    s('organiser',   entry.organiser   || '');
    s('pw',          entry.pw          || '');
    s('facilitator', entry.facilitator || '');
    s('food',        entry.food        || '');
    s('reporting',   entry.reporting   || '');
    s('notes',       entry.notes       || '');
    s('iceBreaker',  entry.iceBreaker  || '');
    s('updatedAt',   new Date());
    s('time',        entry.time        || '');

    // Set time cell to plain text before writing so Sheets never auto-converts '18:30' to a Date.
    const targetRow = entry.rowIndex || (sheet.getLastRow() + 1);
    if (col.time !== undefined) sheet.getRange(targetRow, col.time + 1).setNumberFormat('@');
    sheet.getRange(targetRow, 1, 1, numCols).setValues([rowData]);

    SpreadsheetApp.flush(); // commit writes before sort so getLastColumn() sees col M
    _clearDataCache();
    if (needsSort) {
      sortRosterSheet(sheet);
      return { success: true };
    }
    return { success: true, stable: true }; // rowIndices unchanged — client can skip loadData()
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// Batch version: saves all entries in one server round-trip (one sheet open, one read, one sort).
// Always prefer this over calling saveRosterEntry in a loop.
function saveRosterEntries(entries) {
  try {
    const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SCHEDULE_SHEET_NAME);
    if (!sheet) return { success: false, error: 'Roster sheet not found' };

    const data         = sheet.getDataRange().getValues();
    const firstRowMap  = _rosterColMap(data[0]);
    const headerRowIdx = Object.keys(firstRowMap).length > 0 ? 0 : 1;
    const col          = headerRowIdx === 0 ? firstRowMap : _rosterColMap(data[headerRowIdx]);
    const numCols      = data[headerRowIdx].length;

    // Sort only when the row order can change: any new row or any entry with a changed date.
    const needsSort = entries.some(function(entry) {
      if (!entry.rowIndex) return true;
      const newDate = _parseDate(entry.date);
      const oldCell = data[entry.rowIndex - 1] && data[entry.rowIndex - 1][col.date];
      if (!oldCell) return true;
      return _dateChanged(new Date(oldCell), newDate);
    });

    let nextNewRow = sheet.getLastRow() + 1;
    entries.forEach(function(entry) {
      const dateObj = _parseDate(entry.date);
      const rowData = new Array(numCols).fill('');
      const s = function(key, v) { if (col[key] !== undefined) rowData[col[key]] = v; };
      s('date',        dateObj);
      s('group',       entry.group);
      s('eventType',   entry.eventType);
      s('venue',       entry.venue       || '');
      s('organiser',   entry.organiser   || '');
      s('pw',          entry.pw          || '');
      s('facilitator', entry.facilitator || '');
      s('food',        entry.food        || '');
      s('reporting',   entry.reporting   || '');
      s('notes',       entry.notes       || '');
      s('iceBreaker',  entry.iceBreaker  || '');
      s('updatedAt',   new Date());
      s('time',        entry.time        || '');

      // Set time cell to plain text before writing so Sheets never auto-converts '18:30' to a Date.
      const targetRow = entry.rowIndex || nextNewRow;
      if (!entry.rowIndex) nextNewRow++;
      if (col.time !== undefined) sheet.getRange(targetRow, col.time + 1).setNumberFormat('@');
      sheet.getRange(targetRow, 1, 1, numCols).setValues([rowData]);
    });

    SpreadsheetApp.flush(); // commit writes before sort so getLastColumn() sees col M
    _clearDataCache();
    if (needsSort) {
      sortRosterSheet(sheet);
      return { success: true };
    }
    return { success: true, stable: true }; // rowIndices unchanged — client can skip loadData()
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function deleteRosterEntry(rowIndex) {
  try {
    SpreadsheetApp.openById(SPREADSHEET_ID)
      .getSheetByName(SCHEDULE_SHEET_NAME)
      .deleteRow(rowIndex);
    _clearDataCache();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// ---- Members CRUD ----

function saveMember(member) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(MEMBERS_SHEET_NAME);
    if (!sheet) return { success: false, error: 'Members sheet not found' };

    const updatedAt = new Date();
    const rowData = [
      member.name,
      member.group,
      member.canOrganise   === true,
      member.canPW         === true,
      member.canFacilitate === true,
      member.canReport     === true,
      member.active        !== false,
      member.roleType      || 'Adult',
      member.canDrive      === true,
      updatedAt,
      member.birthday      || ''
    ];

    const targetRow = member.rowIndex || (sheet.getLastRow() + 1);
    // Set birthday cell to plain text before writing so Sheets doesn't auto-convert the date string.
    if (member.birthday) sheet.getRange(targetRow, 11).setNumberFormat('@');
    sheet.getRange(targetRow, 1, 1, 11).setValues([rowData]);

    _clearDataCache();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function deleteMember(rowIndex) {
  try {
    SpreadsheetApp.openById(SPREADSHEET_ID)
      .getSheetByName(MEMBERS_SHEET_NAME)
      .deleteRow(rowIndex);
    _clearDataCache();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// ---- Lyrics CRUD ----

function getLyrics(ss) {
  const sheet = (ss || SpreadsheetApp.openById(SPREADSHEET_ID)).getSheetByName(LYRICS_SHEET_NAME);
  if (!sheet || sheet.getLastRow() <= 1) return [];

  const data = sheet.getDataRange().getValues();
  // Row 1 is the header row; data starts at row 2 (index 1)
  const lyrics = [];
  const tz = Session.getScriptTimeZone();
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;
    const rawUpdatedAt = row[2];
    lyrics.push({
      rowIndex:  i + 1,
      songName:  String(row[0] || ''),
      copyCount: Number(row[1]) || 0,
      updatedAt: rawUpdatedAt ? Utilities.formatDate(new Date(rawUpdatedAt), tz, "yyyy-MM-dd'T'HH:mm:ss") : ''
    });
  }
  return lyrics;
}

function saveLyric(lyric) {
  try {
    const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(LYRICS_SHEET_NAME);
    if (!sheet) return { success: false, error: 'Lyrics sheet not found' };

    const rowData = [lyric.songName, lyric.copyCount || 0, new Date()];

    if (lyric.rowIndex) {
      sheet.getRange(lyric.rowIndex, 1, 1, 3).setValues([rowData]);
      _clearDataCache();
      return { success: true, rowIndex: lyric.rowIndex };
    } else {
      sheet.appendRow(rowData);
      _clearDataCache();
      return { success: true, rowIndex: sheet.getLastRow() };
    }
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function deleteLyric(rowIndex) {
  try {
    SpreadsheetApp.openById(SPREADSHEET_ID)
      .getSheetByName(LYRICS_SHEET_NAME)
      .deleteRow(rowIndex);
    _clearDataCache();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// ---- One-time migrations ----

// Sets Last Updated = 1 Jan 2026 for Members and Lyrics rows that have no timestamp.
// Run once from the editor, then delete.
function migrateSchemaToV137() {
  const ss      = SpreadsheetApp.openById(SPREADSHEET_ID);
  const DEFAULT = new Date('2026-01-01T00:00:00');
  let updated   = 0;

  const mSheet = ss.getSheetByName(MEMBERS_SHEET_NAME);
  if (mSheet) {
    const data     = mSheet.getDataRange().getValues();
    const startIdx = _normalizeStr(String(data[0][0])) === 'name' ? 1 : 2;
    for (let i = startIdx; i < data.length; i++) {
      if (!data[i][0]) continue;
      if (!data[i][9]) { mSheet.getRange(i + 1, 10).setValue(DEFAULT); updated++; }
    }
  }

  const lSheet = ss.getSheetByName(LYRICS_SHEET_NAME);
  if (lSheet) {
    const data = lSheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (!data[i][0]) continue;
      if (!data[i][2]) { lSheet.getRange(i + 1, 3).setValue(DEFAULT); updated++; }
    }
  }

  _clearDataCache();
  return 'migrateSchemaToV137: ' + updated + ' rows stamped with 2026-01-01';
}

// ---- Helpers ----

function _clearDataCache() {
  try { CacheService.getScriptCache().remove('allData'); } catch(e) {}
}

function _applyNoticeStyle(range) {
  return range.setBackground('#fef08a').setFontColor('#713f12').setFontWeight('bold')
    .setFontSize(9).setWrap(true).setVerticalAlignment('middle').setHorizontalAlignment('center');
}

function _createDropdown(values) {
  return SpreadsheetApp.newDataValidation().requireValueInList(values, true).setAllowInvalid(false).build();
}

function _dateChanged(oldDate, newDate) {
  return oldDate.getFullYear() !== newDate.getFullYear() ||
         oldDate.getMonth()    !== newDate.getMonth()    ||
         oldDate.getDate()     !== newDate.getDate();
}

// Parses a 'YYYY-MM-DD' string into a local Date without timezone shift.
function _parseDate(dateStr) {
  const p = dateStr.split('-');
  return new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
}

function sortRosterSheet(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 2) return;
  // Auto-detect data start row: if row 1 col A is 'Date', headers are in row 1 — data starts at 2.
  // Otherwise a notice row exists in row 1 — data starts at 3.
  const row1ColA     = _normalizeStr(sheet.getRange(1, 1).getValue());
  const dataStartRow = row1ColA === 'date' ? 2 : 3;
  if (lastRow < dataStartRow) return;
  sheet.getRange(dataStartRow, 1, lastRow - dataStartRow + 1, sheet.getLastColumn()).sort([
    { column: 1, ascending: true },
    { column: 2, ascending: true }
  ]);
}

// ---- Sheet Formatting ----
// Run formatSheets() from the Apps Script editor any time to:
//   • Apply column widths, dropdowns, date formats, alternating row colours
//   • Re-run safely after adding new columns — fully idempotent
// This function ONLY changes formatting — it never reads or writes sheet data.
//
// How to add formatting for a new Roster field:
//   1. Add its JS key → pixel width to the `widths` map in _formatRosterSheet()
//   2. If it needs a dropdown, add a validation block (copy the Group pattern)
//   3. If it's system-managed, add a header note (copy the id/updatedAt pattern)
//   4. Run formatSheets() from the editor — done.

function formatSheets() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  _formatRosterSheet(ss);
  _formatMembersSheet(ss);
  _formatLyricsSheet(ss);
  Logger.log('formatSheets complete.');
}

function _formatRosterSheet(ss) {
  const sheet = ss.getSheetByName(SCHEDULE_SHEET_NAME);
  if (!sheet) { Logger.log(SCHEDULE_SHEET_NAME + ' sheet not found.'); return; }

  // Auto-detect layout: if row 1 has no recognized column headers, it's the notice row (post-migration)
  const row1vals     = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const hasNoticeRow = Object.keys(_rosterColMap(row1vals)).length === 0;
  const headerRow    = hasNoticeRow ? 2 : 1;   // 1-indexed sheet row containing column headers
  const dataStartRow = hasNoticeRow ? 3 : 2;   // 1-indexed first data row

  const headers  = hasNoticeRow
    ? sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0]
    : row1vals;
  const col      = _rosterColMap(headers);
  const maxRows  = sheet.getMaxRows();
  const dataRows = maxRows - dataStartRow + 1;

  // Use recognized columns only for count — immune to notice cell pollution in getLastColumn()
  const dataColCount = Object.keys(col).length > 0 ? Math.max(...Object.values(col)) + 1 : 0;

  // --- Column widths (add new fields here) ---
  const widths = {
    date: 120, group: 70, eventType: 130, venue: 160,
    organiser: 130, pw: 130, facilitator: 130, food: 120,
    reporting: 130, notes: 220, iceBreaker: 160,
    time: 80, updatedAt: 145
  };
  Object.entries(widths).forEach(function([key, w]) {
    if (col[key] !== undefined) sheet.setColumnWidth(col[key] + 1, w);
  });

  // --- Freeze: notice row + header row if post-migration, otherwise just header row ---
  sheet.setFrozenRows(hasNoticeRow ? 2 : 1);

  // --- Last Updated: header note ---
  if (col.updatedAt !== undefined) {
    sheet.getRange(headerRow, col.updatedAt + 1).setNote('Auto-stamped by the app on every save. Do not edit manually.');
  }

  // --- Time: header note ---
  if (col.time !== undefined) {
    sheet.getRange(headerRow, col.time + 1).setNote('24-hour format, e.g. 18:30 for 6:30 PM. Leave blank if no fixed time.');
  }

  // --- Group: dropdown validation ---
  if (col.group !== undefined) {
    sheet.getRange(dataStartRow, col.group + 1, dataRows, 1).setDataValidation(_createDropdown(['JAG1', 'JAG2', 'Both']));
  }

  // --- Event Type: dropdown validation ---
  if (col.eventType !== undefined) {
    sheet.getRange(dataStartRow, col.eventType + 1, dataRows, 1).setDataValidation(
      _createDropdown(['Youth Hour', 'Separated LG', 'Combined', 'Special', 'Cancelled', 'Replaced']));
  }

  // --- Alternating row colours ---
  // clearFormat() removes ALL explicit cell formatting so banding applies uniformly.
  // Number formats are re-applied after banding, then setBackground(null) ensures
  // setNumberFormat() hasn't left any implicit explicit backgrounds that override banding.
  sheet.getBandings().forEach(function(b) { b.remove(); });
  if (dataColCount > 0) {
    const dataRange = sheet.getRange(dataStartRow, 1, dataRows, dataColCount);
    dataRange.clearFormat();
    dataRange.applyRowBanding().setFirstRowColor('#f5f3ff').setSecondRowColor('#ffffff');
    // Re-apply number formats after clearFormat() wiped them
    if (col.date !== undefined)
      sheet.getRange(dataStartRow, col.date + 1, dataRows, 1).setNumberFormat('ddd dd/mm/yyyy');
    if (col.updatedAt !== undefined)
      sheet.getRange(dataStartRow, col.updatedAt + 1, dataRows, 1).setNumberFormat('dd/mm/yyyy hh:mm');
    if (col.time !== undefined && dataRows > 0)
      sheet.getRange(dataStartRow, col.time + 1, dataRows, 1).setNumberFormat('@');
    // Final pass: setBackground(null) clears any implicit backgrounds set by setNumberFormat,
    // ensuring banding colours show through uniformly on all columns including Last Updated.
    dataRange.setBackground(null);
  }

  // --- Portal notice ---
  sheet.getRange(1, 1, 1, sheet.getMaxColumns()).breakApart();
  if (hasNoticeRow) {
    // Post-migration: notice spans data columns in row 1 (idempotent — safe to re-run)
    if (dataColCount > 0) {
      _applyNoticeStyle(sheet.getRange(1, 1, 1, dataColCount).merge().setValue(APP_NOTICE));
      sheet.setRowHeight(1, 48);
    }
  } else {
    // Pre-migration: notice to the right of data; clear stale columns first (growing-column fix)
    const maxCols = sheet.getMaxColumns();
    if (dataColCount > 0 && maxCols > dataColCount + 1) {
      sheet.getRange(1, dataColCount + 2, 1, maxCols - dataColCount - 1).clear();
    }
    const rNoticeCol = dataColCount + 2;
    _applyNoticeStyle(sheet.getRange(1, rNoticeCol, 1, 4).merge().setValue(APP_NOTICE));
    sheet.setColumnWidth(rNoticeCol, 320);
    sheet.setRowHeight(1, 48);
  }

  Logger.log(SCHEDULE_SHEET_NAME + ' sheet formatted (' + dataColCount + ' data columns, ' + (hasNoticeRow ? 'post' : 'pre') + '-migration).');
}

function _formatMembersSheet(ss) {
  const sheet = ss.getSheetByName(MEMBERS_SHEET_NAME);
  if (!sheet) { Logger.log('Members sheet not found.'); return; }

  // Auto-detect layout: if row 1 col A is 'Name', headers are in row 1 (pre-migration).
  // Otherwise row 1 is the notice row (post-migration).
  const row1ColA     = _normalizeStr(sheet.getRange(1, 1).getValue());
  const hasNoticeRow = row1ColA !== 'name';
  const headerRow    = hasNoticeRow ? 2 : 1;
  const dataStartRow = hasNoticeRow ? 3 : 2;

  const maxRows        = sheet.getMaxRows();
  const dataRows       = maxRows - dataStartRow + 1;
  const DATA_COL_COUNT = 11; // Members schema: 11 columns (A–K)

  // --- Column widths (positional, matches Members schema order) ---
  [160, 70, 105, 80, 110, 90, 70, 90, 80, 145, 100].forEach(function(w, i) {
    sheet.setColumnWidth(i + 1, w);
  });

  // --- Freeze: notice row + header row if post-migration, otherwise just header row ---
  sheet.setFrozenRows(hasNoticeRow ? 2 : 1);

  // --- Read headers from the correct row for dropdown/checkbox column detection ---
  const headers = sheet.getRange(headerRow, 1, 1, DATA_COL_COUNT).getValues()[0];
  const lower   = headers.map(_normalizeStr);

  // --- Group: dropdown ---
  const groupIdx = lower.indexOf('group');
  if (groupIdx >= 0) {
    sheet.getRange(dataStartRow, groupIdx + 1, dataRows, 1).setDataValidation(_createDropdown(['JAG1', 'JAG2', 'Both', 'Sunday School']));
  }

  // --- Role Type: dropdown ---
  const roleIdx = lower.indexOf('role type');
  if (roleIdx >= 0) {
    sheet.getRange(dataStartRow, roleIdx + 1, dataRows, 1).setDataValidation(_createDropdown(['Adult', 'Student', 'Older Sunday School', 'Harvest']));
  }

  // --- Boolean columns: checkbox ---
  ['can organise', 'can p&w', 'can facilitate', 'can report', 'active', 'can drive'].forEach(function(name) {
    const idx = lower.indexOf(name);
    if (idx >= 0) {
      sheet.getRange(dataStartRow, idx + 1, dataRows, 1)
        .setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
    }
  });

  // --- Alternating row colours ---
  sheet.getBandings().forEach(function(b) { b.remove(); });
  sheet.getRange(dataStartRow, 1, dataRows, DATA_COL_COUNT).clearFormat();
  sheet.getRange(dataStartRow, 1, dataRows, DATA_COL_COUNT)
    .applyRowBanding()
    .setFirstRowColor('#f5f3ff')
    .setSecondRowColor('#ffffff');

  // --- Portal notice ---
  sheet.getRange(1, 1, 1, sheet.getMaxColumns()).breakApart();
  if (hasNoticeRow) {
    // Post-migration: notice spans data columns in row 1 (idempotent — safe to re-run)
    _applyNoticeStyle(sheet.getRange(1, 1, 1, DATA_COL_COUNT).merge().setValue(APP_NOTICE));
    sheet.setRowHeight(1, 48);
  } else {
    // Pre-migration: notice to the right of data; clear stale columns first (growing-column fix)
    const mMaxCols = sheet.getMaxColumns();
    if (mMaxCols > DATA_COL_COUNT + 1) {
      sheet.getRange(1, DATA_COL_COUNT + 2, 1, mMaxCols - DATA_COL_COUNT - 1).clear();
    }
    const mNoticeCol = DATA_COL_COUNT + 2;
    _applyNoticeStyle(sheet.getRange(1, mNoticeCol, 1, 4).merge().setValue(APP_NOTICE));
    sheet.setColumnWidth(mNoticeCol, 320);
    sheet.setRowHeight(1, 48);
  }

  // --- Last Updated: header note ---
  const luIdx = lower.indexOf('last updated');
  if (luIdx >= 0) {
    sheet.getRange(headerRow, luIdx + 1).setNote('Auto-stamped on every save — do not edit.');
    sheet.getRange(dataStartRow, luIdx + 1, dataRows, 1)
      .setNumberFormat('dd/mm/yyyy hh:mm')
      .clearDataValidations(); // prevent checkbox inherited from adjacent column
  }

  // --- Birthday: plain text format ---
  const bdayIdx = lower.indexOf('birthday');
  if (bdayIdx >= 0) {
    sheet.getRange(dataStartRow, bdayIdx + 1, dataRows, 1).setNumberFormat('@');
  }

  Logger.log('Members sheet formatted (' + DATA_COL_COUNT + ' data columns, ' + (hasNoticeRow ? 'post' : 'pre') + '-migration).');
}

function _formatLyricsSheet(ss) {
  const sheet = ss.getSheetByName(LYRICS_SHEET_NAME);
  if (!sheet) { Logger.log('Lyrics sheet not found.'); return; }

  const DATA_COL_COUNT = 3; // Lyrics schema: 3 columns (A–C)
  const dataStartRow   = 2;
  const maxRows        = sheet.getMaxRows();
  const dataRows       = Math.max(1, maxRows - dataStartRow + 1);

  // --- Column widths ---
  [280, 90, 145].forEach(function(w, i) { sheet.setColumnWidth(i + 1, w); });

  // --- Freeze header row ---
  sheet.setFrozenRows(1);

  // --- Header row: bold + background to match other sheets ---
  sheet.getRange(1, 1, 1, DATA_COL_COUNT)
    .setFontWeight('bold')
    .setBackground('#ede9fe');

  // --- Last Updated: header note + datetime format ---
  const headers = sheet.getRange(1, 1, 1, DATA_COL_COUNT).getValues()[0];
  const lower   = headers.map(_normalizeStr);
  const luIdx   = lower.indexOf('last updated');
  if (luIdx >= 0) {
    sheet.getRange(1, luIdx + 1).setNote('Auto-stamped on every save — do not edit.');
    sheet.getRange(dataStartRow, luIdx + 1, dataRows, 1)
      .setNumberFormat('dd/mm/yyyy hh:mm');
  }

  // --- Alternating row colours ---
  sheet.getBandings().forEach(function(b) { b.remove(); });
  sheet.getRange(dataStartRow, 1, dataRows, DATA_COL_COUNT).clearFormat();
  sheet.getRange(dataStartRow, 1, dataRows, DATA_COL_COUNT)
    .applyRowBanding()
    .setFirstRowColor('#f5f3ff')
    .setSecondRowColor('#ffffff');

  Logger.log('Lyrics sheet formatted.');
}

