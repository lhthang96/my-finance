import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatCompact, formatVND, parseAmount } from '../../src/shared/format';

describe('formatVND', () => {
  it('vi uses dot grouping and a trailing ₫', () => {
    assert.equal(formatVND(1234567, 'vi'), '1.234.567 ₫');
  });
  it('en uses comma grouping', () => {
    assert.equal(formatVND(1234567, 'en'), '1,234,567 ₫');
  });
});

describe('formatCompact', () => {
  it('vi: tỷ / tr / N', () => {
    assert.equal(formatCompact(9060000000, 'vi'), '9,06 tỷ');
    assert.equal(formatCompact(378663900, 'vi'), '378,7 tr');
    assert.equal(formatCompact(500000, 'vi'), '500 N');
  });
  it('en: B / M / K', () => {
    assert.equal(formatCompact(9060000000, 'en'), '9.06B');
    assert.equal(formatCompact(378663900, 'en'), '378.7M');
    assert.equal(formatCompact(500000, 'en'), '500K');
  });
  it('small numbers are plain', () => {
    assert.equal(formatCompact(500, 'en'), '500');
  });
});

describe('parseAmount', () => {
  const cases: [string, number][] = [
    ['150k', 150000],
    ['1.5tr', 1500000],
    ['1,5m', 1500000],
    ['2tỷ', 2000000000],
    ['25.000', 25000],
    ['25000', 25000],
    ['500', 500],
  ];
  for (const [input, expected] of cases) {
    it(`parses "${input}" as ${expected}`, () => {
      assert.equal(parseAmount(input), expected);
    });
  }
  it('rejects garbage', () => {
    assert.equal(parseAmount(''), null);
    assert.equal(parseAmount('abc'), null);
    assert.equal(parseAmount('-5'), null);
  });
});
