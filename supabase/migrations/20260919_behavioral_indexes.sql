-- ==============================================================================
-- PreSend Database Migration: Behavioral Anomaly Query Index
-- Description: Compound index on transactions to optimize customer baseline history lookups
-- ==============================================================================

CREATE INDEX IF NOT EXISTS idx_transactions_customer_history 
ON transactions(merchant, initiated_by, created_at DESC);
