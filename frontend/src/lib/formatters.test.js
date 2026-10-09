import { describe, it, expect } from 'vitest';
import { resolveListingUrl, formatMoney, getMonogramColor } from './formatters';

describe('resolveListingUrl', () => {
  it('passes through valid https product URLs when listing_kind is product', () => {
    const item = {
      listing_kind: 'product',
      url: 'https://www.amazon.in/dp/B0BX2L8FSB',
      title: 'Sony WH-1000XM5',
      source: 'Amazon.in',
    };
    expect(resolveListingUrl(item)).toBe('https://www.amazon.in/dp/B0BX2L8FSB');
  });

  it('falls back to search URL when url is "#"', () => {
    const item = {
      listing_kind: 'product',
      url: '#',
      title: 'Sony WH-1000XM5',
      source: 'Amazon.in',
    };
    expect(resolveListingUrl(item)).toBe('https://www.amazon.in/s?k=Sony%20WH-1000XM5');
  });

  it('falls back to search URL when url is empty or relative', () => {
    const emptyItem = {
      listing_kind: 'product',
      url: '',
      title: 'Wireless Earbuds',
      source: 'Flipkart',
    };
    expect(resolveListingUrl(emptyItem)).toBe('https://www.flipkart.com/search?q=Wireless%20Earbuds');

    const relativeItem = {
      listing_kind: 'product',
      url: '/product/12345',
      title: 'Smart LED Bulb',
      source: 'Croma',
    };
    expect(resolveListingUrl(relativeItem)).toBe('https://www.croma.com/search/?q=Smart%20LED%20Bulb');
  });

  it('falls back to search URL when url ends in truncated ellipsis', () => {
    const item = {
      listing_kind: 'product',
      url: 'https://www.flipkart.com/apple-iphone-15-pro...',
      title: 'iPhone 15 Pro',
      source: 'Flipkart',
    };
    expect(resolveListingUrl(item)).toBe('https://www.flipkart.com/search?q=iPhone%2015%20Pro');
  });

  it('encodes special characters in titles', () => {
    const item = {
      listing_kind: 'search',
      title: 'iPhone 15 Pro (128 GB) & Titanium / 5G + Case',
      source: 'Amazon.in',
    };
    expect(resolveListingUrl(item)).toBe(
      'https://www.amazon.in/s?k=iPhone%2015%20Pro%20(128%20GB)%20%26%20Titanium%20%2F%205G%20%2B%20Case'
    );
  });

  it('uses Google Shopping for unknown retailers', () => {
    const item = {
      listing_kind: 'search',
      title: 'Premium Widget Model X',
      source: 'Unknown Electronics Store',
    };
    expect(resolveListingUrl(item)).toBe(
      'https://www.google.com/search?tbm=shop&q=Premium%20Widget%20Model%20X'
    );
  });

  it('uses verified Vijay Sales search template', () => {
    const item = {
      listing_kind: 'search',
      title: 'MacBook Air M3',
      source: 'Vijay Sales',
    };
    expect(resolveListingUrl(item)).toBe('https://www.vijaysales.com/search?q=MacBook%20Air%20M3');
  });
});

describe('formatMoney', () => {
  it('formats INR prices with rupee symbol', () => {
    const formatted = formatMoney(2499, 'INR');
    expect(formatted).toMatch(/₹|Rs/);
    expect(formatted).toContain('2,499');
  });

  it('formats USD prices with dollar symbol', () => {
    const formatted = formatMoney(99.5, 'USD');
    expect(formatted).toContain('$');
    expect(formatted).toContain('99.50');
  });
});

describe('getMonogramColor', () => {
  it('returns valid Tailwind background color deterministically', () => {
    const color1 = getMonogramColor('Amazon.in');
    const color2 = getMonogramColor('Amazon.in');
    expect(color1).toBe(color2);
    expect(['bg-neo-teal', 'bg-neo-orange', 'bg-neo-maroon']).toContain(color1);
  });
});
