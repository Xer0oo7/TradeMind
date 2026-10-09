/**
 * Single source of truth for currency formatting across TradeMind.
 * Matches existing dashboard styling: ₹ (Rupee) and en-IN locale.
 */

export const CURRENCY_SYMBOL = '₹';

export function formatMoney(amount, options = {}) {
  if (amount === null || amount === undefined || isNaN(Number(amount))) {
    return '—';
  }

  const num = Number(amount);
  const {
    minimumFractionDigits = 0,
    maximumFractionDigits = 2,
    showSymbol = true,
  } = options;

  // If amount has no decimal part, default to 0 decimals unless specified
  const fractionDigits = Number.isInteger(num) && options.maximumFractionDigits === undefined
    ? 0
    : maximumFractionDigits;

  const formatted = num.toLocaleString('en-IN', {
    minimumFractionDigits,
    maximumFractionDigits: fractionDigits,
  });

  return showSymbol ? `${CURRENCY_SYMBOL}${formatted}` : formatted;
}
