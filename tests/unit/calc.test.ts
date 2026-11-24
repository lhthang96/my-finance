import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../../scripts/dev-server.mjs';
import {
  assetValue,
  byCategory,
  computeSummary,
  fiAssetsTotal,
  fiTarget,
  monthSpendingActual,
  monthlySpending,
  netWorth,
  projection,
  requiredMonthly,
  yearsToGoal,
} from '../../src/shared/calc';
import { DEFAULT_SETTINGS } from '../../src/shared/types';
import type { Asset, SpendingItem, Transaction } from '../../src/shared/types';

// Seed data is the source of the golden values.
const db = openDatabase(':memory:');
const items = db.prepare('SELECT * FROM spending_items ORDER BY id').all() as unknown as SpendingItem[];
const assets = db.prepare('SELECT * FROM assets ORDER BY id').all() as unknown as Asset[];
const seededSettings = Object.fromEntries(
  (db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]).map((r) => [
    r.key,
    JSON.parse(r.value) as unknown,
  ]),
);
const settings = DEFAULT_SETTINGS;
const NOW = new Date('2026-11-24T04:00:00Z');

describe('seed matches default settings', () => {
  it('seeded settings equal DEFAULT_SETTINGS', () => {
    assert.deepEqual(seededSettings, JSON.parse(JSON.stringify(DEFAULT_SETTINGS)));
  });
  it('seed has 4 spending items and 10 assets', () => {
    assert.equal(items.length, 4);
    assert.equal(assets.length, 10);
  });
});

describe('asset values', () => {
  it('stock = quantity x unit price', () => {
    const bid = assets.find((a) => a.name === 'BID')!;
    assert.equal(assetValue(bid), 1602 * 31950);
  });
  it('deposit = amount', () => {
    const s1 = assets.find((a) => a.name === 'Savings #1')!;
    assert.equal(assetValue(s1), 50000000);
  });
});

describe('golden values (spec)', () => {
  it('monthlySpending 25,166,667', () => {
    assert.equal(Math.round(monthlySpending(items)), 25166667);
  });
  it('annual 302,000,000', () => {
    assert.equal(Math.round(monthlySpending(items) * 12), 302000000);
  });
  it('fiTarget 9,060,000,000', () => {
    assert.equal(Math.round(fiTarget(items, settings.targetMultiple)), 9060000000);
  });
  it('netWorth 478,663,900', () => {
    assert.equal(Math.round(netWorth(assets)), 478663900);
  });
  it('fiAssets 378,663,900 (loan to friend excluded)', () => {
    assert.equal(Math.round(fiAssetsTotal(assets)), 378663900);
  });

  const s = computeSummary(settings, items, assets, NOW);

  it('progress ~0.0418', () => {
    assert.ok(Math.abs(s.progress - 0.0418) < 0.0001, `progress=${s.progress}`);
  });
  it('remaining 8,681,336,100', () => {
    assert.equal(Math.round(s.remaining), 8681336100);
  });
  it('passiveMonthly 2,051,096', () => {
    assert.equal(Math.round(s.passiveMonthly), 2051096);
  });
  it('coverage 0.0815', () => {
    assert.equal(Number(s.coverage.toFixed(4)), 0.0815);
  });
  it('monthlySaving 32,833,333', () => {
    assert.equal(Math.round(s.monthlySaving), 32833333);
  });
  it('savingsRate 0.5661', () => {
    assert.equal(Number(s.savingsRate.toFixed(4)), 0.5661);
  });
  it('requiredMonthly(5) 121,434,181', () => {
    assert.equal(Math.round(requiredMonthly(5, 378663900, 9060000000, 0.065)), 121434181);
  });
  it('requiredMonthly(10) 50,084,414', () => {
    assert.equal(Math.round(requiredMonthly(10, 378663900, 9060000000, 0.065)), 50084414);
  });
  it('yearsToGoal ~13.31', () => {
    const y = yearsToGoal(378663900, 9060000000, s.monthlySaving, 0.065);
    assert.ok(y !== null && Math.abs(y - 13.31) <= 0.01, `years=${y}`);
  });
  it('projection year 1 ~808,881,514', () => {
    const p = projection(378663900, s.monthlySaving, 0.065, 20);
    assert.equal(p.length, 20);
    assert.equal(p[0].year, 1);
    assert.ok(Math.abs(p[0].value - 808881514) < 1000, `value=${p[0].value}`);
  });
  it('plans contain both horizons with extraNeeded', () => {
    assert.deepEqual(
      s.plans.map((p) => p.years),
      [5, 10],
    );
    assert.equal(s.plans[0].extraNeeded, Math.max(0, s.plans[0].requiredMonthly - s.monthlySaving));
  });
  it('fiDate is a YYYY-MM-DD string', () => {
    assert.match(s.fiDate ?? '', /^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('edge cases', () => {
  it('yearsToGoal is null when not saving and target not reached', () => {
    assert.equal(yearsToGoal(100, 1000, 0, 0.065), null);
  });
  it('yearsToGoal is 0 when target already reached', () => {
    assert.equal(yearsToGoal(1000, 1000, 0, 0.065), 0);
  });
  it('zero target gives progress 0', () => {
    const z = computeSummary({ ...settings, targetMultiple: 0 }, [], assets, NOW);
    assert.equal(z.progress, 0);
    assert.equal(z.remaining, 0);
  });
});

describe('transactions', () => {
  const tx = (over: Partial<Transaction>): Transaction => ({
    id: 1,
    date: '2026-11-10',
    amount: 100000,
    kind: 'expense',
    category_id: 1,
    note: '',
    created_at: '',
    ...over,
  });
  const list = [
    tx({ amount: 100000, category_id: 1 }),
    tx({ amount: 50000, category_id: 2, date: '2026-11-20' }),
    tx({ amount: 999, kind: 'income' }),
    tx({ amount: 70000, category_id: 1, date: '2026-10-30' }),
  ];
  it('monthSpendingActual sums expenses in the month only', () => {
    assert.equal(monthSpendingActual(list, '2026-11'), 150000);
  });
  it('byCategory groups and sorts desc', () => {
    assert.deepEqual(byCategory(list, '2026-11'), [
      { category_id: 1, amount: 100000 },
      { category_id: 2, amount: 50000 },
    ]);
  });
});
