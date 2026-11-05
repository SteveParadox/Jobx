ALTER TABLE discovery_candidates
  ADD COLUMN employer_id uuid REFERENCES employers(id) ON DELETE SET NULL;
