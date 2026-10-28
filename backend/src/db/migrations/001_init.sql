-- Users & roles ---------------------------------------------------------------
CREATE TABLE users (
  id            serial PRIMARY KEY,
  email         text NOT NULL UNIQUE,
  name          text NOT NULL,
  password_hash text NOT NULL,
  role          text NOT NULL CHECK (role IN ('admin', 'finance', 'viewer')),
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

-- Audit trail of every data-file upload (one row per upload) -------------------
CREATE TABLE upload_batches (
  id          serial PRIMARY KEY,
  dataset     text NOT NULL,
  file_name   text,
  row_count   integer NOT NULL DEFAULT 0,
  meta        jsonb NOT NULL DEFAULT '{}'::jsonb,
  uploaded_by integer REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX upload_batches_dataset_idx ON upload_batches (dataset, uploaded_at DESC);

-- Key/value application settings (MM60 surcharge, VK13 FX rates, electrician point)
CREATE TABLE settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by integer REFERENCES users(id) ON DELETE SET NULL
);

-- Source data -----------------------------------------------------------------
CREATE TABLE sales_rows (
  id                    bigserial PRIMARY KEY,
  sales_org             text,
  billing_date          date NOT NULL,
  billing_document      text,
  billing_type          text,
  bill_to_party         text,
  sales_employee        text,
  distribution_channel  text,
  distribution_channel1 text,
  material              text,
  plant                 text,
  qty                   numeric NOT NULL DEFAULT 0,
  sales_value           numeric NOT NULL DEFAULT 0
);
CREATE INDEX sales_rows_billing_date_idx ON sales_rows (billing_date);

CREATE TABLE target_rows (
  id                 serial PRIMARY KEY,
  row_no             integer NOT NULL,
  sales_org          text,
  main_channel       text NOT NULL,
  sub_channel        text NOT NULL,
  responsible_person text,
  channel_code       text,
  month              text NOT NULL,
  amount             numeric NOT NULL DEFAULT 0
);

CREATE TABLE expense_rows (
  id              bigserial PRIMARY KEY,
  company_code    text NOT NULL,
  gl_account      text,
  document_number text,
  document_type   text,
  posting_date    date,
  cost_center     text,
  amount          numeric NOT NULL DEFAULT 0,
  gl_description  text
);
CREATE INDEX expense_rows_posting_date_idx ON expense_rows (posting_date);

CREATE TABLE gl_mapping (
  id          serial PRIMARY KEY,
  gl_category text NOT NULL,
  gl_code     text NOT NULL,
  gl_name     text
);

CREATE TABLE mm60_item_cost (
  material      text NOT NULL,
  plant         text NOT NULL,
  material_type text NOT NULL DEFAULT '',
  price         numeric NOT NULL DEFAULT 0,
  PRIMARY KEY (material, plant)
);

CREATE TABLE vk13_pricing (
  material             text NOT NULL,
  distribution_channel text NOT NULL DEFAULT '',
  currency             text,
  amount               numeric NOT NULL DEFAULT 0,
  per                  text,
  PRIMARY KEY (material, distribution_channel)
);

CREATE TABLE cost_centers (
  cost_center       text PRIMARY KEY,
  name              text,
  description       text,
  allocation_base   text,
  allocated_channel text
);

CREATE TABLE debtor_rows (
  id            serial PRIMARY KEY,
  main_channel  text,
  sales_channel text NOT NULL,
  total_amount  numeric NOT NULL DEFAULT 0,
  d0_30         numeric NOT NULL DEFAULT 0,
  d30_60        numeric NOT NULL DEFAULT 0,
  d60_75        numeric NOT NULL DEFAULT 0,
  d75_90        numeric NOT NULL DEFAULT 0,
  over_90       numeric NOT NULL DEFAULT 0
);

CREATE TABLE inventory_rows (
  id               serial PRIMARY KEY,
  month            text,
  channel          text,
  channel_code     text,
  over_90_value    numeric NOT NULL DEFAULT 0
);

CREATE TABLE distributor_exclusions (
  bill_to_party text PRIMARY KEY
);

-- Saved monthly KPI snapshots (Monthly / YTD comparison) -----------------------
CREATE TABLE monthly_snapshots (
  id             serial PRIMARY KEY,
  financial_year text NOT NULL DEFAULT 'FY26/27',
  month          text NOT NULL,
  version        integer NOT NULL DEFAULT 1,
  data           jsonb NOT NULL,
  created_by     integer REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (financial_year, month, version)
);
