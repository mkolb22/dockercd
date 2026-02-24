/**
 * Variant Validator: SEC-001 - Injection detection for evolved prompt variants.
 * Phase 5.2: Prompt Population
 */

import type { PromptVariant } from '../population/manager.js';
import { saveQuarantineToDb, loadQuarantineFromDb } from '../db.js';

export interface ValidationResult {
  safe: boolean;
  findings: Finding[];
  quarantine: boolean;
}

export interface Finding {
  type: 'injection' | 'structure' | 'semantic';
  severity: 'low' | 'medium' | 'high' | 'critical';
  pattern: string;
  matched: string;
  location: string;
}

export interface QuarantineRecord {
  variant_id: string;
  quarantined_at: string;
  reason: string;
  findings: Finding[];
  content: string;
}

// Layer 1: Regex patterns for known injection attempts
const INJECTION_PATTERNS = [
  {
    pattern: /ignore\s+(all\s+)?previous\s+instructions?/i,
    severity: 'critical' as const,
    description: 'Instruction override attempt',
  },
  {
    pattern: /you\s+are\s+now/i,
    severity: 'high' as const,
    description: 'Identity redefinition',
  },
  {
    pattern: /disregard\s+(all\s+)?above/i,
    severity: 'critical' as const,
    description: 'Context override attempt',
  },
  {
    pattern: /output\s+(all\s+)?.*keys?/i,
    severity: 'critical' as const,
    description: 'Data extraction attempt',
  },
  {
    pattern: /system\s+prompt/i,
    severity: 'high' as const,
    description: 'System prompt reference',
  },
  {
    pattern: /reveal\s+(your\s+)?instructions?/i,
    severity: 'high' as const,
    description: 'Instruction extraction attempt',
  },
  {
    pattern: /bypass\s+.*security/i,
    severity: 'critical' as const,
    description: 'Security bypass attempt',
  },
  {
    pattern: /execute\s+.*code/i,
    severity: 'high' as const,
    description: 'Arbitrary code execution',
  },
  {
    pattern: /admin\s+mode/i,
    severity: 'high' as const,
    description: 'Privilege escalation attempt',
  },
  {
    pattern: /hidden\s+instructions?/i,
    severity: 'medium' as const,
    description: 'Hidden instruction reference',
  },
  {
    pattern: /secret\s+.*password/i,
    severity: 'high' as const,
    description: 'Credential extraction attempt',
  },
  {
    pattern: /delete\s+.*files?/i,
    severity: 'critical' as const,
    description: 'Destructive action',
  },
  {
    pattern: /override\s+.*rules?/i,
    severity: 'high' as const,
    description: 'Rule override attempt',
  },
  {
    pattern: /jailbreak/i,
    severity: 'critical' as const,
    description: 'Explicit jailbreak attempt',
  },
  {
    pattern: /DAN\s+mode/i,
    severity: 'critical' as const,
    description: 'Known jailbreak technique',
  },
];

/**
 * Scan variant for injection patterns (Layer 1: Regex)
 */
export function scanForInjection(variant: PromptVariant): ValidationResult {
  const findings: Finding[] = [];

  // Layer 1: Regex-based detection
  for (const { pattern, severity, description } of INJECTION_PATTERNS) {
    const matches = variant.content.matchAll(new RegExp(pattern.source, 'gi'));
    for (const match of matches) {
      findings.push({
        type: 'injection',
        severity,
        pattern: description,
        matched: match[0],
        location: `Character ${match.index}`,
      });
    }
  }

  // Layer 2: Structure validation
  const structureResult = validateStructure(variant);
  if (!structureResult.valid) {
    findings.push(...structureResult.findings);
  }

  // Determine if quarantine is needed
  const criticalFindings = findings.filter(f => f.severity === 'critical');
  const highFindings = findings.filter(f => f.severity === 'high');
  const quarantine = criticalFindings.length > 0 || highFindings.length >= 3;

  return {
    safe: findings.length === 0,
    findings,
    quarantine,
  };
}

/**
 * Validate variant structure (Layer 2: Template validation)
 */
export function validateStructure(variant: PromptVariant): {
  valid: boolean;
  findings: Finding[];
} {
  const findings: Finding[] = [];
  const content = variant.content;

  // Check for minimum content length
  if (content.length < 50) {
    findings.push({
      type: 'structure',
      severity: 'high',
      pattern: 'Minimum length requirement',
      matched: `Length: ${content.length}`,
      location: 'Overall',
    });
  }

  // Check for unclosed code blocks
  const codeBlockMatches = content.match(/```/g);
  if (codeBlockMatches && codeBlockMatches.length % 2 !== 0) {
    findings.push({
      type: 'structure',
      severity: 'medium',
      pattern: 'Unclosed code block',
      matched: `${codeBlockMatches.length} backtick blocks found`,
      location: 'Code blocks',
    });
  }

  // Check for excessive special characters (possible obfuscation)
  const specialCharRatio = (content.match(/[^a-zA-Z0-9\s\n.,;:'"!?()-]/g) || []).length / content.length;
  if (specialCharRatio > 0.1) {
    findings.push({
      type: 'structure',
      severity: 'medium',
      pattern: 'Excessive special characters',
      matched: `${(specialCharRatio * 100).toFixed(1)}% special chars`,
      location: 'Overall',
    });
  }

  return {
    valid: findings.length === 0,
    findings,
  };
}

/**
 * Heuristic-based safety validation (Layer 3)
 * Scores content for suspicious injection patterns using keyword analysis.
 */
export async function heuristicValidation(variant: PromptVariant): Promise<{
  safe: boolean;
  score: number;
  reasoning: string;
}> {
  const suspiciousKeywords = ['ignore', 'bypass', 'override', 'jailbreak', 'admin'];
  const keywordCount = suspiciousKeywords.reduce((count, keyword) => {
    return count + (variant.content.toLowerCase().match(new RegExp(keyword, 'g')) || []).length;
  }, 0);

  const score = Math.min(keywordCount * 0.15, 1.0);

  return {
    safe: score < 0.7,
    score,
    reasoning: score < 0.7
      ? 'No significant injection patterns detected'
      : `Suspicious patterns detected (score: ${score.toFixed(2)})`,
  };
}

/**
 * Quarantine a variant
 */
export async function quarantine(
  projectRoot: string,
  variant: PromptVariant,
  reason: string,
  findings: Finding[]
): Promise<void> {
  const record: QuarantineRecord = {
    variant_id: variant.variant_id,
    quarantined_at: new Date().toISOString(),
    reason,
    findings,
    content: variant.content,
  };

  saveQuarantineToDb(projectRoot, record);

  console.warn(`⚠️  Variant ${variant.variant_id} quarantined: ${reason}`);
  console.warn(`   Findings: ${findings.length} issues detected`);
}

/**
 * Get quarantined variants for review
 */
export async function getQuarantinedVariants(projectRoot: string): Promise<QuarantineRecord[]> {
  return loadQuarantineFromDb(projectRoot);
}

/**
 * Full validation pipeline (all 3 layers)
 */
export async function fullValidation(
  projectRoot: string,
  variant: PromptVariant
): Promise<ValidationResult> {
  // Layer 1 & 2: Regex + Structure
  const basicResult = scanForInjection(variant);

  // Layer 3: Heuristic safety validation
  const semanticResult = await heuristicValidation(variant);

  if (!semanticResult.safe && semanticResult.score >= 0.7) {
    basicResult.findings.push({
      type: 'semantic',
      severity: 'high',
      pattern: 'Heuristic-detected suspicious content',
      matched: semanticResult.reasoning,
      location: 'Semantic analysis',
    });
    basicResult.quarantine = true;
  }

  // Quarantine if needed
  if (basicResult.quarantine) {
    await quarantine(projectRoot, variant, 'Failed validation', basicResult.findings);
  }

  return basicResult;
}
