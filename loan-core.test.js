'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { calculate, calculateWithPrepayments, validateInputs } = require('../loan-core.js');
const close = (a, b, tolerance = 0.02) => assert.ok(Math.abs(a - b) <= tolerance, `${a} differs from ${b}`);

test('valid loan inputs are accepted', () => assert.equal(validateInputs({ principal: 5000000, annualRate: 8.75, months: 240 }).valid, true));
test('rejects NaN principal', () => assert.equal(validateInputs({ principal: 'abc', annualRate: 8, months: 120 }).valid, false));
test('rejects empty principal', () => assert.equal(validateInputs({ principal: '', annualRate: 8, months: 120 }).valid, false));
test('rejects negative principal', () => assert.equal(validateInputs({ principal: -1, annualRate: 8, months: 120 }).valid, false));
test('rejects principal above safety ceiling', () => assert.equal(validateInputs({ principal: 1e13, annualRate: 8, months: 120 }).valid, false));
test('rejects negative interest rate', () => assert.equal(validateInputs({ principal: 1e5, annualRate: -1, months: 120 }).valid, false));
test('rejects excessive interest rate', () => assert.equal(validateInputs({ principal: 1e5, annualRate: 101, months: 120 }).valid, false));
test('rejects fractional tenure', () => assert.equal(validateInputs({ principal: 1e5, annualRate: 8, months: 12.5 }).valid, false));
test('rejects zero tenure', () => assert.equal(validateInputs({ principal: 1e5, annualRate: 8, months: 0 }).valid, false));
test('rejects tenure above 1200 months', () => assert.equal(validateInputs({ principal: 1e5, annualRate: 8, months: 1201 }).valid, false));
test('calculates benchmark EMI accurately', () => close(calculate(5000000, 8.75, 240).emi, 44185.53544547, 0.0001));
test('calculates benchmark interest accurately', () => close(calculate(5000000, 8.75, 240).totalInterest, 5604528.5069, 0.01));
test('repayment equals principal plus interest', () => { const x = calculate(5000000, 8.75, 240); close(x.totalPayment, 5000000 + x.totalInterest); });
test('zero-rate loan has no interest', () => { const x = calculate(120000, 0, 12); close(x.emi, 10000); close(x.totalInterest, 0); });
test('zero principal produces no rows', () => { const x = calculate(0, 8, 120); assert.equal(x.rows.length, 0); assert.equal(x.totalPayment, 0); });
test('negative values are bounded safely', () => { const x = calculate(-100, -5, -10); assert.equal(x.emi, 0); assert.equal(x.months, 0); });
test('very long supported tenure remains finite', () => { const x = calculate(1e7, 30, 1200); assert.ok(Number.isFinite(x.emi)); assert.ok(x.rows.length <= 1200); });
test('schedule principal sums to original principal', () => { const x = calculate(750000, 11.25, 84); close(x.rows.reduce((s, r) => s + r.principal, 0), 750000); });
test('schedule closes at zero', () => assert.ok(calculate(750000, 11.25, 84).rows.at(-1).closing <= 0.005));
test('each row satisfies opening minus principal equals closing', () => { const x = calculate(900000, 9.2, 96); for (const r of x.rows) close(r.opening - r.principal, r.closing); });
test('prepayment reduces interest', () => { const base = calculate(5000000, 8.75, 240); const extra = calculateWithPrepayments(5000000, 8.75, 240, [{ month: 36, amount: 200000 }]); assert.ok(extra.totalInterest < base.totalInterest); });
test('prepayment shortens tenure', () => { const base = calculate(5000000, 8.75, 240); const extra = calculateWithPrepayments(5000000, 8.75, 240, [{ month: 36, amount: 200000 }]); assert.ok(extra.months < base.months); });
test('prepayment principal conservation holds', () => { const x = calculateWithPrepayments(5000000, 8.75, 240, [{ month: 36, amount: 200000 }]); close(x.totalPrincipal, 5000000); });
test('prepayment fee is included in total outflow', () => { const x = calculateWithPrepayments(200000, 0, 24, [{ month: 2, amount: 10000 }], 2); close(x.totalPayment, x.totalPrincipal + x.totalInterest + x.totalFees); close(x.totalFees, 200); });
test('prepayment cannot exceed outstanding balance', () => { const x = calculateWithPrepayments(100000, 0, 120, [{ month: 1, amount: 999999 }]); assert.equal(x.rows[0].closing, 0); close(x.totalPrincipal, 100000); });
test('multiple same-month prepayments are aggregated safely', () => { const x = calculateWithPrepayments(100000, 0, 12, [{ month: 1, amount: 10000 }, { month: 1, amount: 5000 }]); close(x.rows[0].extra, 15000); });
test('invalid prepayment entries are ignored safely', () => { const x = calculateWithPrepayments(100000, 0, 12, [null, {}, { month: 'x', amount: 5 }, { month: 1, amount: -50 }]); assert.equal(x.totalFees, 0); close(x.totalPrincipal, 100000); });
test('non-array prepayment input does not crash', () => { const x = calculateWithPrepayments(100000, 0, 12, null); close(x.totalPrincipal, 100000); });
test('late prepayment after closure is reported unapplied', () => { const x = calculateWithPrepayments(1200, 0, 1, [{ month: 3, amount: 500 }]); assert.equal(x.appliedEvents, 0); assert.equal(x.unappliedEvents, 1); });
test('event month and amount do not create non-finite outputs', () => { const x = calculateWithPrepayments(100000, 12, 24, [{ month: Infinity, amount: NaN }]); assert.ok(x.rows.every(r => Object.values(r).every(v => typeof v !== 'number' || Number.isFinite(v)))); });
test('penalty callback receives event context', () => { let seen = false; calculateWithPrepayments(100000, 0, 12, [{ month: 1, amount: 1000 }], ctx => { if (ctx.month === 1) seen = ctx.extra === 1000; return 1; }); assert.equal(seen, true); });
test('penalty rate is bounded to prevent negative or extreme fees', () => { const x = calculateWithPrepayments(100000, 0, 12, [{ month: 1, amount: 1000 }], 1000); close(x.totalFees, 1000); });
test('standard reference prepayment produces 222 payments', () => { const x = calculateWithPrepayments(5000000, 8.75, 240, [{ month: 36, amount: 200000 }]); assert.equal(x.months, 222); });

test('bundled lender catalogue covers all four loan categories', () => {
  const catalogue = require('../banks.json');
  assert.deepEqual(Object.keys(catalogue).sort(), ['auto', 'education', 'home', 'personal']);
  for (const offers of Object.values(catalogue)) assert.ok(offers.length >= 3);
});
test('catalogue rates and names are valid', () => {
  const catalogue = require('../banks.json');
  for (const offers of Object.values(catalogue)) for (const offer of offers) {
    assert.ok(typeof offer.name === 'string' && offer.name.length > 0);
    assert.ok(Number.isFinite(offer.rate) && offer.rate > 0 && offer.rate <= 30);
  }
});
test('official lender URLs use HTTP or HTTPS only', () => {
  const catalogue = require('../banks.json');
  for (const offers of Object.values(catalogue)) for (const offer of offers) {
    if (offer.source && offer.source !== '#comparison') assert.match(offer.source, /^https?:\/\//i);
  }
});
test('UI escapes untrusted lender strings before HTML insertion', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync(require.resolve('../script.js'), 'utf8');
  assert.match(source, /const escapeHTML =/);
  assert.match(source, /escapeHTML\(bank\.name\)/);
  assert.match(source, /safeExternalURL\(bank\.source\)/);
});
test('static app references local calculation module before UI script', () => {
  const fs = require('node:fs');
  const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  assert.ok(html.indexOf('src="loan-core.js"') < html.indexOf('src="script.js"'));
});

test('embedded offline catalogue matches banks.json exactly', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync(require.resolve('../script.js'), 'utf8');
  const match = source.match(/let loanCatalog = JSON\.parse\(String\.raw`([\s\S]*?)`\);/);
  assert.ok(match, 'embedded catalogue must exist for offline use');
  assert.deepEqual(JSON.parse(match[1]), require('../banks.json'));
});
