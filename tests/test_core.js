// Minimal, dependency-free smoke tests for CarnCal's pure/extractable
// logic. Run with: node tests/test_core.js
//
// app.js is written as browser globals (no exports), so these tests
// re-implement the exact same logic inline rather than importing it.
// If you change escapeHtml/csvEscape/isValidBackup in app.js, mirror the
// change here so the tests keep meaning something.

const assert = require('assert');

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function csvEscape(v) {
    const s = (v === null || v === undefined) ? '' : String(v);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
}

function isValidBackup(data) {
    if (!data || typeof data !== 'object') return false;
    if (!Array.isArray(data.history) || !Array.isArray(data.drugs)) return false;
    const recOk = data.history.every(r => r && typeof r === 'object' && typeof r.id === 'string');
    const drugOk = data.drugs.every(d => d && typeof d.name === 'string' && isFinite(d.dose) && isFinite(d.conc));
    return recOk && drugOk;
}

function isValidLatLon(lat, lon) {
    return isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

let passed = 0;
function test(name, fn) {
    try {
        fn();
        console.log(`  ok - ${name}`);
        passed++;
    } catch (err) {
        console.error(`  FAIL - ${name}`);
        console.error(`    ${err.message}`);
        process.exitCode = 1;
    }
}

console.log('escapeHtml');
test('escapes script tags', () => {
    assert.strictEqual(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
});
test('escapes quotes used to break out of attributes', () => {
    assert.strictEqual(escapeHtml(`"><img src=x onerror=alert(1)>`), '&quot;&gt;&lt;img src=x onerror=alert(1)&gt;');
});
test('passes through plain text unchanged', () => {
    assert.strictEqual(escapeHtml('Ketamine 4mg/kg'), 'Ketamine 4mg/kg');
});
test('handles null/undefined safely', () => {
    assert.strictEqual(escapeHtml(null), '');
    assert.strictEqual(escapeHtml(undefined), '');
});

console.log('csvEscape');
test('quotes fields containing commas', () => {
    assert.strictEqual(csvEscape('Down, then recovered'), '"Down, then recovered"');
});
test('doubles internal quotes', () => {
    assert.strictEqual(csvEscape('Said "stable" at 10:05'), '"Said ""stable"" at 10:05"');
});
test('leaves plain fields unquoted', () => {
    assert.strictEqual(csvEscape('IM'), 'IM');
});

console.log('isValidBackup');
test('accepts a well-formed backup', () => {
    assert.strictEqual(isValidBackup({
        history: [{ id: 'T-104', date: '2026-01-01' }],
        drugs: [{ name: 'Ketamine', dose: 4, conc: 100 }]
    }), true);
});
test('rejects missing history/drugs arrays', () => {
    assert.strictEqual(isValidBackup({ foo: 'bar' }), false);
    assert.strictEqual(isValidBackup({ history: [], drugs: 'not-an-array' }), false);
});
test('rejects malformed drug entries', () => {
    assert.strictEqual(isValidBackup({ history: [], drugs: [{ name: 'X' }] }), false);
});
test('rejects null/non-object input', () => {
    assert.strictEqual(isValidBackup(null), false);
    assert.strictEqual(isValidBackup('a string'), false);
});

console.log('isValidLatLon (GPS range check)');
test('accepts a real-world coordinate', () => {
    assert.strictEqual(isValidLatLon(22.5, 80.0), true); // Kanha area
});
test('rejects out-of-range latitude', () => {
    assert.strictEqual(isValidLatLon(999, 80.0), false);
});
test('rejects NaN/Infinity', () => {
    assert.strictEqual(isValidLatLon(NaN, 80.0), false);
    assert.strictEqual(isValidLatLon(22.5, Infinity), false);
});

console.log(`\n${passed} test(s) passed.`);
