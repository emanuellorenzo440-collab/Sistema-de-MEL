-- Sistema de MEL - esquema base relacional
-- Pensado para PostgreSQL, adaptable a SQLite durante prototipos.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE programs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  lead TEXT,
  focus TEXT,
  primary_population TEXT,
  beneficiaries INTEGER DEFAULT 0,
  budget TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE indicators (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL REFERENCES programs(id),
  name TEXT NOT NULL,
  target NUMERIC NOT NULL DEFAULT 0,
  current_value NUMERIC NOT NULL DEFAULT 0,
  unit TEXT NOT NULL,
  owner TEXT,
  due_period TEXT,
  type TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL REFERENCES programs(id),
  indicator_id TEXT NOT NULL REFERENCES indicators(id),
  period TEXT NOT NULL,
  province TEXT,
  value NUMERIC NOT NULL DEFAULT 0,
  women INTEGER DEFAULT 0,
  men INTEGER DEFAULT 0,
  youth INTEGER DEFAULT 0,
  owner TEXT,
  evidence TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'Pendiente',
  created_by TEXT REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE monitoring_forms (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL REFERENCES programs(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  frequency TEXT,
  owner TEXT,
  fields_json TEXT NOT NULL,
  mappings_json TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE form_submissions (
  id TEXT PRIMARY KEY,
  form_id TEXT REFERENCES monitoring_forms(id),
  program_id TEXT NOT NULL REFERENCES programs(id),
  file_name TEXT NOT NULL,
  period TEXT,
  report_count INTEGER NOT NULL DEFAULT 0,
  source_type TEXT,
  processing TEXT,
  imported_by TEXT REFERENCES users(id),
  imported_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE concept_papers (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL REFERENCES programs(id),
  title TEXT NOT NULL,
  presenter TEXT,
  file_name TEXT,
  file_url TEXT,
  year TEXT,
  status TEXT,
  summary_json TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE action_items (
  id TEXT PRIMARY KEY,
  program_id TEXT REFERENCES programs(id),
  report_id TEXT REFERENCES reports(id),
  title TEXT NOT NULL,
  owner TEXT,
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'Abierto',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT REFERENCES users(id),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  metadata_json TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
