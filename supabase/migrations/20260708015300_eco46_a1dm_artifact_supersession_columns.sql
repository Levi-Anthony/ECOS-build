-- ECO-46 A1.D/M: supersession columns per ratified A1.W design (receipt 48251a01)
-- Additive + nullable; no existing rows affected.
ALTER TABLE artifacts
  ADD COLUMN superseded_by UUID REFERENCES artifacts(id) ON DELETE RESTRICT,
  ADD COLUMN superseded_at TIMESTAMPTZ;

-- DB backstop 1 (ratified): pair null together or set together
ALTER TABLE artifacts
  ADD CONSTRAINT artifacts_supersession_pair_chk
    CHECK ((superseded_by IS NULL) = (superseded_at IS NULL));

-- DB backstop 2 (residue resolution 2026-07-07): no self-supersession.
-- Longer cycles are enforced at the MCP tool layer per the locked layer
-- decision (94a504ce): predecessor must be currently unsuperseded at stamp time.
ALTER TABLE artifacts
  ADD CONSTRAINT artifacts_no_self_supersession_chk
    CHECK (superseded_by IS NULL OR superseded_by <> id);

COMMENT ON COLUMN artifacts.superseded_by IS 'ECO-46 A1.W: FK to successor artifact. lineage_state is COMPUTED: superseded ⇔ superseded_by IS NOT NULL. Stamped by MCP write path at supersession declaration; never authored directly.';
COMMENT ON COLUMN artifacts.superseded_at IS 'ECO-46 A1.W: timestamp of the supersession stamp. CHECK-coupled to superseded_by.';
