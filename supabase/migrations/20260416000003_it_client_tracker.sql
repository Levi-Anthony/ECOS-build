CREATE TABLE IF NOT EXISTS it_service_logs (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id              UUID NOT NULL,
  contact_id           UUID NOT NULL REFERENCES professional_contacts(id),
  service_date         DATE NOT NULL DEFAULT CURRENT_DATE,
  service_type         TEXT NOT NULL
    CHECK (service_type IN ('onsite','remote','phone','email','project','maintenance')),
  description          TEXT NOT NULL,
  resolution           TEXT,
  time_spent_minutes   INTEGER,
  billable             BOOLEAN NOT NULL DEFAULT true,
  billed               BOOLEAN NOT NULL DEFAULT false,
  follow_up_needed     BOOLEAN NOT NULL DEFAULT false,
  follow_up_notes      TEXT,
  created_at           TIMESTAMP DEFAULT now(),
  updated_at           TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS it_billing_entries (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id              UUID NOT NULL,
  contact_id           UUID NOT NULL REFERENCES professional_contacts(id),
  service_log_ids      UUID[] DEFAULT '{}',
  description          TEXT,
  amount               NUMERIC(10,2),
  status               TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','sent','paid')),
  invoice_date         DATE,
  paid_date            DATE,
  notes                TEXT,
  created_at           TIMESTAMP DEFAULT now(),
  updated_at           TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_it_logs_contact    ON it_service_logs(contact_id);
CREATE INDEX IF NOT EXISTS idx_it_logs_billed     ON it_service_logs(user_id, billed, billable);
CREATE INDEX IF NOT EXISTS idx_it_billing_contact ON it_billing_entries(contact_id);
CREATE INDEX IF NOT EXISTS idx_it_billing_status  ON it_billing_entries(user_id, status);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_it_logs_updated_at
  BEFORE UPDATE ON it_service_logs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_it_billing_updated_at
  BEFORE UPDATE ON it_billing_entries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Inserts billing entry and marks referenced service logs billed atomically.
CREATE OR REPLACE FUNCTION create_billing_entry_tx(
  p_user_id        UUID,
  p_contact_id     UUID,
  p_log_ids        UUID[],
  p_amount         NUMERIC,
  p_description    TEXT DEFAULT NULL,
  p_invoice_date   DATE DEFAULT NULL,
  p_notes          TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE v_id UUID;
BEGIN
  INSERT INTO it_billing_entries (user_id, contact_id, service_log_ids, amount, description, invoice_date, notes)
  VALUES (p_user_id, p_contact_id, p_log_ids, p_amount, p_description, p_invoice_date, p_notes)
  RETURNING id INTO v_id;

  UPDATE it_service_logs
  SET billed = true
  WHERE id = ANY(p_log_ids) AND user_id = p_user_id;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql;
