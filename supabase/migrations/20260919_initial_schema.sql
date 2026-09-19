-- ==============================================================================
-- PreSend Database Migration: Initial Schema
-- Description: Core tables for PreSend fraud triage platform
-- Entities: transactions, risk_assessments, analyst_decisions, audit_logs
-- ==============================================================================

-- 1. TRANSACTIONS TABLE
CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reference_id TEXT UNIQUE, -- Optional external reference code (e.g. PAY-10231)
    merchant TEXT NOT NULL,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
    currency TEXT NOT NULL DEFAULT 'INR',
    payee_name TEXT NOT NULL,
    payee_age_days INTEGER NOT NULL CHECK (payee_age_days >= 0),
    memo TEXT NOT NULL DEFAULT '',
    channel TEXT NOT NULL CHECK (channel IN ('UPI', 'Bank Transfer')),
    device_is_new BOOLEAN NOT NULL DEFAULT false,
    transfers_in_24h INTEGER NOT NULL DEFAULT 0 CHECK (transfers_in_24h >= 0),
    hour_of_day INTEGER NOT NULL CHECK (hour_of_day >= 0 AND hour_of_day <= 23),
    initiated_by TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'held', 'escalated', 'released')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. RISK ASSESSMENTS TABLE
-- Stores output from the deterministic rules engine (0-100 score, band, typology, fired rules)
CREATE TABLE IF NOT EXISTS risk_assessments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
    risk_band TEXT NOT NULL CHECK (risk_band IN ('green', 'amber', 'red')),
    typology TEXT NOT NULL CHECK (typology IN ('impersonation scam', 'mule pattern', 'benign', 'unclear')),
    fired_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
    recommendation TEXT NOT NULL CHECK (recommendation IN ('hold', 'release', 'escalate')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. ANALYST DECISIONS TABLE
-- Records the final human analyst action (Release, Hold and call, or Escalate)
CREATE TABLE IF NOT EXISTS analyst_decisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    decision TEXT NOT NULL CHECK (decision IN ('hold', 'release', 'escalate')),
    reason TEXT,
    analyst_id TEXT NOT NULL DEFAULT 'analyst-1',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. AUDIT LOGS TABLE
-- Immutable trail of system and analyst events (creations, scores, decisions, alerts)
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    actor TEXT NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ==============================================================================
-- INDEXES FOR PERFORMANCE & AUDIT QUERYING
-- ==============================================================================

-- Transactions indexes
CREATE INDEX IF NOT EXISTS idx_transactions_merchant ON transactions(merchant);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_payee_name ON transactions(payee_name);
CREATE INDEX IF NOT EXISTS idx_transactions_reference_id ON transactions(reference_id) WHERE reference_id IS NOT NULL;

-- Risk assessments indexes
CREATE INDEX IF NOT EXISTS idx_risk_assessments_transaction_id ON risk_assessments(transaction_id);
CREATE INDEX IF NOT EXISTS idx_risk_assessments_risk_band ON risk_assessments(risk_band);
CREATE INDEX IF NOT EXISTS idx_risk_assessments_score ON risk_assessments(score DESC);
CREATE INDEX IF NOT EXISTS idx_risk_assessments_created_at ON risk_assessments(created_at DESC);

-- Analyst decisions indexes
CREATE INDEX IF NOT EXISTS idx_analyst_decisions_transaction_id ON analyst_decisions(transaction_id);
CREATE INDEX IF NOT EXISTS idx_analyst_decisions_decision ON analyst_decisions(decision);
CREATE INDEX IF NOT EXISTS idx_analyst_decisions_analyst_id ON analyst_decisions(analyst_id);
CREATE INDEX IF NOT EXISTS idx_analyst_decisions_created_at ON analyst_decisions(created_at DESC);

-- Audit logs indexes
CREATE INDEX IF NOT EXISTS idx_audit_logs_transaction_id ON audit_logs(transaction_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type ON audit_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);

-- ==============================================================================
-- AUTOMATIC TIMESTAMP TRIGGER FOR transactions.updated_at
-- ==============================================================================

CREATE OR REPLACE FUNCTION set_updated_at_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_transactions_set_updated_at ON transactions;
CREATE TRIGGER trg_transactions_set_updated_at
BEFORE UPDATE ON transactions
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

-- ==============================================================================
-- ROW LEVEL SECURITY (RLS)
-- Protects tables against direct anonymous access through PostgREST.
-- The server uses SUPABASE_SERVICE_ROLE_KEY which bypasses RLS.
-- ==============================================================================

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE analyst_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
