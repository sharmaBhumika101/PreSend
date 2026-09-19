/**
 * Composite Risk Calculation Engine for PreSend.
 *
 * ARCHITECTURAL RULE:
 * Combines the static deterministic rules engine score with the behavioral anomaly score
 * into an authoritative, composite server-calculated ScoreResult.
 *
 * Formula:
 * rawScore = staticScore + behavioralScore
 * finalScore = min(100, rawScore)
 *
 * Ground-Truth Authority:
 * The final score, risk band, recommendation, and displayed score all correspond
 * strictly to this composite server-calculated score. Client-provided scores are
 * strictly discarded.
 */

import type {
  BehavioralAssessment,
  Decision,
  FiredRule,
  Payment,
  RiskBand,
  RuleId,
  ScoreResult,
  Typology,
} from "@/lib/types";
import { BAND_THRESHOLDS, SCORE_CAP } from "@/lib/rules";

function bandForScore(score: number): RiskBand {
  if (score >= BAND_THRESHOLDS.red) return "red";
  if (score >= BAND_THRESHOLDS.amber) return "amber";
  return "green";
}

function recommendedDecisionForBand(band: RiskBand): Decision {
  if (band === "green") return "release";
  return "hold";
}

function classifyCompositeTypology(firedIds: Set<RuleId>, compositeScore: number): Typology {
  // Impersonation scam takes precedence if urgency/verify manipulation is in memo
  if (firedIds.has("fraud_keyword")) {
    return "impersonation scam";
  }

  // Mule pattern: velocity (static or behavioral) + unfamiliar route (static new payee, unseen payee, or new device)
  const hasVelocity = firedIds.has("velocity") || firedIds.has("velocity_spike");
  const hasUnfamiliarRoute =
    firedIds.has("new_payee") ||
    firedIds.has("unseen_payee_for_account") ||
    firedIds.has("new_device");

  if (hasVelocity && hasUnfamiliarRoute) {
    return "mule pattern";
  }

  if (compositeScore < BAND_THRESHOLDS.amber) {
    return "benign";
  }

  return "unclear";
}

/**
 * Pure function combining static rules assessment and behavioral anomaly assessment.
 */
export function calculateCompositeRisk(
  payment: Payment,
  staticScore: ScoreResult,
  behavioral: BehavioralAssessment
): ScoreResult {
  // Normalize static fired rules with category
  const staticFired: FiredRule[] = staticScore.firedRules.map((rule) => ({
    ...rule,
    category: rule.category ?? "static",
  }));

  // Map behavioral anomalies into FiredRule structure
  const behavioralFired: FiredRule[] = behavioral.anomalies.map((anomaly) => ({
    id: anomaly.id,
    label: anomaly.label,
    points: anomaly.points,
    detail: anomaly.detail,
    category: "behavioral",
  }));

  const allFiredRules = [...staticFired, ...behavioralFired];
  const firedIds = new Set<RuleId>(allFiredRules.map((r) => r.id));

  // Authoritative composite score recomputed from: static deterministic score + behavioral anomaly score
  const rawCompositeScore = staticScore.score + behavioral.score;
  const compositeScore = Math.min(SCORE_CAP, rawCompositeScore);

  const compositeBand = bandForScore(compositeScore);
  const compositeRecommendation = recommendedDecisionForBand(compositeBand);
  const compositeTypology = classifyCompositeTypology(firedIds, compositeScore);

  return {
    score: compositeScore,
    band: compositeBand,
    typology: compositeTypology,
    firedRules: allFiredRules,
    recommendedDecision: compositeRecommendation,
    staticScore: staticScore.score,
    behavioralScore: behavioral.score,
    behavioral,
  };
}
