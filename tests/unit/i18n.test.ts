import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dict, t } from '../../src/shared/i18n';

describe('i18n dictionaries', () => {
  const enKeys = Object.keys(dict.en).sort();
  const viKeys = Object.keys(dict.vi).sort();

  it('en and vi have identical key sets', () => {
    assert.deepEqual(viKeys, enKeys);
  });
  it('has roughly 120 keys', () => {
    assert.ok(enKeys.length >= 120, `only ${enKeys.length} keys`);
  });
  it('no empty strings in either locale', () => {
    for (const locale of ['en', 'vi'] as const) {
      for (const [key, value] of Object.entries(dict[locale])) {
        assert.ok(value.trim().length > 0, `${locale}.${key} is empty`);
      }
    }
  });
});

describe('t()', () => {
  it('returns the locale string', () => {
    assert.equal(t('en', 'save'), 'Save');
    assert.equal(t('vi', 'save'), 'Lưu');
  });
  it('interpolates {vars}', () => {
    assert.equal(t('vi', 'fiTarget', { amount: '9,06 tỷ' }), 'Mục tiêu FI 9,06 tỷ');
    assert.equal(t('en', 'remaining', { amount: '8.68B' }), 'Still missing 8.68B');
  });
  it('leaves unknown placeholders intact', () => {
    assert.equal(t('en', 'fiTarget', {}), 'FI target {amount}');
  });
});
