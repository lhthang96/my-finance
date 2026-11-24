CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE spending_items (
  id INTEGER PRIMARY KEY,
  name TEXT,
  amount INTEGER,
  period TEXT CHECK(period IN ('month','year')),
  sort INTEGER DEFAULT 0
);

CREATE TABLE assets (
  id INTEGER PRIMARY KEY,
  name TEXT,
  type TEXT CHECK(type IN ('deposit','cash','stock','receivable','other')),
  quantity REAL NULL,
  amount INTEGER,
  counts_toward_fi INTEGER DEFAULT 1,
  interest_rate REAL NULL,
  start_date TEXT NULL,
  term_months INTEGER NULL,
  note TEXT DEFAULT '',
  sort INTEGER DEFAULT 0,
  updated_at TEXT
);

CREATE TABLE categories (
  id INTEGER PRIMARY KEY,
  key TEXT UNIQUE,
  name_en TEXT,
  name_vi TEXT,
  icon TEXT,
  color TEXT,
  sort INTEGER DEFAULT 0,
  archived INTEGER DEFAULT 0
);

CREATE TABLE transactions (
  id INTEGER PRIMARY KEY,
  date TEXT,
  amount INTEGER,
  kind TEXT CHECK(kind IN ('expense','income')) DEFAULT 'expense',
  category_id INTEGER NULL,
  note TEXT DEFAULT '',
  created_at TEXT
);

CREATE TABLE snapshots (
  month TEXT PRIMARY KEY,
  net_worth INTEGER,
  fi_assets INTEGER,
  income INTEGER,
  spending INTEGER,
  created_at TEXT
);

CREATE TABLE push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  p256dh TEXT,
  auth TEXT,
  created_at TEXT
);

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY,
  kind TEXT,
  title_en TEXT,
  body_en TEXT,
  title_vi TEXT,
  body_vi TEXT,
  url TEXT,
  created_at TEXT,
  read INTEGER DEFAULT 0
);

CREATE TABLE reminder_log (
  key TEXT PRIMARY KEY,
  sent_at TEXT
);
