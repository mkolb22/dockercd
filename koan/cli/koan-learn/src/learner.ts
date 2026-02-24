import type { ProvenanceAction } from '@zen/koan-core';
import type { LearnedPattern, MemoryCalibration, LearningState, SkillTemplate } from './types.js';
import { loadLearningStateFromDb, saveLearningStateToDb } from './db.js';

export async function loadLearningState(projectRoot: string): Promise<LearningState> {
  return loadLearningStateFromDb(projectRoot);
}

export async function saveLearningState(projectRoot: string, state: LearningState): Promise<void> {
  saveLearningStateToDb(projectRoot, state);
}

export function extractPatterns(actions: ProvenanceAction[]): LearnedPattern[] {
  // Group actions by concept+action to find recurring patterns
  const groups = new Map<string, ProvenanceAction[]>();

  for (const action of actions) {
    const key = `${action.concept}-${action.action}`;
    const existing = groups.get(key) || [];
    existing.push(action);
    groups.set(key, existing);
  }

  const patterns: LearnedPattern[] = [];

  for (const [key, groupActions] of groups) {
    if (groupActions.length < 3) continue; // Need at least 3 occurrences

    const [concept, actionName] = key.split('-');

    // Calculate success rate (completed = success)
    const successful = groupActions.filter(a => a.status === 'completed').length;
    const successRate = successful / groupActions.length;

    // Determine confidence based on occurrences and success rate
    let confidence: 'low' | 'medium' | 'high' = 'low';
    if (groupActions.length >= 10 && successRate >= 0.8) {
      confidence = 'high';
    } else if (groupActions.length >= 5 && successRate >= 0.7) {
      confidence = 'medium';
    }

    const timestamps = groupActions.map(a => a.timestamp).sort();

    patterns.push({
      id: `pattern-${concept}-${actionName}`,
      name: `${concept} ${actionName} pattern`,
      occurrences: groupActions.length,
      contexts: [concept],
      success_rate: successRate,
      key_decisions: [], // Would need architecture output to extract
      first_seen: timestamps[0],
      last_seen: timestamps[timestamps.length - 1],
      confidence,
    });
  }

  return patterns.sort((a, b) => b.occurrences - a.occurrences);
}

export function computeCalibration(actions: ProvenanceAction[]): MemoryCalibration[] {
  // Group by concept to measure memory effectiveness per concept area
  const conceptGroups = new Map<string, { total: number; successful: number }>();

  for (const action of actions) {
    const existing = conceptGroups.get(action.concept) || { total: 0, successful: 0 };
    existing.total++;
    if (action.status === 'completed') {
      existing.successful++;
    }
    conceptGroups.set(action.concept, existing);
  }

  const calibration: MemoryCalibration[] = [];

  for (const [concept, data] of conceptGroups) {
    const effectiveness = data.total > 0 ? data.successful / data.total : 0;

    let confidence: 'low' | 'medium' | 'high' = 'low';
    if (data.total >= 20 && effectiveness >= 0.8) {
      confidence = 'high';
    } else if (data.total >= 10 && effectiveness >= 0.7) {
      confidence = 'medium';
    }

    calibration.push({
      category: concept,
      total_injections: data.total,
      led_to_success: data.successful,
      effectiveness,
      confidence,
    });
  }

  return calibration.sort((a, b) => b.effectiveness - a.effectiveness);
}

export function generateSkill(pattern: LearnedPattern): SkillTemplate {
  const content = `# ${pattern.name}

> Auto-generated from pattern \`${pattern.id}\`
> Generated: ${new Date().toISOString()}
> Success rate: ${(pattern.success_rate * 100).toFixed(1)}%
> Occurrences: ${pattern.occurrences}
> Confidence: ${pattern.confidence}

## When to Apply

This pattern applies to: ${pattern.contexts.join(', ')}

## Key Insights

${pattern.key_decisions.length > 0 ? pattern.key_decisions.map(d => `- ${d}`).join('\n') : '(Insights will be extracted from architecture decisions)'}

## Notes

- First observed: ${pattern.first_seen.substring(0, 10)}
- Last observed: ${pattern.last_seen.substring(0, 10)}
`;

  return {
    name: pattern.id.replace('pattern-', 'skill-'),
    pattern_id: pattern.id,
    generated_at: new Date().toISOString(),
    success_rate: pattern.success_rate,
    content,
  };
}

export function getEligiblePatterns(patterns: LearnedPattern[]): LearnedPattern[] {
  // Patterns eligible for skill generation: 5+ occurrences, 80%+ success
  return patterns.filter(p => p.occurrences >= 5 && p.success_rate >= 0.8);
}
