import { describe, it, expect } from "vitest";
import { assembleDebate, estimateDebateCost } from "./debate.js";
import type { AdvocateOutput, CriticOutput, SynthesisOutput } from "./types.js";

function makeAdvocate(overrides: Partial<AdvocateOutput> = {}): AdvocateOutput {
  return {
    agent: "debate-advocate",
    model: "sonnet",
    proposed_approach: "Use microservices architecture",
    confidence: 0.85,
    key_arguments: ["Scalability", "Independent deployment"],
    ...overrides,
  };
}

function makeCritic(overrides: Partial<CriticOutput> = {}): CriticOutput {
  return {
    agent: "debate-critic",
    model: "sonnet",
    confidence: 0.7,
    concerns: [
      { concern: "Operational complexity", severity: "medium", suggestion: "Start with monolith" },
    ],
    risk_assessment: "medium",
    ...overrides,
  };
}

function makeSynthesis(overrides: Partial<SynthesisOutput> = {}): SynthesisOutput {
  return {
    agent: "debate-synthesis",
    model: "opus",
    final_decision: "Use modular monolith initially",
    confidence: 0.9,
    incorporated_concerns: ["Operational complexity"],
    remaining_risks: ["Migration path unclear"],
    dissent_documented: true,
    dissent_summary: "Advocate preferred full microservices",
    recommendation: "proceed",
    ...overrides,
  };
}

describe("assembleDebate", () => {
  it("creates a debate result with all fields", () => {
    const result = assembleDebate("arch-001", makeAdvocate(), makeCritic(), makeSynthesis(), 5000);
    expect(result.debate_id).toMatch(/^debate-/);
    expect(result.arch_id).toBe("arch-001");
    expect(result.duration_ms).toBe(5000);
    expect(result.advocate.proposed_approach).toBe("Use microservices architecture");
    expect(result.critic.risk_assessment).toBe("medium");
    expect(result.synthesis.recommendation).toBe("proceed");
  });

  it("preserves all advocate arguments", () => {
    const advocate = makeAdvocate({
      key_arguments: ["arg1", "arg2", "arg3"],
    });
    const result = assembleDebate("arch-002", advocate, makeCritic(), makeSynthesis(), 1000);
    expect(result.advocate.key_arguments).toHaveLength(3);
  });

  it("preserves all critic concerns", () => {
    const critic = makeCritic({
      concerns: [
        { concern: "c1", severity: "low", suggestion: "s1" },
        { concern: "c2", severity: "high", suggestion: "s2" },
      ],
    });
    const result = assembleDebate("arch-003", makeAdvocate(), critic, makeSynthesis(), 2000);
    expect(result.critic.concerns).toHaveLength(2);
  });

  it("includes metadata with cost and trigger info", () => {
    const result = assembleDebate("arch-004", makeAdvocate(), makeCritic(), makeSynthesis(), 3000);
    expect(result.metadata.triggered_by).toBe("zen_fitness_debate");
    expect(result.metadata.model_used).toBe("multi-agent");
    expect(result.metadata.cost).toBeGreaterThan(0);
  });

  it("generates unique debate IDs", () => {
    const a = assembleDebate("arch-005", makeAdvocate(), makeCritic(), makeSynthesis(), 100);
    const b = assembleDebate("arch-006", makeAdvocate(), makeCritic(), makeSynthesis(), 200);
    expect(a.debate_id).not.toBe(b.debate_id);
  });
});

describe("estimateDebateCost", () => {
  it("returns positive cost estimate", () => {
    const cost = estimateDebateCost();
    expect(cost).toBeGreaterThan(0);
  });

  it("estimates 2x Sonnet + 1x Opus", () => {
    const cost = estimateDebateCost();
    // 2 * 0.003 + 0.015 = 0.021
    expect(cost).toBeCloseTo(0.021, 3);
  });
});
