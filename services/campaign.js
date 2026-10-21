'use strict';

const fs = require('fs');
const path = require('path');

const config = require('../config');
const sheet = require('./googleSheet');
const mailer = require('./mailer');
const { processBounces } = require('./bounces');

// templates/email.html and templates/email.txt are your own content and are
// git-ignored (like .env). Copy the matching .example file and customize it.
function tpl(name) {
  const file = path.join(__dirname, '..', 'templates', name);
  if (fs.existsSync(file)) {
    return fs.readFileSync(file, 'utf8');
  }
  const fallback = path.join(__dirname, '..', 'templates', name.replace(/(\.\w+)$/, '.example$1'));
  if (fs.existsSync(fallback)) {
    return fs.readFileSync(fallback, 'utf8');
  }
  throw new Error(`templates/${name} not found.`);
}
const HTML_TEMPLATE = tpl('email.html');
const TEXT_TEMPLATE = tpl('email.txt');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Greeting/subject use the first name only ("Anurag Sharma" -> "Anurag").
function firstName(name) {
  return (name || '').trim().split(/\s+/)[0] || 'there';
}

function render(str, contact) {
  return str
    .replace(/\{\{\s*name\s*\}\}/g, firstName(contact.name))
    .replace(/\{\{\s*fullname\s*\}\}/g, contact.name || firstName(contact.name))
    .replace(/\{\{\s*email\s*\}\}/g, contact.email)
    .replace(/\{\{\s*(?:job_)?title\s*\}\}/g, contact.title || 'your team')
    .replace(/\{\{\s*company\s*\}\}/g, contact.company || 'your company');
}

function isSendable(status) {
  const s = status.toLowerCase();
  if (s === 'pending' || s === '') return true;
  if (config.campaign.retryFailed && s === 'failed') return true;
  return false;
}

/**
 * Runs one campaign pass.
 * @param {object} [opts]
 * @param {boolean} [opts.dryRun]  override config.campaign.dryRun
 * @param {number}  [opts.limit]   override config.campaign.batchSize
 */
async function runCampaign(opts = {}) {
  const dryRun = opts.dryRun ?? config.campaign.dryRun;
  const limit = opts.limit ?? config.campaign.batchSize;
  const startedAt = new Date();

  if (!dryRun) await mailer.verifyTransport();

  const { contacts } = await sheet.getContacts();

  const summary = {
    startedAt: startedAt.toISOString(),
    dryRun,
    totalRows: contacts.length,
    considered: 0,
    sent: 0,
    failed: 0,
    skippedDuplicate: 0,
    skippedInvalidEmail: 0,
    results: [],
  };

  if (!contacts.length) {
    summary.finishedAt = new Date().toISOString();
    summary.note = 'Sheet has no data rows.';
    return summary;
  }

  // Reconcile earlier sends against bounce notices before sending more. Never
  // let an inbox/IMAP problem abort or hang the campaign.
  if (!dryRun && config.campaign.processBounces) {
    try {
      const timeout = new Promise((_, rej) =>
        setTimeout(() => rej(new Error('bounce scan timed out after 120s')), 120000)
      );
      summary.bounces = await Promise.race([processBounces({ contacts }), timeout]);
    } catch (err) {
      summary.bounces = { error: (err && err.message) || String(err) };
    }
  }

  // Best-effort status write: never let a sheet-update failure abort the run or
  // undo a successful send. Returns null on success, or the error message.
  async function writeStatus(contact, status) {
    if (dryRun) return null;
    try {
      await sheet.updateStatus(contact, status);
      return null;
    } catch (err) {
      return (err && err.message) || String(err);
    }
  }

  const seenEmails = new Set();
  let processed = 0;

  for (const contact of contacts) {
    if (processed >= limit) break;
    if (!isSendable(contact.status)) continue;

    summary.considered += 1;
    const base = { srNo: contact.srNo, email: contact.email };
    const key = contact.email.toLowerCase();

    if (!EMAIL_RE.test(contact.email)) {
      summary.skippedInvalidEmail += 1;
      const writeErr = contact.email ? await writeStatus(contact, 'Failed') : 'no email to match row';
      summary.results.push({ ...base, outcome: 'invalid-email', writeErr: writeErr || undefined });
      continue;
    }

    if (seenEmails.has(key)) {
      summary.skippedDuplicate += 1;
      const writeErr = await writeStatus(contact, 'Skipped');
      summary.results.push({ ...base, outcome: 'duplicate', writeErr: writeErr || undefined });
      continue;
    }
    seenEmails.add(key);
    processed += 1;

    const subject = render(config.campaign.subjectTemplate, contact);
    const html = render(HTML_TEMPLATE, contact);
    const text = render(TEXT_TEMPLATE, contact);

    if (dryRun) {
      summary.sent += 1;
      summary.results.push({ ...base, outcome: 'dry-run', subject });
    } else {
      try {
        const info = await mailer.sendMail({ to: contact.email, subject, html, text });
        summary.sent += 1;
        const writeErr = await writeStatus(contact, 'Sent');
        summary.results.push({
          ...base,
          outcome: writeErr ? 'sent-unrecorded' : 'sent',
          messageId: info.messageId,
          writeErr: writeErr || undefined,
        });
      } catch (err) {
        summary.failed += 1;
        const msg = (err && err.message) || String(err);
        const writeErr = await writeStatus(contact, 'Failed');
        summary.results.push({ ...base, outcome: 'failed', error: msg, writeErr: writeErr || undefined });
      }
    }

    if (processed < limit) await sleep(config.campaign.sendDelayMs);
  }

  summary.finishedAt = new Date().toISOString();
  summary.durationMs = Date.now() - startedAt.getTime();
  return summary;
}

module.exports = { runCampaign };
