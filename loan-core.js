/* Pure financial domain layer. No DOM, browser storage, network or UI dependencies. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LoanCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAX_MONTHS = 1200;
  const MAX_ANNUAL_RATE = 100;
  const toFinite = (value, fallback = NaN) => {
    if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return fallback;
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  /** Validate user-facing loan values without silently accepting malformed input. */
  function validateInputs({ principal, annualRate, months } = {}) {
    const errors = [];
    const p = toFinite(principal);
    const rate = toFinite(annualRate);
    const n = toFinite(months);
    if (!Number.isFinite(p) || p < 0 || p > 1e12) errors.push('Principal must be a finite amount between 0 and 1,000,000,000,000.');
    if (!Number.isFinite(rate) || rate < 0 || rate > MAX_ANNUAL_RATE) errors.push(`Annual interest rate must be between 0% and ${MAX_ANNUAL_RATE}%.`);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > MAX_MONTHS) errors.push(`Tenure must be a whole number of months between 1 and ${MAX_MONTHS}.`);
    return { valid: errors.length === 0, errors };
  }

  function calculate(principal, annualRate, months) {
    const raw = { principal, annualRate, months };
    const validation = validateInputs(raw);
    // Safe fallback for UI resilience. Call validateInputs when user feedback is needed.
    const P = clamp(toFinite(principal, 0), 0, 1e12);
    const annual = clamp(toFinite(annualRate, 0), 0, MAX_ANNUAL_RATE);
    const n = clamp(Math.round(toFinite(months, 1)), 1, MAX_MONTHS);
    const r = annual / 1200;
    const emi = P === 0 ? 0 : (r === 0 ? P / n : P * r / (1 - Math.pow(1 + r, -n)));
    let balance = P, totalInterest = 0, totalPaid = 0;
    const rows = [];
    for (let month = 1; month <= n && balance > 0.005; month += 1) {
      const opening = balance;
      const interest = balance * r;
      const principalPaid = Math.min(balance, Math.max(0, emi - interest));
      balance = Math.max(0, balance - principalPaid);
      const payment = principalPaid + interest;
      totalInterest += interest;
      totalPaid += payment;
      rows.push({ month, opening, principal: principalPaid, regularPrincipal: principalPaid, extra: 0, interest, fee: 0, closing: balance, payment, totalOutflow: payment });
    }
    return { emi, rows, totalInterest, totalPayment: totalPaid, months: rows.length, validInput: validation.valid, validationErrors: validation.errors };
  }

  function calculateWithPrepayments(principal, annualRate, months, events = [], penaltyRate = 0) {
    const base = calculate(principal, annualRate, months);
    const P = clamp(toFinite(principal, 0), 0, 1e12);
    const annual = clamp(toFinite(annualRate, 0), 0, MAX_ANNUAL_RATE);
    const r = annual / 1200;
    const safeEvents = Array.isArray(events) ? events.slice(0, 100) : [];
    const eventMap = new Map();
    safeEvents.forEach((event) => {
      if (!event || typeof event !== 'object') return;
      const monthValue = toFinite(event.month);
      const amount = toFinite(event.amount);
      if (!Number.isFinite(monthValue) || !Number.isFinite(amount) || amount <= 0) return;
      const month = clamp(Math.round(monthValue), 1, MAX_MONTHS);
      eventMap.set(month, (eventMap.get(month) || 0) + amount);
    });

    let balance = P, totalInterest = 0, totalFees = 0, totalPaid = 0;
    const rows = [];
    for (let month = 1; month <= MAX_MONTHS && balance > 0.005; month += 1) {
      const opening = balance;
      const interest = balance * r;
      const regularPrincipal = Math.min(balance, Math.max(0, base.emi - interest));
      balance = Math.max(0, balance - regularPrincipal);
      const requested = eventMap.get(month) || 0;
      const extra = Math.min(balance, requested);
      balance = Math.max(0, balance - extra);
      const rawPenalty = typeof penaltyRate === 'function'
        ? penaltyRate({ month, extra, requested, opening, balanceBeforeExtra: opening - regularPrincipal, closing: balance })
        : penaltyRate;
      const rate = clamp(toFinite(rawPenalty, 0), 0, 100);
      const fee = extra * rate / 100;
      const principalPaid = regularPrincipal + extra;
      const payment = principalPaid + interest;
      totalInterest += interest;
      totalFees += fee;
      totalPaid += payment + fee;
      rows.push({ month, opening, principal: principalPaid, regularPrincipal, extra, interest, fee, closing: balance, payment, totalOutflow: payment + fee });
    }

    const appliedMonths = new Set(rows.filter((row) => row.extra > 0).map((row) => row.month));
    const requestedEvents = safeEvents.filter((event) => event && toFinite(event.amount, 0) > 0 && Number.isFinite(toFinite(event.month)));
    const appliedEvents = requestedEvents.filter((event) => appliedMonths.has(clamp(Math.round(toFinite(event.month)), 1, MAX_MONTHS)));
    const unappliedEvents = requestedEvents.filter((event) => !appliedMonths.has(clamp(Math.round(toFinite(event.month)), 1, MAX_MONTHS)));
    return {
      emi: base.emi, rows, totalInterest, totalFees, totalPayment: totalPaid, months: rows.length,
      totalPrincipal: rows.reduce((sum, row) => sum + row.principal, 0),
      appliedEvents: appliedEvents.length, unappliedEvents: unappliedEvents.length,
      validInput: base.validInput, validationErrors: base.validationErrors
    };
  }

  return { calculate, calculateWithPrepayments, validateInputs, MAX_MONTHS, MAX_ANNUAL_RATE };
});
