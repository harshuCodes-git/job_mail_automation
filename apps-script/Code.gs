/**
 * Google Apps Script web app — the API between the Google Sheet and the
 * job-mail-automation Node server.
 *
 * GET  → returns all rows as JSON
 * POST { sr_no, email, status } → finds the row by Sr no + Email, sets Status
 *
 * Deploy: Apps Script editor → Deploy → New deployment → Web app
 *   Execute as: Me
 *   Who has access: Anyone
 * Copy the /exec URL into your .env as GOOGLE_SHEET_API.
 *
 * Optional: set REQUIRED_TOKEN below to lock down access.
 */

// Leave empty to skip token validation; set a string to require ?token= / body.token
var REQUIRED_TOKEN = '';

// ---------- helpers ----------

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function checkToken(e) {
  if (!REQUIRED_TOKEN) return true;
  var param = (e.parameter && e.parameter.token) || '';
  if (param === REQUIRED_TOKEN) return true;
  // Also check POST body
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.token === REQUIRED_TOKEN) return true;
  } catch (_) {}
  return false;
}

// ---------- GET: read all rows ----------

function doGet(e) {
  if (!checkToken(e)) {
    return jsonResponse({ success: false, error: 'unauthorized' });
  }

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var data = sheet.getDataRange().getValues();

  if (data.length < 2) {
    return jsonResponse({ success: true, count: 0, data: [] });
  }

  var headers = data[0].map(function (h) { return String(h).trim(); });
  var rows = [];

  for (var i = 1; i < data.length; i++) {
    var row = {};
    for (var j = 0; j < headers.length; j++) {
      row[headers[j]] = data[i][j] !== undefined ? String(data[i][j]).trim() : '';
    }
    // Skip completely empty rows
    if (!row['Email'] && !row['Name'] && !row['Sr no']) continue;
    rows.push(row);
  }

  return jsonResponse({ success: true, count: rows.length, data: rows });
}

// ---------- POST: update status ----------

function doPost(e) {
  if (!checkToken(e)) {
    return jsonResponse({ success: false, error: 'unauthorized' });
  }

  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse({ success: false, error: 'Invalid JSON body' });
  }

  var srNo   = String(body.sr_no || '').trim();
  var email  = String(body.email || '').trim().toLowerCase();
  var status = String(body.status || '').trim();

  if (!srNo || !email || !status) {
    return jsonResponse({ success: false, error: 'Missing sr_no, email, or status' });
  }

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var data = sheet.getDataRange().getValues();
  var headers = data[0].map(function (h) { return String(h).trim(); });

  var srCol     = headers.indexOf('Sr no');
  var emailCol  = headers.indexOf('Email');
  var statusCol = headers.indexOf('Status');

  if (srCol === -1 || emailCol === -1 || statusCol === -1) {
    return jsonResponse({
      success: false,
      error: 'Sheet must have columns: Sr no, Email, Status. Found: ' + headers.join(', ')
    });
  }

  for (var i = 1; i < data.length; i++) {
    var rowSr    = String(data[i][srCol]).trim();
    var rowEmail = String(data[i][emailCol]).trim().toLowerCase();

    if (rowSr === srNo && rowEmail === email) {
      // Sheet rows are 1-indexed, and row 0 is headers → data row i is sheet row i+1
      sheet.getRange(i + 1, statusCol + 1).setValue(status);
      return jsonResponse({ success: true, updated: { sr_no: srNo, email: email, status: status } });
    }
  }

  return jsonResponse({ success: false, error: 'Row not found for sr_no=' + srNo + ', email=' + email });
}
