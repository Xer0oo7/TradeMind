/**
 * Formatters and Link Resolvers for TradeMind Market Intel
 */

const SEARCH_TEMPLATES = {
  'amazon.in': 'https://www.amazon.in/s?k={q}',
  'amazon': 'https://www.amazon.in/s?k={q}',
  'flipkart': 'https://www.flipkart.com/search?q={q}',
  'reliance digital': 'https://www.reliancedigital.in/search?q={q}',
  'croma': 'https://www.croma.com/search/?q={q}',
  'vijay sales': 'https://www.vijaysales.com/search?q={q}',
  'ajio': 'https://www.ajio.com/search/?text={q}',
  'myntra': 'https://www.myntra.com/{q}',
  'tata cliq': 'https://www.tatacliq.com/search/?searchCategory=all&text={q}',
  'tata cliq luxury': 'https://www.tatacliq.com/search/?searchCategory=all&text={q}',
  'pepperfry': 'https://www.pepperfry.com/site_product/search?q={q}',
  'urban ladder': 'https://www.urbanladder.com/products/search?keywords={q}',
  'coursera': 'https://www.coursera.org/search?query={q}',
  'udemy': 'https://www.udemy.com/courses/search/?q={q}',
  'edx': 'https://www.edx.org/search?q={q}',
};

/**
 * Resolves a listing item to an absolute, valid URL.
 * 1. If listing_kind === "product" and item.url is an absolute https URL that parses with new URL(), use as is.
 * 2. Otherwise build retailer search URL from product title.
 * 3. Fallback: Google Shopping search URL.
 */
export function resolveListingUrl(item) {
  if (!item) return 'https://www.google.com/search?tbm=shop&q=product';

  const rawUrl = typeof item.url === 'string' ? item.url.trim() : '';

  // 1. Valid absolute https product URL
  if (item.listing_kind === 'product' && rawUrl.startsWith('https://') && !rawUrl.endsWith('...')) {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol === 'https:' && parsed.hostname && parsed.hostname.includes('.')) {
        return rawUrl;
      }
    } catch {
      // Invalid URL syntax -> fall through to search
    }
  }

  // 2. Retailer search URL
  const title = (item.title || item.name || '').trim();
  const source = (item.source || '').trim().toLowerCase();
  const q = encodeURIComponent(title);

  if (source && title) {
    let template = SEARCH_TEMPLATES[source];
    if (!template) {
      for (const [key, tpl] of Object.entries(SEARCH_TEMPLATES)) {
        if (source.includes(key) || key.includes(source)) {
          template = tpl;
          break;
        }
      }
    }
    if (template) {
      return template.replace('{q}', q);
    }
  }

  // 3. Unknown retailer or fallback
  return `https://www.google.com/search?tbm=shop&q=${q || 'product'}`;
}

/**
 * Consistent currency formatter using Intl.NumberFormat.
 * Does NOT convert values. Formats strictly according to the currency code.
 */
export function formatMoney(amount, currency = 'INR') {
  if (amount == null || amount === '') return '';
  const num = typeof amount === 'number' ? amount : parseFloat(amount);
  if (isNaN(num)) return '';

  const curr = (currency || 'INR').toUpperCase();
  try {
    return new Intl.NumberFormat(curr === 'INR' ? 'en-IN' : 'en-US', {
      style: 'currency',
      currency: curr,
      maximumFractionDigits: curr === 'INR' ? 0 : 2,
    }).format(num);
  } catch {
    return `${curr} ${num}`;
  }
}

const MONOGRAM_COLORS = ['bg-neo-teal', 'bg-neo-orange', 'bg-neo-maroon'];

/**
 * Deterministic background color for source monogram avatar.
 */
export function getMonogramColor(source = '') {
  let hash = 0;
  const str = String(source || '');
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return MONOGRAM_COLORS[Math.abs(hash) % MONOGRAM_COLORS.length];
}
