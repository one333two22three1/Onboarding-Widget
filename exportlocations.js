#!/usr/bin/env node
/*
 * Export every sub-account (Location ID, email, business name) to customers.csv.
 *
 *   node tools/export-locations.js --token <AGENCY_TOKEN> --company <COMPANY_ID> [--out customers.csv]
 *
 * Needs an AGENCY-level token with the locations.readonly scope (the sub-account token used by the backend cannot list other
 * sub-accounts). Company ID is shown in Agency Settings -> Company.
 * If your Sub-Accounts page already offers a CSV export, you can use that instead and just rename the columns to
 * locationId,email,name.
 */
const fs = require('fs');

const args = process.argv.slice(2);
const val = n => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : undefined; };
const token = val('token') || process.env.AGENCY_TOKEN;
const company = val('company') || process.env.COMPANY_ID;
const out = val('out') || 'customers.csv';

if (!token || !company) {
    console.error('Usage: node tools/export-locations.js --token <AGENCY_TOKEN> --company <COMPANY_ID> [--out customers.csv]');
    process.exit(1);
}

const cell = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';

(async () => {
    const all = [];
    for (let skip = 0; ; skip += 100) {
        const q = new URLSearchParams({ companyId: company, limit: '100', skip: String(skip) });
        const r = await fetch('https://services.leadconnectorhq.com/locations/search?' + q, {
            headers: { Authorization: `Bearer ${token}`, Version: '2021-07-28', Accept: 'application/json' }
        });
        const body = await r.json().catch(() => ({}));
        if (!r.ok) {
            console.error('GHL error', r.status, JSON.stringify(body));
            process.exit(1);
        }
        const page = body.locations || [];
        all.push(...page);
        console.log(`fetched ${all.length}`);
        if (page.length < 100) break;
    }
    const lines = ['locationId,email,name'].concat(all.map(l => [l.id, l.email, l.name].map(cell).join(',')));
    fs.writeFileSync(out, lines.join('\n') + '\n');
    console.log(`Wrote ${all.length} sub-accounts to ${out}`);
})();