#!/usr/bin/env node
/*
 * Bulk-load existing sub-accounts into the onboarding system.
 *
 *   node tools/backfill.js customers.csv --api https://onboarding-widget.onrender.com --key <ADMIN_KEY> [--create] [--complete] [--limit 20]
 *
 * CSV header (first row): locationId,email,name
 *   locationId  required: the sub-account's Location ID
 *   email       the email used on the order form (used to find the existing contact and opportunity)
 *   name        business name (only used when --create makes a new contact)
 *
 * Flags
 *   --create    if no existing opportunity is found, create a contact + opportunity (needs START_STAGE_ID on the server)
 *   --complete  treat the customer as already onboarded: tick all steps and move the opportunity to the last stage
 *   --limit N   only process the first N rows (try 5 first)
 *
 * Writes backfill-report.csv next to the input file. Safe to run again: already-linked rows are skipped over.
 */
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--') && fs.existsSync(a));
const flag = n => args.includes('--' + n);
const val = n => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : undefined; };

const API = (val('api') || process.env.API_BASE || '').replace(/\/$/, '');
const KEY = val('key') || process.env.ADMIN_KEY;
const limit = val('limit') ? Number(val('limit')) : Infinity;

if (!file || !API || !KEY) {
    console.error('Usage: node tools/backfill.js customers.csv --api <https://your-service.onrender.com> --key <ADMIN_KEY> [--create] [--complete] [--limit N]');
    process.exit(1);
}

function parseCsv(text) {
    const rows = [];
    let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (q) {
            if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
            else if (c === '"') q = false;
            else cur += c;
        } else if (c === '"') q = true;
        else if (c === ',') { row.push(cur); cur = ''; }
        else if (c === '\n' || c === '\r') {
            if (c === '\r' && text[i + 1] === '\n') i++;
            row.push(cur); cur = '';
            if (row.some(x => x.trim() !== '')) rows.push(row);
            row = [];
        } else cur += c;
    }
    row.push(cur);
    if (row.some(x => x.trim() !== '')) rows.push(row);
    return rows;
}

const csvCell = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';

(async () => {
    const table = parseCsv(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    const head = table.shift().map(h => h.trim());
    const col = n => head.findIndex(h => h.toLowerCase() === n.toLowerCase());
    const iLoc = col('locationId'), iEmail = col('email'), iName = col('name');
    if (iLoc < 0) { console.error('CSV needs a "locationId" column in the header row'); process.exit(1); }

    const rows = table.slice(0, limit).map(r => ({
        locationId: (r[iLoc] || '').trim(),
        email: iEmail >= 0 ? (r[iEmail] || '').trim() : '',
        name: iName >= 0 ? (r[iName] || '').trim() : ''
    }));
    console.log(`Processing ${rows.length} rows (create=${flag('create')}, complete=${flag('complete')})`);

    const report = [];
    const counts = {};
    for (let i = 0; i < rows.length; i += 20) {
        const batch = rows.slice(i, i + 20);
        let results;
        try {
            const r = await fetch(API + '/admin/backfill', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-admin-key': KEY },
                body: JSON.stringify({ rows: batch, create: flag('create'), complete: flag('complete') })
            });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            results = (await r.json()).results;
        } catch (e) {
            results = batch.map(b => ({ locationId: b.locationId, email: b.email, result: 'request_failed', detail: e.message }));
        }
        for (const x of results) {
            report.push(x);
            counts[x.result] = (counts[x.result] || 0) + 1;
        }
        console.log(`  ${Math.min(i + 20, rows.length)}/${rows.length} done`);
    }

    const out = path.join(path.dirname(path.resolve(file)), 'backfill-report.csv');
    const lines = ['locationId,email,result,opportunityId,detail'].concat(
        report.map(x => [x.locationId, x.email, x.result, x.opportunityId, x.detail].map(csvCell).join(',')));
    fs.writeFileSync(out, lines.join('\n') + '\n');
    console.log('\nSummary:', counts);
    console.log('Report written to', out);
})();