-- Month-end exchange rates per month and currency -----------------------------------
-- `cbsl_rate` is the CBSL indicative rate fetched from Frankfurter (null until fetched);
-- `rate` is the rate the calculations use: the CBSL rate, or a user's manual override.
-- Currencies with no row for a month fall back to the default rates in settings.

CREATE TABLE period_fx_rates (
  period      text NOT NULL,
  currency    text NOT NULL,
  rate        numeric NOT NULL CHECK (rate > 0),
  source      text NOT NULL CHECK (source IN ('cbsl', 'manual')),
  cbsl_rate   numeric,
  rate_date   date,
  fetched_at  timestamptz,
  updated_by  integer REFERENCES users(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (period, currency)
);

CREATE TRIGGER period_fx_rates_period_lock BEFORE INSERT OR UPDATE OR DELETE ON period_fx_rates
  FOR EACH ROW EXECUTE FUNCTION guard_label_period_lock();
