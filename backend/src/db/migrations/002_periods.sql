-- Month-based uploads and month locking -----------------------------------------

ALTER TABLE upload_batches ADD COLUMN period text;
CREATE INDEX upload_batches_period_idx ON upload_batches (dataset, period, uploaded_at DESC);

-- Debtor / inventory reports now belong to one month. Rows loaded before this
-- migration have no month (period NULL) and are ignored by the calculations.
ALTER TABLE debtor_rows ADD COLUMN period text;
ALTER TABLE inventory_rows ADD COLUMN period text;
CREATE INDEX debtor_rows_period_idx ON debtor_rows (period);
CREATE INDEX inventory_rows_period_idx ON inventory_rows (period);

-- One row per calendar month ("2026-06"): lock state and the month's manual inputs.
CREATE TABLE periods (
  period           text PRIMARY KEY,
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'locked')),
  electrician_point numeric NOT NULL DEFAULT 0,
  locked_by        integer REFERENCES users(id) ON DELETE SET NULL,
  locked_at        timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE period_events (
  id         serial PRIMARY KEY,
  period     text NOT NULL,
  action     text NOT NULL CHECK (action IN ('lock', 'unlock')),
  note       text,
  user_id    integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX period_events_period_idx ON period_events (period, created_at DESC);

-- Database-level guard: no row of a locked month can be inserted, changed or
-- deleted (by the API or by hand, e.g. in pgAdmin) until an admin unlocks it.
CREATE FUNCTION period_is_locked(p text) RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM periods WHERE period = p AND status = 'locked')
$$ LANGUAGE sql STABLE;

CREATE FUNCTION guard_date_period_lock() RETURNS trigger AS $$
DECLARE
  col text := TG_ARGV[0];
  p_old text;
  p_new text;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    p_old := to_char((to_jsonb(OLD) ->> col)::date, 'YYYY-MM');
    IF period_is_locked(p_old) THEN
      RAISE EXCEPTION 'PERIOD_LOCKED:%', p_old USING ERRCODE = 'LK423';
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    p_new := to_char((to_jsonb(NEW) ->> col)::date, 'YYYY-MM');
    IF period_is_locked(p_new) THEN
      RAISE EXCEPTION 'PERIOD_LOCKED:%', p_new USING ERRCODE = 'LK423';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION guard_label_period_lock() RETURNS trigger AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND period_is_locked(OLD.period) THEN
    RAISE EXCEPTION 'PERIOD_LOCKED:%', OLD.period USING ERRCODE = 'LK423';
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND period_is_locked(NEW.period) THEN
    RAISE EXCEPTION 'PERIOD_LOCKED:%', NEW.period USING ERRCODE = 'LK423';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sales_rows_period_lock BEFORE INSERT OR UPDATE OR DELETE ON sales_rows
  FOR EACH ROW EXECUTE FUNCTION guard_date_period_lock('billing_date');
CREATE TRIGGER expense_rows_period_lock BEFORE INSERT OR UPDATE OR DELETE ON expense_rows
  FOR EACH ROW EXECUTE FUNCTION guard_date_period_lock('posting_date');
CREATE TRIGGER debtor_rows_period_lock BEFORE INSERT OR UPDATE OR DELETE ON debtor_rows
  FOR EACH ROW EXECUTE FUNCTION guard_label_period_lock();
CREATE TRIGGER inventory_rows_period_lock BEFORE INSERT OR UPDATE OR DELETE ON inventory_rows
  FOR EACH ROW EXECUTE FUNCTION guard_label_period_lock();

-- Block edits to the lock state of the month itself being bypassed by deleting the row.
CREATE FUNCTION guard_periods_delete() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'locked' THEN
    RAISE EXCEPTION 'PERIOD_LOCKED:%', OLD.period USING ERRCODE = 'LK423';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER periods_no_delete_locked BEFORE DELETE ON periods
  FOR EACH ROW EXECUTE FUNCTION guard_periods_delete();
