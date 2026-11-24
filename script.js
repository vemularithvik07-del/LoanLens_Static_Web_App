/* LoanLens — static client-side loan advisor.
   Financial calculations live in loan-core.js; lender figures are references, not personalised quotations. */
'use strict';

const $ = (id) => document.getElementById(id);
const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));
const safeExternalURL = (value) => {
  try { const url = new URL(String(value), window.location.href); return ['http:', 'https:'].includes(url.protocol) ? url.href : '#'; }
  catch { return '#'; }
};
function recordLocalAudit(action, details = {}) {
  try {
    const key = 'loanlens.audit.v1';
    const entries = JSON.parse(localStorage.getItem(key) || '[]');
    entries.push({ at: new Date().toISOString(), action, details });
    localStorage.setItem(key, JSON.stringify(entries.slice(-100)));
  } catch (error) { console.warn('Local audit log unavailable:', error); }
}
function persistInputs() {
  try {
    localStorage.setItem('loanlens.inputs.v1', JSON.stringify({
      category: $('loanType').value, amount: state.principal, rate: state.rate,
      months: Math.round(state.years * 12), savedAt: new Date().toISOString()
    }));
  } catch (error) { console.warn('Local persistence unavailable:', error); }
}
function saveScenarioLocally() {
  const status = $('serverStatus');
  const button = $('saveScenario');
  if (!status || !button) return;
  button.disabled = true;
  try {
    const payload = {
      id: `LL-${Date.now()}`,
      category: $('loanType').value,
      principal: state.principal,
      annualRate: state.rate,
      months: Math.round(state.years * 12),
      emi: state.emi,
      totalInterest: state.totalInterest,
      totalPayment: state.totalPayment,
      prepayments: prepayments.map(({ month, amount }) => ({ month, amount })),
      createdAt: new Date().toISOString()
    };
    const key = 'loanlens.scenarios.v1';
    const scenarios = JSON.parse(localStorage.getItem(key) || '[]');
    scenarios.unshift(payload);
    localStorage.setItem(key, JSON.stringify(scenarios.slice(0, 50)));
    recordLocalAudit('scenario_saved_locally', { id: payload.id, category: payload.category });
    status.textContent = `Scenario saved in this browser · ${payload.id} · ${new Date(payload.createdAt).toLocaleString()}`;
  } catch (error) {
    status.textContent = `Could not save this scenario in browser storage: ${error.message}`;
  } finally { button.disabled = false; }
}

function restoreInputs() {
  try {
    const saved = JSON.parse(localStorage.getItem('loanlens.inputs.v1') || 'null');
    if (!saved || !['home', 'auto', 'education', 'personal'].includes(saved.category)) return;
    $('loanType').value = saved.category;
    const months = Math.max(12, Math.min(categoryTenureLimits[saved.category], Math.round(Number(saved.months) || 240)));
    $('amountNumber').value = Math.max(100000, Math.min(10000000, Number(saved.amount) || 5000000));
    $('rateNumber').value = Math.max(0, Math.min(30, Number(saved.rate) || 8.75));
    $('tenureMonthsNumber').value = months;
  } catch (error) { console.warn('Saved inputs could not be restored:', error); }
}

const money = (value) => new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', maximumFractionDigits: 0
}).format(Math.max(0, Number(value) || 0));
const compact = (value) => {
  const n = Math.max(0, Number(value) || 0);
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  return money(n);
};
const LIMITS = { amount: [100000, 10000000], rate: [0, 30], tenure: [1, 30] };
const categoryTenureLimits = JSON.parse(String.raw`{"home":360,"auto":84,"education":180,"personal":84}`);
const state = {
  principal: 5000000, rate: 8.75, years: 20, emi: 0,
  rows: [], totalInterest: 0, totalPayment: 0, scenario: null
};
let repaymentChart = null;
let trendChart = null;
let prepayments = [{ id: 1, month: 36, amount: 200000 }];
let nextPrepaymentId = 2;

// Embedded copy of banks.json keeps lender comparisons available offline (including file:// use).
let loanCatalog = JSON.parse(String.raw`{"home":[{"name":"State Bank of India (SBI)","code":"SBI","rate":7.25,"rateLabel":"7.25% p.a. onwards (SBI card rate effective 1 Apr 2026; borrower profile / terms apply)","feePct":0,"feeMin":0,"feeKnown":false,"feeLabel":"Concessions / waivers vary; check the current SBI fee schedule","penaltyPct":0,"penaltyLabel":"Nil prepayment penalty stated in SBI home-loan terms","source":"https://sbi.bank.in/web/interest-rates/interest-rates/loan-schemes-interest-rates/home-loans-interest-rates-current","feeSource":"https://sbi.bank.in/en/web/interest-rates/interest-rates/processing-fees","penaltySource":"https://sbi.bank.in/documents/53471/263971/SBI%2B-%2BCPCR%2BBooklet%2B%28English%29_14.07.2025.pdf/0c820ebc-05f1-55e8-b065-1050d5b25936?download=true&t=1793430786428&version=1.1","type":"published-reference"},{"name":"HDFC Bank","code":"HDFC","rate":8.0,"rateLabel":"8.00% p.a. starting floor; published range 8.00%–13.45% (profile dependent)","feePct":0.5,"feeMin":4000,"feeKnown":true,"feeLabel":"Salaried / self-employed professional: up to 0.50% or ₹4,000, whichever is higher, plus taxes","penaltyPct":0,"penaltyLabel":"Floating individual: nil; fixed/business cases may attract charges","source":"https://homeloans.hdfc.bank.in/housing-loans/home-loans","feeSource":"https://homeloans.hdfc.bank.in/checklist/documents-charges","penaltySource":"https://homeloans.hdfc.bank.in/checklist/documents-charges","type":"published-reference"},{"name":"ICICI Bank","code":"ICICI","rate":8.5,"rateLabel":"8.50% p.a. starting reference; official rate card validity ended 31 Jul 2026 — reconfirm current offer","feePct":0.5,"feeMin":0,"feeKnown":true,"feeLabel":"0.50% of loan amount + applicable taxes (published fee reference)","penaltyPct":0,"penaltyLabel":"Floating adjustable-rate: nil; fixed-rate may attract charges","source":"https://www.icici.bank.in/personal-banking/loans/home-loan/interest-rates","feeSource":"https://www.icici.bank.in/personal-banking/loans/home-loan/service-charges","penaltySource":"https://www.icici.bank.in/personal-banking/loans/home-loan/service-charges","type":"published-reference"},{"name":"Illustrative NBFC (high-rate demo)","code":"NBFC","rate":15.0,"rateLabel":"15.00% p.a. illustrative high-rate lender (demo input, not a real quote)","feePct":2.0,"feeMin":0,"feeKnown":true,"feeLabel":"Illustrative 2% + taxes (demo assumption)","penaltyPct":4,"penaltyLabel":"Illustrative 4% prepayment charge (demo assumption)","source":"#comparison","type":"illustrative"}],"auto":[{"name":"State Bank of India (SBI)","code":"SBI","rate":8.55,"rateLabel":"8.55% p.a. onwards (15 Oct 2026 rate card; score/tenure based)","feePct":0,"feeMin":0,"feeKnown":true,"feeTiers":[{"max":500000,"fee":500},{"max":1000000,"fee":1000},{"max":null,"fee":1500}],"feeLabel":"Salaried new-car schedule: ₹500 / ₹1,000 / ₹1,500 by loan band + GST; non-salaried rates differ","penaltyPct":0,"penaltyLabel":"Nil prepayment charge for the standard new-car loan in the referenced SBI KFS; used-car scheme differs","source":"https://sbi.bank.in/web/interest-rates/interest-rates/loan-schemes-interest-rates/auto-loans","feeSource":"https://sbi.bank.in/en/web/interest-rates/interest-rates/processing-fees","penaltySource":"https://sbi.bank.in/documents/53471/58026269/Key%2BFact%2BStatement%2Bfor%2BAuto%2BLoan-English.pdf/15e58ec1-0600-c6d9-ca9b-15a3d1d2b65f?download=true&t=1776939237236&version=1.0","type":"published-reference"},{"name":"HDFC Bank","code":"HDFC","rate":9.0,"rateLabel":"9.00% p.a. onwards (published rack-rate reference)","feePct":0,"feeFixed":700,"feeKnown":true,"feeLabel":"₹700 documentation charge (published schedule; other charges may apply)","penaltyPct":5,"penaltyLabel":"5% part-prepayment charge in applicable early period; full closure varies by timing","source":"https://www.hdfc.bank.in/car-loan/interest-rates-and-charges","type":"published-reference"},{"name":"ICICI Bank","code":"ICICI","rate":8.4,"rateLabel":"8.40% p.a. onwards (new car >36 months; CIBIL/model based)","feePct":0,"feeMin":0,"feeFixed":8500,"feeKnown":true,"feeLabel":"Up to ₹8,500 + GST for new car; other charges may apply","penaltyPct":3,"penaltyLabel":"Part payment 3% up to 24 months, then nil; foreclosure 3% / 2% / nil by seasoning","source":"https://www.icici.bank.in/personal-banking/loans/car-loan/interest-rate","feeSource":"https://www.icici.bank.in/personal-banking/loans/car-loan/service-charges","type":"published-reference"},{"name":"Illustrative NBFC (high-rate demo)","code":"NBFC","rate":15.0,"rateLabel":"15.00% p.a. illustrative high-rate lender (demo input, not a real quote)","feePct":2.0,"feeMin":0,"feeKnown":true,"feeLabel":"Illustrative 2% + taxes (demo assumption)","penaltyPct":4,"penaltyLabel":"Illustrative 4% prepayment charge (demo assumption)","source":"#comparison","type":"illustrative"}],"education":[{"name":"State Bank of India (SBI)","code":"SBI","rate":9.65,"rateLabel":"9.65% p.a. collateralised student-loan reference; scheme varies","feePct":0,"feeMin":0,"feeKnown":true,"feeTiers":[{"max":1000000,"fee":0},{"max":2000000,"fee":5000},{"max":null,"pct":0.5,"cap":25000}],"feeLabel":"Nil up to ₹10 lakh; ₹5,000 up to ₹20 lakh; above ₹20 lakh 0.50% capped at ₹25,000 + GST","penaltyPct":0,"penaltyLabel":"Check scheme terms; no demo charge assumed","source":"https://sbi.bank.in/web/interest-rates/interest-rates/loan-schemes-interest-rates/education-loan-scheme","feeSource":"https://sbi.bank.in/web/personal-banking/loans/education-loans/student-loan-scheme","type":"published-reference"},{"name":"HDFC Bank","code":"HDFC","rate":10.5,"rateLabel":"10.50% p.a. onwards (published reference)","feePct":1.0,"feeMin":0,"feeFreeBelow":750000,"feeKnown":true,"feeLabel":"Nil up to ₹7.5 lakh; 1% above ₹7.5 lakh + taxes","penaltyPct":0,"penaltyLabel":"Nil prepayment charge in published fee schedule; verify conditions","source":"https://www.hdfc.bank.in/education-loan/interest-rates-and-charges","type":"published-reference"},{"name":"ICICI Bank","code":"ICICI","rate":9.0,"rateLabel":"9.00% p.a. secured domestic starting-rate reference","feePct":2.0,"feeMin":0,"feeAdminPct":0.25,"feeAdminCap":5000,"feeKnown":true,"feeLabel":"Up to 2% + GST; admin charge up to ₹5,000 or 0.25% (whichever is lower)","penaltyPct":0,"penaltyLabel":"No charge assumed in this estimate; verify agreement","source":"https://www.icici.bank.in/personal-banking/loans/education-loan/interest-rates","feeSource":"https://www.icici.bank.in/personal-banking/loans/education-loan/interest-rates","type":"published-reference"},{"name":"Illustrative NBFC (high-rate demo)","code":"NBFC","rate":15.0,"rateLabel":"15.00% p.a. illustrative high-rate lender (demo input, not a real quote)","feePct":2.0,"feeMin":0,"feeKnown":true,"feeLabel":"Illustrative 2% + taxes (demo assumption)","penaltyPct":4,"penaltyLabel":"Illustrative 4% prepayment charge (demo assumption)","source":"#comparison","type":"illustrative"}],"personal":[{"name":"State Bank of India (SBI)","code":"SBI","rate":10.0,"rateLabel":"10.00%–15.00% p.a. published scheme range; model uses 10.00% floor","feePct":1.5,"feeMin":1000,"feeCap":15000,"feeKnown":true,"feeLabel":"Up to 1.50%, minimum ₹1,000 and maximum ₹15,000 + GST","penaltyPct":2,"penaltyLabel":"2% modelled on prepaid amount under referenced SBI KFS; product-specific waivers may apply","source":"https://sbi.bank.in/web/interest-rates/interest-rates/loan-schemes-interest-rates/personal-loans-schemes","feeSource":"https://sbi.bank.in/web/personal-banking/loans/personal-loans/real-time-xpress-credit","penaltySource":"https://sbi.bank.in/documents/53471/58026272/Key%2BFact%2BStatement%2Bfor%2BPersonal%2BLoan-English.pdf/6b2f0a4b-da40-6c40-3ade-d5fa9e58922c?t=1776939214719","type":"published-reference"},{"name":"HDFC Bank","code":"HDFC","rate":10.25,"rateLabel":"10.25% p.a. onwards (published starting reference; profile dependent)","feePct":0,"feeMin":0,"feeFixed":6500,"feeKnown":true,"feeLabel":"Up to ₹6,500 + GST","penaltyPct":4,"penaltyLabel":"4% through 24 EMIs, 3% through 36 EMIs, then 2%; part-payment caps apply","source":"https://www.hdfc.bank.in/personal-loan/interest-rates-and-charges","feeSource":"https://www.hdfc.bank.in/personal-loan/interest-rates-and-charges","penaltySource":"https://www.hdfc.bank.in/personal-loan/interest-rates-and-charges","type":"published-reference"},{"name":"ICICI Bank","code":"ICICI","rate":10.25,"rateLabel":"10.25% p.a. onwards (published starting reference)","feePct":2.0,"feeMin":0,"feeKnown":true,"feeLabel":"Up to 2% + applicable taxes (published reference)","penaltyPct":3,"penaltyLabel":"3% before 24 EMIs; nil after 24 EMIs per published terms","source":"https://www.icici.bank.in/personal-banking/loans/personal-loan/personal-loan-interest-rates","feeSource":"https://www.icici.bank.in/personal-banking/loans/personal-loan/service-charges","penaltySource":"https://www.icici.bank.in/personal-banking/loans/personal-loan/service-charges","type":"published-reference"},{"name":"Illustrative NBFC (high-rate demo)","code":"NBFC","rate":15.0,"rateLabel":"15.00% p.a. illustrative high-rate lender (demo input, not a real quote)","feePct":2.0,"feeMin":0,"feeKnown":true,"feeLabel":"Illustrative 2% + taxes (demo assumption)","penaltyPct":4,"penaltyLabel":"Illustrative 4% prepayment charge (demo assumption)","source":"#comparison","type":"illustrative"}]}`);

// Financial engine is isolated in loan-core.js and independently unit-tested.
const { calculate, calculateWithPrepayments } = window.LoanCore;

function readState() {
  const clamp = (value, min, max, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
  };
  const maxMonths = categoryTenureLimits[$('loanType').value] || 360;
  state.principal = clamp($('amountNumber').value, LIMITS.amount[0], LIMITS.amount[1], state.principal || 5000000);
  state.rate = clamp($('rateNumber').value, LIMITS.rate[0], LIMITS.rate[1], state.rate || 8.75);
  const monthsInput = Number($('tenureMonthsNumber').value);
  const fallbackMonths = Math.round(clamp($('tenureNumber').value, 1, maxMonths / 12, state.years || 20) * 12);
  const months = Math.round(clamp(monthsInput, 12, maxMonths, fallbackMonths));
  state.years = months / 12;
  Object.assign(state, calculate(state.principal, state.rate, months));
}

function syncInputs() {
  $('loanAmount').value = state.principal;
  $('amountNumber').value = state.principal;
  $('amountLabel').textContent = money(state.principal);
  $('interestRate').value = state.rate;
  $('rateNumber').value = state.rate;
  $('rateLabel').textContent = `${state.rate.toFixed(2)}%`;
  const months = Math.round(state.years * 12);
  const maxMonths = categoryTenureLimits[$('loanType').value] || 360;
  $('tenure').max = maxMonths / 12;
  $('tenureNumber').max = maxMonths / 12;
  $('tenureMonthsNumber').max = maxMonths;
  $('tenure').value = state.years;
  $('tenureNumber').value = state.years.toFixed(2).replace(/\.00$/, '');
  $('tenureMonthsNumber').value = months;
  const yearsPart = Math.floor(months / 12), monthsPart = months % 12;
  $('tenureLabel').textContent = monthsPart ? `${yearsPart} yr ${monthsPart} mo` : `${yearsPart} ${yearsPart === 1 ? 'year' : 'years'}`;
}

function prepaymentRuleForOffer(offer, category, event = null) {
  const rateType = $('prepayRateType').value;
  const purpose = $('prepayPurpose').value;
  const source = $('prepaySource').value;
  if (category === 'home') {
    if (offer.code === 'SBI') return { rate: 0, label: 'SBI home-loan reference: nil prepayment penalty; confirm scheme terms.' };
    if (offer.code === 'HDFC' && rateType === 'floating' && purpose === 'individual') return { rate: 0, label: 'HDFC floating-rate loan to an individual: nil charge in the stated eligible case.' };
    if (offer.code === 'HDFC' && rateType === 'fixed' && source === 'own') return { rate: 0, label: 'HDFC fixed-rate own-source exception may apply; verify sanction terms.' };
    if (offer.code === 'HDFC') return { rate: 2, label: 'HDFC fixed/business-purpose case modelled at 2%; verify product clause.' };
    if (offer.code === 'ICICI' && rateType === 'floating') return { rate: 0, label: 'ICICI adjustable-rate home loan: nil charge in eligible cases; verify terms.' };
    if (offer.code === 'ICICI') return { rate: 2, label: 'ICICI fixed-rate home-loan scenario modelled at 2%; verify terms.' };
  }
  if (category === 'auto' && offer.code === 'HDFC' && event) {
    if (event.extra >= event.balanceBeforeExtra - 0.005) {
      return { rate: event.month <= 12 ? 6 : event.month <= 24 ? 5 : 3, label: 'HDFC car-loan foreclosure: modelled at 6% / 5% / 3% by elapsed EMI period.' };
    }
    return { rate: event.month <= 24 ? 5 : 0, label: 'HDFC car-loan part-prepayment: 5% within first 24 months; later terms vary.' };
  }
  if (category === 'auto' && offer.code === 'ICICI' && event) {
    if (event.extra >= event.balanceBeforeExtra - 0.005) return { rate: event.month <= 12 ? 3 : event.month <= 24 ? 2 : 0, label: 'ICICI car-loan foreclosure: 3% through 12 months, 2% through 24 months, then nil.' };
    return { rate: event.month <= 24 ? 3 : 0, label: 'ICICI car-loan part payment: 3% up to 24 months, then nil.' };
  }
  if (category === 'personal' && offer.code === 'ICICI') {
    return { rate: event && event.month <= 24 ? 3 : 0, label: 'ICICI personal loan: 3% modelled before 24 EMIs; nil after 24 EMIs.' };
  }
  if (category === 'personal' && offer.code === 'HDFC') {
    const month = event ? event.month : 1;
    return { rate: month <= 24 ? 4 : month <= 36 ? 3 : 2, label: 'HDFC personal loan: 4% through 24 EMIs, 3% through 36 EMIs, then 2%; part-payment frequency/amount caps are not enforced by this simulator.' };
  }
  if (category === 'personal' && offer.code === 'SBI') {
    return { rate: 2, label: 'SBI personal-loan reference: 2% on prepaid amount before tenure end; eligible scheme waivers may apply.' };
  }
  return { rate: Number(offer.penaltyPct) || 0, label: offer.penaltyLabel || 'Check lender sanction terms; demo assumption applied.' };
}

function getScenario() {
  const category = $('loanType').value;
  const lender = $('prepayLender').value;
  const offer = (loanCatalog[category] || loanCatalog.home).find((item) => item.code === lender) || loanCatalog[category][0];
  const generalRule = prepaymentRuleForOffer(offer, category);
  return {
    ruleLabel: generalRule.label,
    penaltyRate: (event) => prepaymentRuleForOffer(offer, category, event).rate
  };
}

function currentScenario() {
  const rule = getScenario();
  return calculateWithPrepayments(state.principal, state.rate, Math.round(state.years * 12), prepayments, rule.penaltyRate);
}

function drawFallbackCharts(rows) {
  const donut = $('repaymentChart');
  const line = $('repaymentTrendChart');
  if (donut) {
    const ctx = donut.getContext('2d');
    const width = donut.clientWidth || 260;
    const height = donut.clientHeight || 180;
    donut.width = width * devicePixelRatio;
    donut.height = height * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);
    const principal = rows.reduce((sum, row) => sum + row.principal, 0);
    const interest = rows.reduce((sum, row) => sum + row.interest, 0);
    const total = principal + interest || 1;
    const cx = width / 2, cy = height / 2, radius = Math.min(width, height) * 0.38;
    ctx.lineWidth = 18;
    ctx.strokeStyle = '#e7ad62';
    ctx.beginPath(); ctx.arc(cx, cy, radius, -Math.PI / 2, Math.PI * 1.5); ctx.stroke();
    ctx.strokeStyle = '#176b58';
    ctx.beginPath(); ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * principal / total); ctx.stroke();
  }
  if (line) {
    const ctx = line.getContext('2d');
    const width = line.clientWidth || 500;
    const height = line.clientHeight || 230;
    line.width = width * devicePixelRatio;
    line.height = height * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);
    ctx.clearRect(0, 0, width, height);
    const pad = 25;
    const max = Math.max(1, rows.reduce((sum, row) => sum + row.principal + row.interest, 0));
    const step = Math.max(1, Math.ceil(rows.length / 60));
    const p = [], i = []; let cp = 0, ci = 0;
    rows.forEach((row, index) => { cp += row.principal; ci += row.interest; if ((index + 1) % step === 0 || index === rows.length - 1) { p.push(cp); i.push(ci); } });
    const draw = (values, color) => {
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath();
      values.forEach((v, index) => { const x = pad + index * (width - 2 * pad) / Math.max(1, values.length - 1); const y = height - pad - v / max * (height - 2 * pad); if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
      ctx.stroke();
    };
    draw(p, '#176b58'); draw(i, '#d89b45');
  }
}

function drawCharts(rows) {
  if (!window.Chart) {
    $('chartStatus').textContent = 'Chart.js could not load; lightweight canvas charts are displayed instead.';
    drawFallbackCharts(rows);
    return;
  }
  try {
    $('chartStatus').textContent = '';
    if (repaymentChart) repaymentChart.destroy();
    if (trendChart) trendChart.destroy();
    const principal = rows.reduce((sum, row) => sum + row.principal, 0);
    const interest = rows.reduce((sum, row) => sum + row.interest, 0);
    repaymentChart = new Chart($('repaymentChart'), {
      type: 'doughnut',
      data: { labels: ['Principal', 'Interest'], datasets: [{ data: [principal, interest], backgroundColor: ['#176b58', '#e7ad62'], borderWidth: 0, hoverOffset: 4 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '76%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (context) => `${context.label}: ${money(context.raw)}` } } } }
    });
    const labels = [], cumulativePrincipal = [], cumulativeInterest = [];
    let p = 0, i = 0;
    const step = Math.max(1, Math.ceil(rows.length / 60));
    rows.forEach((row, index) => {
      p += row.principal; i += row.interest;
      if ((index + 1) % step === 0 || index === rows.length - 1) {
        labels.push(`Month ${row.month}`); cumulativePrincipal.push(p); cumulativeInterest.push(i);
      }
    });
    trendChart = new Chart($('repaymentTrendChart'), {
      type: 'line',
      data: { labels, datasets: [
        { label: 'Cumulative principal', data: cumulativePrincipal, borderColor: '#176b58', backgroundColor: '#176b5818', fill: true, tension: .25, pointRadius: 0 },
        { label: 'Cumulative interest', data: cumulativeInterest, borderColor: '#d89b45', backgroundColor: '#d89b4518', fill: true, tension: .25, pointRadius: 0 }
      ] },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (context) => `${context.dataset.label}: ${money(context.raw)}` } } }, scales: { y: { ticks: { callback: (value) => compact(value) } } } }
    });
  } catch (error) {
    $('chartStatus').textContent = 'Chart library failed to initialise; canvas fallback charts are displayed.';
    if (repaymentChart) repaymentChart.destroy();
    if (trendChart) trendChart.destroy();
    repaymentChart = null; trendChart = null;
    drawFallbackCharts(rows);
  }
}

function renderSchedule() {
  const scenario = state.scenario || currentScenario();
  const rows = scenario.rows;
  const monthly = $('monthlyView').checked;
  const output = [];
  if (monthly) {
    rows.forEach((row) => output.push(`<tr><td>Month ${row.month}</td><td>${money(row.opening)}</td><td>${money(row.principal)}</td><td>${money(row.interest)}</td><td>${money(row.closing)}</td></tr>`));
  } else {
    for (let index = 0; index < rows.length; index += 12) {
      const group = rows.slice(index, index + 12);
      const first = group[0], last = group[group.length - 1];
      output.push(`<tr><td>Year ${Math.floor(index / 12) + 1}</td><td>${money(first.opening)}</td><td>${money(group.reduce((sum, row) => sum + row.principal, 0))}</td><td>${money(group.reduce((sum, row) => sum + row.interest, 0))}</td><td>${money(last.closing)}</td></tr>`);
    }
  }
  $('scheduleRows').innerHTML = output.join('');
  $('scheduleMeta').textContent = `${rows.length} monthly payments · ${scenario.appliedEvents || 0} extra payment(s) applied · ${money(scenario.totalFees)} estimated prepayment fees`;
}

function processingFee(offer, principal) {
  if (!offer.feeKnown) return null;
  if (Number(offer.feeFreeBelow) > 0 && principal <= Number(offer.feeFreeBelow)) return 0;
  let gross;
  if (Array.isArray(offer.feeTiers) && offer.feeTiers.length) {
    const tier = offer.feeTiers.find((item) => item.max === null || principal <= item.max) || offer.feeTiers[offer.feeTiers.length - 1];
    gross = Number(tier.fee) || (principal * (Number(tier.pct) || 0) / 100);
    if (Number(tier.cap) > 0) gross = Math.min(gross, Number(tier.cap));
  } else {
    const pctFee = principal * (Number(offer.feePct) || 0) / 100;
    const minFee = Number(offer.feeMin) || 0;
    gross = Math.max(pctFee, minFee) + (Number(offer.feeFixed) || 0);
    if (Number(offer.feeCap) > 0) gross = Math.min(gross, Number(offer.feeCap));
  }
  if (Number(offer.feeAdminPct) > 0) gross += Math.min(principal * Number(offer.feeAdminPct) / 100, Number(offer.feeAdminCap) || Infinity);
  return gross;
}

// Stylised inline SVG bank marks (simple badges in each bank's brand colours, not official artwork).
const BANK_LOGOS = {
  SBI: '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="15" fill="#1e6fc2"/><circle cx="16" cy="13" r="4.2" fill="#fff"/><path d="M14.6 16.5h2.8l1.2 8h-5.2z" fill="#fff"/></svg>',
  HDFC: '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="1" y="1" width="30" height="30" rx="6" fill="#004c8f"/><rect x="7" y="7" width="18" height="18" fill="#ed1c24"/><rect x="12" y="12" width="8" height="8" fill="#fff"/></svg>',
  ICICI: '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="15" fill="#f58220"/><circle cx="16" cy="9.5" r="2.6" fill="#ae282e"/><rect x="13.6" y="13.5" width="4.8" height="12" rx="2.4" fill="#ae282e"/></svg>',
  NBFC: '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="1" y="1" width="30" height="30" rx="8" fill="#7c8a85"/><path d="M9 23V9h2.6l8.8 10.2V9H23v14h-2.6L11.6 12.8V23z" fill="#fff"/></svg>'
};
const bankLogo = (code, size = '') => `<span class="bank-logo ${size}" title="${code}">${BANK_LOGOS[code] || code}</span>`;

function renderCostCompare(rows) {
  const box = $('costCompare');
  if (!box) return;
  const costOf = (row) => row.interest + row.prepayFee + (row.fee || 0);
  const sorted = [...rows].sort((a, b) => costOf(a) - costOf(b));
  const low = sorted[0], high = sorted[sorted.length - 1];
  const max = Math.max(...rows.map(costOf), 1);
  const months = Math.round(state.years * 12);
  const base = calculate(state.principal, state.rate, months);
  const edge = calculate(state.principal, Math.max(0, state.rate - 0.25), months);
  const edgeSaving = Math.max(0, base.totalInterest - edge.totalInterest);
  box.innerHTML = `<h4>Total borrowing cost by lender</h4>
    <p class="cost-sub">Interest + processing fee + prepayment charges for your current amount, tenure and prepayment plan (lowest first).</p>
    ${sorted.map((row) => `<div class="cost-row"><span class="cost-name">${bankLogo(row.code, 'small')}${row.code}</span><div class="cost-track"><i class="${row.code === low.code ? 'best' : ''}" style="width:${Math.max(3, costOf(row) / max * 100).toFixed(1)}%"></i></div><b>${compact(costOf(row))}</b></div>`).join('')}
    <div class="cost-verdict"><b>${escapeHTML(low.name)}</b> is modelled ${money(costOf(high) - costOf(low))} cheaper than <b>${escapeHTML(high.name)}</b> over the full loan.</div>
    <div class="cost-verdict edge">Rate edge: a lender charging 0.25% less than your current ${state.rate.toFixed(2)}% would save about <b>${money(edgeSaving)}</b> in interest.</div>`;
}

function renderBanks() {
  const category = $('loanType').value;
  const offers = loanCatalog[category] || loanCatalog.home;
  const rows = offers.map((offer) => {
    const result = calculateWithPrepayments(state.principal, offer.rate, Math.round(state.years * 12), prepayments, (event) => prepaymentRuleForOffer(offer, category, event).rate);
    const fee = processingFee(offer, state.principal);
    const feeText = fee === null ? offer.feeLabel : `${offer.feeLabel} · estimate ${money(fee)} (taxes may apply)`;
    return { ...offer, emi: result.emi, interest: result.totalInterest, fee, feeText, prepayFee: result.totalFees, total: result.totalPayment + (fee || 0), months: result.months };
  });
  $('bankRows').innerHTML = rows.map((bank) => `
    <tr>
      <td><div class="bank-name">${bankLogo(bank.code)}<span>${escapeHTML(bank.name)}<small class="bank-sub">${bank.type === 'illustrative' ? 'Illustrative comparison input' : 'Published reference · verify current offer'}</small>${bank.type === 'illustrative' ? '' : `<a class="bank-source-link" href="${safeExternalURL(bank.source)}" target="_blank" rel="noopener noreferrer">Official product information ↗</a>`}</span></div></td>
      <td><span class="rate">${escapeHTML(bank.rateLabel || `${bank.rate.toFixed(2)}% p.a.`)}</span></td>
      <td>${escapeHTML(bank.feeText)}</td>
      <td>${escapeHTML(bank.penaltyLabel)}<br><small>${money(bank.prepayFee)} estimated charge on current events</small></td>
      <td><b>${money(bank.emi)}</b></td>
      <td><button type="button" class="select-offer" data-rate="${bank.rate}">Use this rate</button></td>
    </tr>`).join('');
  renderCostCompare(rows);
  const known = rows.filter((row) => row.fee !== null);
  const pool = known.length ? known : rows;
  const best = pool.reduce((a, b) => a.total < b.total ? a : b, pool[0]);
  const missing = rows.filter((row) => row.fee === null).map((row) => row.code).join(', ');
  $('bestDeal').innerHTML = `<span class="best-icon">✦</span><div><b>Lowest modelled cost among ${known.length ? 'fee-estimable' : 'rate-only'} offers: ${escapeHTML(best.name)}</b><p>Estimated EMI ${money(best.emi)}; interest ${money(best.interest)}; processing fee ${best.fee === null ? 'not available' : money(best.fee)}; modelled total outflow ${money(best.total)} (includes estimated prepayment charges where applicable). ${missing ? `A complete fee-inclusive ranking is not possible because ${missing} fee data is not fixed/published here.` : ''} Figures are reference inputs, not a personal bank quote.</p></div>`;
  document.querySelectorAll('.select-offer').forEach((button) => {
    button.addEventListener('click', () => {
      setField('rate', Number(button.dataset.rate));
      $('calculator').scrollIntoView({ behavior: 'smooth' });
    });
  });
}

function renderPrepaymentInputs() {
  $('addPrepayment').disabled = prepayments.length >= 12;
  $('prepaymentList').innerHTML = prepayments.map((event, index) => `
    <div class="prepayment-entry" data-id="${event.id}">
      <label>Payment ${index + 1} · month</label>
      <input class="number-input event-month" type="number" min="1" max="${Math.round(state.years * 12)}" value="${event.month}" aria-label="Prepayment ${index + 1} month">
      <label>Amount (₹)</label>
      <input class="number-input event-amount" type="number" min="0" max="${state.principal}" step="10000" value="${event.amount}" aria-label="Prepayment ${index + 1} amount">
      <button type="button" class="remove-prepayment" ${prepayments.length === 1 ? 'disabled' : ''} aria-label="Remove payment ${index + 1}">Remove</button>
    </div>`).join('');
  $('prepaymentList').querySelectorAll('.prepayment-entry').forEach((row) => {
    const id = Number(row.dataset.id);
    const monthInput = row.querySelector('.event-month');
    const amountInput = row.querySelector('.event-amount');
    monthInput.addEventListener('change', (event) => {
      const item = prepayments.find((entry) => entry.id === id);
      if (!item) return;
      item.month = Math.max(1, Math.min(Math.round(state.years * 12), Math.round(Number(event.target.value) || 1)));
      refreshPrepayments();
    });
    amountInput.addEventListener('change', (event) => {
      const item = prepayments.find((entry) => entry.id === id);
      if (!item) return;
      item.amount = Math.max(0, Math.min(state.principal, Number(event.target.value) || 0));
      refreshPrepayments();
    });
    row.querySelector('.remove-prepayment').addEventListener('click', () => {
      if (prepayments.length > 1) {
        prepayments = prepayments.filter((entry) => entry.id !== id);
        refreshPrepayments();
      }
    });
  });
}

function simulatePrepayment() {
  prepayments = prepayments.map((event) => ({
    ...event,
    month: Math.max(1, Math.min(Math.round(state.years * 12), Math.round(Number(event.month) || 1))),
    amount: Math.max(0, Math.min(state.principal, Number(event.amount) || 0))
  }));
  const rule = getScenario();
  const scenario = calculateWithPrepayments(state.principal, state.rate, Math.round(state.years * 12), prepayments, rule.penaltyRate);
  state.scenario = scenario;
  const scenarioPrincipal = scenario.rows.reduce((sum, row) => sum + row.principal, 0);
  $('principalPercent').textContent = `${scenarioPrincipal + scenario.totalInterest > 0 ? (scenarioPrincipal / (scenarioPrincipal + scenario.totalInterest) * 100).toFixed(0) : 0}%`;
  $('legendPrincipal').textContent = compact(scenarioPrincipal);
  $('legendInterest').textContent = compact(scenario.totalInterest);
  const interestSaved = Math.max(0, state.totalInterest - scenario.totalInterest);
  const monthsSaved = Math.max(0, state.rows.length - scenario.months);
  const years = Math.floor(scenario.months / 12);
  const months = scenario.months % 12;
  $('prepayFeeResult').textContent = money(scenario.totalFees);
  $('prepayRuleResult').textContent = rule.ruleLabel;
  $('savedInterest').textContent = money(interestSaved);
  $('monthsSaved').textContent = `${monthsSaved} months`;
  $('newTenure').textContent = `${years} years ${months} months`;
  const firstEvent = prepayments.filter((event) => event.amount > 0).sort((a, b) => a.month - b.month)[0];
  const firstRow = firstEvent ? scenario.rows.find((row) => row.month === firstEvent.month) : null;
  $('balanceAfter').textContent = money(firstRow ? firstRow.closing : (scenario.rows.length ? scenario.rows[scenario.rows.length - 1].closing : 0));
  const percent = state.totalInterest > 0 ? interestSaved / state.totalInterest * 100 : 0;
  $('savingBar').style.width = `${Math.min(100, percent)}%`;
  $('savingPercent').textContent = `${percent.toFixed(1)}%`;
  const foreclosure = scenario.rows.find((row) => row.extra > 0 && row.closing <= 0.005);
  const skippedNote = scenario.unappliedEvents
    ? ` ${scenario.unappliedEvents} planned payment(s) were not applied because the loan had already closed.`
    : '';
  $('foreclosureStatus').textContent = foreclosure
    ? `Full foreclosure in month ${foreclosure.month}. Applied lump sum ${money(foreclosure.extra)}; estimated charge ${money(foreclosure.fee)}. Interest saved ${money(interestSaved)}.${skippedNote}`
    : `Part-prepayment scenario: projected closure in ${years} years ${months} months. Interest saved ${money(interestSaved)}. A lump sum is capped at the actual outstanding balance.${skippedNote}`;
  renderSchedule();
  drawCharts(scenario.rows);
}

function updateTax() {
  const purpose = $('taxPurpose').value;
  const oldRegime = $('taxRegime').value === 'old';
  const year = Math.max(1, Math.min(Math.ceil(state.years), Number($('taxYear').value) || 1));
  const taxRows = (state.scenario && state.scenario.rows) ? state.scenario.rows : state.rows;
  const yearRows = taxRows.slice((year - 1) * 12, year * 12);
  const interest = yearRows.reduce((sum, row) => sum + row.interest, 0);
  const principal = yearRows.reduce((sum, row) => sum + row.principal, 0);
  const qualifies = $('taxQualifies').checked;
  const selfOccupied = $('selfOccupied').checked;
  const educationEligible = $('educationEligible').checked;
  const other80C = Math.max(0, Math.min(150000, Number($('other80C').value) || 0));
  const marginalRate = Math.max(0, Math.min(50, Number($('taxRate').value) || 0)) / 100;
  const homeInterest = purpose === 'home' && oldRegime && qualifies && selfOccupied ? Math.min(interest, 200000) : 0;
  const homePrincipal = purpose === 'home' && oldRegime && qualifies ? Math.min(principal, Math.max(0, 150000 - other80C)) : 0;
  const educationInterest = purpose === 'education' && oldRegime && qualifies && educationEligible && year <= 8 ? interest : 0;
  const totalDeduction = homeInterest + homePrincipal + educationInterest;
  const estimatedSaving = totalDeduction * marginalRate * 1.04;
  $('taxInterest').textContent = money(homeInterest);
  $('taxPrincipal').textContent = money(homePrincipal);
  $('taxEducation').textContent = money(educationInterest);
  $('taxSaving').textContent = money(estimatedSaving);
  const regimeNote = oldRegime ? '' : 'New tax regime selected: Sections 80C, 80E and the self-occupied Section 24(b) deduction are generally not available, so deductions show as zero; switch to the old regime to compare. ';
  $('taxNote').textContent = `${regimeNote}Repayment year ${year}: indicative deductions ${money(totalDeduction)} and estimated tax reduction ${money(estimatedSaving)} (includes an approximate 4% cess on the selected marginal-rate estimate). Home interest uses Section 24(b), subject to property/loan conditions; home principal uses the shared Section 80C ₹1.5 lakh ceiling; qualifying higher-education interest uses Section 80E for up to 8 consecutive assessment years. These are simplified estimates, not tax advice. The SRS mentions Section 24 for education loans, but Section 80E is the relevant education-loan interest provision. Verify the applicable assessment-year rules.`;
}

function updateExtras() {
  const annualInflation = Math.max(0, Math.min(20, Number($('inflationRate').value) || 0)) / 100;
  const monthlyInflation = Math.pow(1 + annualInflation, 1 / 12) - 1;
  const inflationRows = state.scenario ? state.scenario.rows : state.rows;
  const presentValue = inflationRows.reduce((sum, row) => sum + (row.totalOutflow || row.payment) / Math.pow(1 + monthlyInflation, row.month), 0);
  $('realCost').textContent = money(presentValue);
  const salary = Math.max(0, Number($('salary').value) || 0);
  const existingEmi = Math.max(0, Number($('existingEmi').value) || 0);
  const ratio = Math.max(0, Math.min(80, Number($('foir').value) || 0)) / 100;
  const affordableEmi = Math.max(0, salary * ratio - existingEmi);
  const monthlyRate = state.rate / 1200;
  const months = Math.round(state.years * 12);
  const eligible = monthlyRate === 0 ? affordableEmi * months : affordableEmi * (1 - Math.pow(1 + monthlyRate, -months)) / monthlyRate;
  $('eligibleLoan').textContent = money(eligible);
  updateTax();
}

function update() {
  readState();
  syncInputs();
  $('emiValue').textContent = money(state.emi);
  $('emiMonths').textContent = state.rows.length;
  $('principalValue').textContent = money(state.principal);
  $('interestValue').textContent = money(state.totalInterest);
  $('totalValue').textContent = money(state.totalPayment);
  $('principalPercent').textContent = `${state.totalPayment > 0 ? (state.principal / state.totalPayment * 100).toFixed(0) : 0}%`;
  $('legendPrincipal').textContent = compact(state.principal);
  $('legendInterest').textContent = compact(state.totalInterest);
  $('taxYear').max = Math.ceil(state.years);
  $('taxYear').value = Math.min(Math.ceil(state.years), Math.max(1, Number($('taxYear').value) || 1));
  renderPrepaymentInputs();
  simulatePrepayment();
  renderBanks();
  updateExtras();
  persistInputs();
}

function validateNumericField(id, min, max, integer = false) {
  const input = $(id);
  if (!input) return true;
  const raw = input.value.trim();
  const value = raw === '' ? NaN : Number(raw);
  let message = '';
  if (!Number.isFinite(value)) message = 'Enter a valid number.';
  else if (value < min || value > max) message = `Enter a value from ${min} to ${max}.`;
  else if (integer && !Number.isInteger(value)) message = 'Enter a whole number of months.';
  input.setCustomValidity(message);
  input.setAttribute('aria-invalid', message ? 'true' : 'false');
  const status = $('validationStatus');
  if (status) status.textContent = message ? `${input.getAttribute('aria-label') || id}: ${message}` : 'Input is within the supported range.';
  if (status) status.classList.toggle('invalid', Boolean(message));
  return !message;
}

function setField(which, rawValue) {
  let value = Number(rawValue);
  if (!Number.isFinite(value)) return;
  if (which === 'tenureMonths') {
    value = Math.round(Math.max(12, Math.min(categoryTenureLimits[$('loanType').value] || 360, value)));
    $('tenureMonthsNumber').value = value;
    $('tenureNumber').value = (value / 12).toFixed(2).replace(/\.00$/, '');
    $('tenure').value = value / 12;
    update();
    return;
  }
  const [min, max] = LIMITS[which];
  value = Math.max(min, Math.min(max, value));
  const ids = { amount: ['amountNumber', 'loanAmount'], rate: ['rateNumber', 'interestRate'], tenure: ['tenureNumber', 'tenure'] };
  ids[which].forEach((id) => { $(id).value = value; });
  if (which === 'tenure') $('tenureMonthsNumber').value = Math.round(value * 12);
  update();
  recordLocalAudit('loan-input-updated', { field: which, value });
}

function downloadSchedule() {
  const scenario = state.scenario || currentScenario();
  if (!window.jspdf || !window.jspdf.jsPDF) {
    window.print();
    return;
  }
  const { jsPDF } = window.jspdf;
  const pdfMoney = (value) => `INR ${Math.round(Number(value) || 0).toLocaleString('en-IN')}`;
  const doc = new jsPDF({ orientation: 'landscape' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const generated = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  doc.setProperties({ title: 'LoanLens Amortization Schedule', subject: 'Loan repayment breakdown', author: 'LoanLens' });
  // Branded header band: logo mark + wordmark, repeated on every page.
  const drawBrand = () => {
    doc.setFillColor(23, 107, 88); doc.rect(0, 0, pageW, 18, 'F');
    doc.setFillColor(255, 255, 255); doc.roundedRect(14, 4, 10, 10, 2, 2, 'F');
    doc.setTextColor(23, 107, 88); doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text('L', 17.4, 11.4);
    doc.setTextColor(255, 255, 255); doc.setFontSize(14); doc.text('LoanLens', 28, 11.5);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text('Amortization Schedule', pageW - 14, 11.5, { align: 'right' });
  };
  drawBrand();
  doc.setTextColor(40); doc.setFontSize(10);
  doc.text(`Category: ${$('loanType').value} | Principal: ${pdfMoney(state.principal)} | Rate: ${state.rate}% | Tenure: ${Math.round(state.years * 12)} months | EMI: ${pdfMoney(state.emi)}`, 14, 27);
  const categoryOffers = loanCatalog[$('loanType').value] || loanCatalog.home;
  const selectedOffer = categoryOffers.find((offer) => offer.code === $('prepayLender').value) || categoryOffers[0];
  const lenderFee = processingFee(selectedOffer, state.principal);
  const processingText = lenderFee === null ? 'not published' : pdfMoney(lenderFee);
  doc.text(`Scenario interest: ${pdfMoney(scenario.totalInterest)} | Prepayment fees: ${pdfMoney(scenario.totalFees)} | Processing fee (${selectedOffer.name}): ${processingText}`, 14, 33);
  doc.text(`Estimated total outflow incl. known processing fee: ${pdfMoney(scenario.totalPayment + (lenderFee || 0))}`, 14, 39);
  const body = scenario.rows.map((row) => [row.month, pdfMoney(row.opening), pdfMoney(row.regularPrincipal), pdfMoney(row.extra), pdfMoney(row.interest), pdfMoney(row.fee), pdfMoney(row.closing)]);
  if (typeof doc.autoTable === 'function') {
    doc.autoTable({ startY: 45, head: [['Month', 'Opening balance', 'Regular principal', 'Extra payment', 'Interest', 'Fee', 'Closing balance']], body, styles: { fontSize: 7, cellPadding: 2 }, headStyles: { fillColor: [23, 107, 88] }, alternateRowStyles: { fillColor: [244, 248, 246] }, margin: { top: 24, bottom: 16, left: 14, right: 14 }, didDrawPage: () => { if (doc.internal.getCurrentPageInfo().pageNumber > 1) drawBrand(); } });
  } else {
    // Manual PDF table fallback when jsPDF loads but the AutoTable add-on does not.
    const columns = [14, 31, 75, 119, 160, 198, 235];
    const headings = ['Month', 'Opening', 'Regular principal', 'Extra payment', 'Interest', 'Fee', 'Closing'];
    let y = 50;
    const drawHeader = () => {
      doc.setFontSize(7); doc.setTextColor(23, 107, 88);
      headings.forEach((heading, index) => doc.text(heading, columns[index], y));
      y += 5; doc.setTextColor(40);
    };
    drawHeader();
    body.forEach((row) => {
      if (y > pageH - 20) { doc.addPage(); drawBrand(); y = 28; drawHeader(); }
      row.forEach((value, index) => doc.text(String(value), columns[index], y));
      y += 5;
    });
  }
  // Footer with branding, generation date and page numbers on every page.
  const pages = doc.internal.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(220, 230, 224); doc.line(14, pageH - 12, pageW - 14, pageH - 12);
    doc.setFontSize(8); doc.setTextColor(110);
    doc.text('LoanLens · Illustrative estimate, not a bank quotation · Verify with your lender', 14, pageH - 7);
    doc.text(`Generated ${generated} · Page ${page} of ${pages}`, pageW - 14, pageH - 7, { align: 'right' });
  }
  doc.save('LoanLens_Amortization_Schedule.pdf');
}

function runBenchmarkCheck() {
  // Regression checks use independently calculated reference values and
  // accounting invariants for both ordinary and prepayment schedules.
  const standard = calculate(5000000, 8.75, 240);
  const zeroRate = calculate(500000, 0, 120);
  const baseline = calculate(5000000, 8.75, 240);
  const withExtra = calculateWithPrepayments(5000000, 8.75, 240, [{ month: 36, amount: 200000 }], 0);
  const withFee = calculateWithPrepayments(5000000, 8.75, 240, [{ month: 36, amount: 200000 }], 2);
  const close = (a, b, tolerance) => Math.abs(a - b) <= tolerance;
  const tests = [
    { name: 'standard EMI reference', ok: close(standard.emi, 44185.53544547, 0.005) },
    { name: 'standard total-interest reference', ok: close(standard.totalInterest, 5604528.5069, 0.01) },
    { name: 'standard repayment identity', ok: close(standard.totalPayment, 5000000 + standard.totalInterest, 0.01) },
    { name: 'standard schedule length', ok: standard.rows.length === 240 },
    { name: 'standard schedule closes at zero', ok: standard.rows.length > 0 && standard.rows.at(-1).closing <= 0.005 },
    { name: 'standard principal conservation', ok: close(standard.rows.reduce((sum, row) => sum + row.principal, 0), 5000000, 0.01) },
    { name: 'zero-rate EMI', ok: close(zeroRate.emi, 500000 / 120, 0.000001) },
    { name: 'zero-rate interest', ok: close(zeroRate.totalInterest, 0, 0.000001) },
    { name: 'prepayment interest reduction', ok: withExtra.totalInterest < baseline.totalInterest },
    { name: 'prepayment tenure reduction', ok: withExtra.months < baseline.months },
    { name: 'prepayment principal conservation', ok: close(withExtra.totalPrincipal, 5000000, 0.01) },
    { name: 'prepayment event applied once', ok: withExtra.appliedEvents === 1 && withExtra.unappliedEvents === 0 },
    { name: 'prepayment reference result', ok: close(baseline.totalInterest - withExtra.totalInterest, 625026.2712, 0.02) && withExtra.months === 222 },
    { name: 'penalty fee included', ok: withFee.totalFees > 0 && withFee.totalFees === 4000 },
    { name: 'all four categories have three lenders', ok: ['home', 'auto', 'education', 'personal'].every((category) => loanCatalog[category].length >= 3) },
    { name: 'lender rates are finite and positive', ok: Object.values(loanCatalog).flat().every((offer) => Number.isFinite(offer.rate) && offer.rate > 0) },
    { name: 'zero principal is stable', ok: calculate(0, 8, 120).totalPayment === 0 && calculate(0, 8, 120).rows.length === 0 },
    { name: 'negative inputs are safely bounded', ok: calculate(-100, -5, -10).emi === 0 && calculate(-100, -5, -10).months === 0 },
    { name: 'excess prepayment is capped at balance', ok: calculateWithPrepayments(100000, 0, 120, [{ month: 1, amount: 999999 }]).rows[0].closing === 0 },
    { name: 'prepayment accounting identity', ok: close(withExtra.totalPayment, withExtra.totalPrincipal + withExtra.totalInterest + withExtra.totalFees, 0.01) }
  ];
  const passed = tests.filter((test) => test.ok).length;
  const srsSavings = baseline.totalInterest - withExtra.totalInterest;
  const monthsSaved = baseline.months - withExtra.months;
  const status = $('benchmarkStatus');
  status.textContent = `${passed}/${tests.length} financial regression checks passed. Reference case: EMI ${money(standard.emi)}; total interest ${money(standard.totalInterest)}. A ₹2 lakh prepayment after month 36 produces ${money(srsSavings)} interest savings and ${monthsSaved} months saved under the standard fixed-EMI calculation. The SRS demo's stated ₹4.5 lakh / 22-month result does not follow from those same inputs; the calculator displays the computed result rather than hard-coding the example. Lender data are published reference inputs, not live or guaranteed offers.`;
  status.classList.toggle('passed', passed === tests.length);
  status.dataset.passed = String(passed);
  status.dataset.total = String(tests.length);
  status.setAttribute('aria-label', `Financial validation: ${passed} of ${tests.length} checks passed`);
  if (passed !== tests.length) console.error('LoanLens financial regression checks failed:', tests.filter((test) => !test.ok));
}

function bindEvents() {
  $('saveScenario').addEventListener('click', saveScenarioLocally);
  [
    ['loanAmount', 'amount'], ['amountNumber', 'amount'],
    ['interestRate', 'rate'], ['rateNumber', 'rate'],
    ['tenure', 'tenure'], ['tenureNumber', 'tenure']
  ].forEach(([id, key]) => $(id).addEventListener('input', (event) => {
    if (id === 'amountNumber' && !validateNumericField(id, LIMITS.amount[0], LIMITS.amount[1])) return;
    if (id === 'rateNumber' && !validateNumericField(id, LIMITS.rate[0], LIMITS.rate[1])) return;
    if (id === 'tenureNumber' && !validateNumericField(id, LIMITS.tenure[0], categoryTenureLimits[$('loanType').value] / 12)) return;
    if (event.target.value !== '') setField(key, event.target.value);
  }));
  $('tenureMonthsNumber').addEventListener('input', (event) => {
    const maxMonths = categoryTenureLimits[$('loanType').value] || 360;
    if (!validateNumericField('tenureMonthsNumber', 12, maxMonths, true)) return;
    if (event.target.value !== '') setField('tenureMonths', event.target.value);
  });
  ['amountNumber', 'rateNumber', 'tenureNumber', 'tenureMonthsNumber'].forEach((id) => {
    $(id).addEventListener('change', () => {
      if (id === 'amountNumber' && !validateNumericField(id, LIMITS.amount[0], LIMITS.amount[1])) setField('amount', state.principal);
      else if (id === 'rateNumber' && !validateNumericField(id, LIMITS.rate[0], LIMITS.rate[1])) setField('rate', state.rate);
      else if (id === 'tenureMonthsNumber' && !validateNumericField(id, 12, categoryTenureLimits[$('loanType').value], true)) setField('tenureMonths', Math.round(state.years * 12));
      else if (id === 'tenureNumber' && !validateNumericField(id, 1, categoryTenureLimits[$('loanType').value] / 12)) setField('tenure', state.years);
    });
  });

  $('loanType').addEventListener('change', () => {
    const category = $('loanType').value;
    const offers = loanCatalog[category] || loanCatalog.home;
    const selectedOffer = offers[0];
    const maxMonths = categoryTenureLimits[category] || 360;
    const adjustedMonths = Math.min(Math.max(12, Math.round(state.years * 12)), maxMonths);
    $('taxPurpose').value = ['home', 'education'].includes(category) ? category : 'personal';
    $('prepayLender').value = selectedOffer.code;
    $('rateNumber').value = selectedOffer.rate;
    $('interestRate').value = selectedOffer.rate;
    $('tenureMonthsNumber').value = adjustedMonths;
    $('tenureNumber').value = (adjustedMonths / 12).toFixed(2).replace(/\.00$/, '');
    $('tenure').value = adjustedMonths / 12;
    $('tenure').max = maxMonths / 12;
    $('tenureNumber').max = maxMonths / 12;
    $('tenureMonthsNumber').max = maxMonths;
    update();
  });

  $('addPrepayment').addEventListener('click', () => {
    if (prepayments.length >= 12) return;
    prepayments.push({ id: nextPrepaymentId++, month: Math.min(Math.round(state.years * 12), 36), amount: Math.min(state.principal, 100000) });
    renderPrepaymentInputs(); simulatePrepayment(); renderBanks();
  });
  $('monthlyView').addEventListener('change', renderSchedule);
  ['prepayLender', 'prepayRateType', 'prepayPurpose', 'prepaySource'].forEach((id) => $(id).addEventListener('change', () => {
    simulatePrepayment(); renderBanks();
  }));
  ['inflationRate', 'salary', 'existingEmi', 'foir', 'taxPurpose', 'taxRegime', 'taxYear', 'taxQualifies', 'selfOccupied', 'other80C', 'taxRate', 'educationEligible'].forEach((id) => {
    $(id).addEventListener('input', updateExtras);
    $(id).addEventListener('change', updateExtras);
  });
  $('downloadSchedule').addEventListener('click', downloadSchedule);
  $('loadSrsDemo').addEventListener('click', loadSrsDemo);
}

function renderSrsReconciliation() {
  const box = $('srsReconcile');
  if (!box) return;
  const P = 5000000, rate = 8.75, n = 240;
  const base = calculate(P, rate, n);
  const run = (amount) => calculateWithPrepayments(P, rate, n, [{ month: 36, amount }], 0);
  const stated = run(200000);
  const savedStated = base.totalInterest - stated.totalInterest;
  const monthsStated = base.rows.length - stated.months;
  // Smallest amounts (binary search; both measures grow with the amount) that reach the brief's figures.
  const smallest = (reached) => { let lo = 0, hi = P; for (let i = 0; i < 60; i += 1) { const mid = (lo + hi) / 2; if (reached(mid)) hi = mid; else lo = mid; } return Math.ceil(hi / 1000) * 1000; };
  const for22 = smallest((a) => base.rows.length - run(a).months >= 22);
  const for45 = smallest((a) => base.totalInterest - run(a).totalInterest >= 450000);
  const lowRate = calculate(P, rate - 0.25, n);
  const edge = base.totalInterest - lowRate.totalInterest;
  let drop = 0.25;
  while (drop < 5 && base.totalInterest - calculate(P, rate - drop, n).totalInterest <= 200000) drop = Math.round((drop + 0.01) * 100) / 100;
  box.innerHTML = `<h4>SRS demo reconciliation</h4>
    <p class="cost-sub">The brief's demo (₹50 L, 20 years, 8.75%, ₹2 L prepaid in year 3, Bank B at 0.25% lower) quotes figures that cannot all come from those inputs. LoanLens computes them exactly instead of hard-coding them. Press “Load SRS demo” to reproduce the scenario.</p>
    <div class="table-scroll"><table class="comparison-table recon-table"><thead><tr><th scope="col">Metric</th><th scope="col">SRS brief says</th><th scope="col">Computed from the same inputs</th><th scope="col">Input that would give the brief's figure</th></tr></thead><tbody>
      <tr><td>EMI</td><td>₹44,186</td><td><b>${money(base.emi)}</b></td><td>Matches</td></tr>
      <tr><td>Total interest</td><td>≈ ₹56 Lakhs</td><td><b>${money(base.totalInterest)}</b></td><td>Matches</td></tr>
      <tr><td>Tenure reduction (₹2 L in year 3)</td><td>22 months</td><td><b>${monthsStated} months</b></td><td>₹${for22.toLocaleString('en-IN')} prepaid at month 36</td></tr>
      <tr><td>Interest saved (₹2 L in year 3)</td><td>₹4.5 Lakhs</td><td><b>${money(savedStated)}</b></td><td>₹${for45.toLocaleString('en-IN')} prepaid at month 36</td></tr>
      <tr><td>Saving from a 0.25% lower rate</td><td>over ₹2 Lakhs</td><td><b>${money(edge)}</b></td><td>A rate cut of about ${drop.toFixed(2)}%</td></tr>
    </tbody></table></div>
    <p class="cost-sub">Both prepayment figures cannot hold at once: ₹4.5 L saved needs a smaller prepayment than the one that shortens the loan by 22 months, so the brief's two numbers contradict each other.</p>`;
}

function loadSrsDemo() {
  $('loanType').value = 'home';
  $('prepayLender').value = 'SBI';
  $('prepayRateType').value = 'floating';
  $('prepayPurpose').value = 'individual';
  $('prepaySource').value = 'own';
  prepayments = [{ id: nextPrepaymentId++, month: 36, amount: 200000 }];
  setField('amount', 5000000);
  setField('rate', 8.75);
  setField('tenureMonths', 240);
  $('prepayment').scrollIntoView({ behavior: 'smooth' });
}

function loadCatalog() {
  const status = $('catalogStatus');
  const count = Object.values(loanCatalog).flat().length;
  if (status) status.textContent = `Bundled lender reference catalogue ready (${count} offers across 4 loan categories). Works without a backend.`;
  update();
}

function reportUnexpectedError(message, error) {
  console.error(message, error || '');
  const status = $('serverStatus') || $('benchmarkStatus');
  if (status) status.textContent = 'An unexpected error occurred. Your current inputs are still available; refresh the page and try again.';
}
window.addEventListener('error', (event) => reportUnexpectedError('Unhandled LoanLens UI error:', event.error));
window.addEventListener('unhandledrejection', (event) => reportUnexpectedError('Unhandled LoanLens async error:', event.reason));

restoreInputs();
bindEvents();
runBenchmarkCheck();
update();
renderSrsReconciliation();
loadCatalog();
