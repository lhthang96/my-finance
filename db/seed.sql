-- Seed: the user's real status on 2026-11-24.
-- Run on an empty database (settings and snapshots use INSERT OR REPLACE; other tables are plain inserts).

INSERT OR REPLACE INTO settings (key, value) VALUES
  ('salary', '58000000'),
  ('targetMultiple', '30'),
  ('expectedReturn', '0.065'),
  ('horizons', '[5,10]'),
  ('locale', '"vi"'),
  ('reminders', '{"dailyLog":{"enabled":true,"hour":21},"monthEnd":{"enabled":true,"hour":20},"maturity":{"enabled":true,"hour":9}}'),
  ('timezone', '"Asia/Ho_Chi_Minh"');

INSERT INTO spending_items (name, amount, period, sort) VALUES
  ('House rent', 6000000, 'month', 0),
  ('Family spending', 13500000, 'month', 1),
  ('Personal spending', 4000000, 'month', 2),
  ('Travel', 20000000, 'year', 3);

INSERT INTO assets (name, type, quantity, amount, counts_toward_fi, interest_rate, start_date, term_months, note, sort, updated_at) VALUES
  ('Savings #1', 'deposit', NULL, 50000000, 1, NULL, '2026-11-13', 6, '', 0, '2026-11-24T00:00:00.000Z'),
  ('Savings #2', 'deposit', NULL, 30000000, 1, NULL, '2026-11-14', 1, '', 1, '2026-11-24T00:00:00.000Z'),
  ('Savings #3', 'deposit', NULL, 30000000, 1, NULL, '2026-11-14', 1, '', 2, '2026-11-24T00:00:00.000Z'),
  ('Savings #4', 'deposit', NULL, 30000000, 1, NULL, '2026-11-14', 1, '', 3, '2026-11-24T00:00:00.000Z'),
  ('Savings #5', 'deposit', NULL, 30000000, 1, NULL, '2026-11-14', 1, '', 4, '2026-11-24T00:00:00.000Z'),
  ('Savings #6', 'deposit', NULL, 30000000, 1, NULL, '2026-11-14', 1, '', 5, '2026-11-24T00:00:00.000Z'),
  ('Bank account', 'cash', NULL, 118000000, 1, NULL, NULL, NULL, 'Emergency fund and daily spending', 6, '2026-11-24T00:00:00.000Z'),
  ('Loan to friend', 'receivable', NULL, 100000000, 0, NULL, NULL, NULL, 'Expected back in 1–2 years', 7, '2026-11-24T00:00:00.000Z'),
  ('BID', 'stock', 1602, 31950, 1, NULL, NULL, NULL, '', 8, '2026-11-24T00:00:00.000Z'),
  ('SSI', 'stock', 480, 19750, 1, NULL, NULL, NULL, '', 9, '2026-11-24T00:00:00.000Z');

INSERT INTO categories (key, name_en, name_vi, icon, color, sort, archived) VALUES
  ('food', 'Food & drinks', 'Ăn uống', '🍜', '#F59E0B', 0, 0),
  ('transport', 'Transport', 'Đi lại', '🛵', '#38BDF8', 1, 0),
  ('family', 'Family', 'Gia đình', '👨‍👩‍👧', '#F472B6', 2, 0),
  ('housing', 'Housing & bills', 'Nhà & hoá đơn', '🏠', '#A78BFA', 3, 0),
  ('shopping', 'Shopping', 'Mua sắm', '🛍️', '#FB7185', 4, 0),
  ('health', 'Health', 'Sức khoẻ', '💊', '#34D399', 5, 0),
  ('fun', 'Entertainment', 'Giải trí', '🎮', '#F97316', 6, 0),
  ('travel', 'Travel', 'Du lịch', '✈️', '#22D3EE', 7, 0),
  ('other', 'Other', 'Khác', '✨', '#94A3B8', 8, 0);

INSERT OR REPLACE INTO snapshots (month, net_worth, fi_assets, income, spending, created_at) VALUES
  ('2026-11', 478663900, 378663900, 58000000, NULL, '2026-11-24T00:00:00.000Z');
