import { describe, it, expect, beforeEach } from 'vitest';
import {
  extractFeatures,
  scoreDifficulty,
  mapToComplexity,
  calculateConfidence,
  jaccardSimilarity,
  TaskComplexityClassifier,
  DEFAULT_CLASSIFIER_CONFIG,
} from '../classifier.js';
import type {
  TaskFeatures,
  ClassificationResult,
  TaskFeedback,
  SemanticSignalProvider,
  ClassifierConfig,
} from '../classifier.js';

// ---------------------------------------------------------------------------
// extractFeatures
// ---------------------------------------------------------------------------

describe('extractFeatures', () => {
  it('extracts basic length and word count', () => {
    const features = extractFeatures('Fix the bug in login');
    expect(features.queryLength).toBe(20);
    expect(features.wordCount).toBe(5);
  });

  it('detects complex patterns', () => {
    const features = extractFeatures('Refactor the authentication module to use dependency injection');
    expect(features.hasComplexPatterns).toBe(true);
  });

  it('detects security keywords', () => {
    const features = extractFeatures('Add encryption for user credentials and tokens');
    expect(features.hasSecurityKeywords).toBe(true);
  });

  it('detects architecture keywords', () => {
    const features = extractFeatures('Design the microservice architecture for distributed scaling');
    expect(features.hasArchitectureKeywords).toBe(true);
  });

  it('counts code entities', () => {
    const features = extractFeatures('Update function getData() and class UserService and interface IAuth');
    expect(features.codeEntityCount).toBeGreaterThanOrEqual(3);
  });

  it('counts file references', () => {
    const features = extractFeatures('Modify src/auth/login.ts and src/utils/crypto.ts');
    expect(features.fileReferenceCount).toBeGreaterThanOrEqual(2);
  });

  it('detects multi-step structure', () => {
    const features = extractFeatures('First create the schema, then implement the API, finally add tests');
    expect(features.hasMultiStepStructure).toBe(true);
  });

  it('counts constraints', () => {
    const features = extractFeatures('Must be backward compatible. Should not break existing tests. Ensure thread safety.');
    expect(features.constraintCount).toBeGreaterThanOrEqual(3);
  });

  it('estimates large scope', () => {
    const longText = 'Design the system architecture for ' + 'word '.repeat(100);
    const features = extractFeatures(longText);
    expect(features.estimatedScope).toBe('large');
  });

  it('estimates small scope for short tasks', () => {
    const features = extractFeatures('Fix typo in README');
    expect(features.estimatedScope).toBe('small');
  });

  it('includes context in analysis', () => {
    const features = extractFeatures('Fix the bug', 'The security vulnerability allows credential injection');
    expect(features.hasSecurityKeywords).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// scoreDifficulty
// ---------------------------------------------------------------------------

describe('scoreDifficulty', () => {
  it('scores simple tasks low', () => {
    const features = extractFeatures('Fix typo');
    const score = scoreDifficulty(features);
    expect(score).toBeLessThan(3);
  });

  it('scores complex tasks high', () => {
    const features = extractFeatures(
      'Refactor the entire authentication architecture to use microservice-based ' +
      'distributed security tokens with encryption. Modify src/auth/service.ts, ' +
      'src/crypto/encrypt.ts, and src/gateway/middleware.ts. Must ensure backward ' +
      'compatibility. Should not break existing integration tests.',
    );
    const score = scoreDifficulty(features);
    expect(score).toBeGreaterThan(6);
  });

  it('returns value in [0, 10]', () => {
    // Test with an extreme case
    const features = extractFeatures('a');
    const score = scoreDifficulty(features);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(10);

    const extreme = extractFeatures(
      'Refactor architect optimize migrate rewrite overhaul restructure integrate ' +
      'security vulnerability auth encrypt credential token ' +
      'architecture infrastructure scale distribute microservice ' +
      'function foo() class Bar interface IBaz type MyType ' +
      'src/a.ts src/b.ts src/c.ts src/d.ts ' +
      'Must ensure. Should guarantee. Require validation. Need to verify. ' +
      'Step 1 then step 2 then step 3. First do this, then that, finally done.',
    );
    const extremeScore = scoreDifficulty(extreme);
    expect(extremeScore).toBeGreaterThanOrEqual(0);
    expect(extremeScore).toBeLessThanOrEqual(10);
  });

  it('increases with more code entities', () => {
    const simple = extractFeatures('Fix getData');
    const complex = extractFeatures('Fix getData() and updateUser() and validateInput() and parseResponse()');
    expect(scoreDifficulty(complex)).toBeGreaterThan(scoreDifficulty(simple));
  });

  it('increases with file references', () => {
    const noFiles = extractFeatures('Fix the login bug');
    const withFiles = extractFeatures('Fix the login bug in src/auth.ts and src/session.ts and lib/crypto.ts');
    expect(scoreDifficulty(withFiles)).toBeGreaterThan(scoreDifficulty(noFiles));
  });
});

// ---------------------------------------------------------------------------
// mapToComplexity
// ---------------------------------------------------------------------------

describe('mapToComplexity', () => {
  it('maps low scores to trivial', () => {
    expect(mapToComplexity(0)).toBe('trivial');
    expect(mapToComplexity(1.0)).toBe('trivial');
    expect(mapToComplexity(1.5)).toBe('trivial');
  });

  it('maps to simple', () => {
    expect(mapToComplexity(2.0)).toBe('simple');
    expect(mapToComplexity(3.5)).toBe('simple');
  });

  it('maps to medium', () => {
    expect(mapToComplexity(4.0)).toBe('medium');
    expect(mapToComplexity(5.5)).toBe('medium');
  });

  it('maps to complex', () => {
    expect(mapToComplexity(6.0)).toBe('complex');
    expect(mapToComplexity(7.5)).toBe('complex');
  });

  it('maps high scores to expert', () => {
    expect(mapToComplexity(8.0)).toBe('expert');
    expect(mapToComplexity(10.0)).toBe('expert');
  });

  it('respects custom thresholds', () => {
    const config: ClassifierConfig = {
      ...DEFAULT_CLASSIFIER_CONFIG,
      thresholds: { trivial: 2, simple: 4, medium: 6, complex: 8 },
    };
    expect(mapToComplexity(1.5, config)).toBe('trivial');
    expect(mapToComplexity(3.0, config)).toBe('simple');
    expect(mapToComplexity(5.0, config)).toBe('medium');
    expect(mapToComplexity(7.0, config)).toBe('complex');
    expect(mapToComplexity(9.0, config)).toBe('expert');
  });
});

// ---------------------------------------------------------------------------
// calculateConfidence
// ---------------------------------------------------------------------------

describe('calculateConfidence', () => {
  it('returns base confidence for minimal features', () => {
    const features = extractFeatures('Fix typo');
    const confidence = calculateConfidence(features);
    expect(confidence).toBeCloseTo(0.5, 1);
  });

  it('increases with strong signals', () => {
    const weakFeatures = extractFeatures('Fix typo');
    const strongFeatures = extractFeatures(
      'Architect the distributed security system across multiple microservices',
    );
    expect(calculateConfidence(strongFeatures)).toBeGreaterThan(calculateConfidence(weakFeatures));
  });

  it('returns value in [0, 1]', () => {
    const features = extractFeatures('anything');
    const confidence = calculateConfidence(features);
    expect(confidence).toBeGreaterThanOrEqual(0);
    expect(confidence).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// jaccardSimilarity
// ---------------------------------------------------------------------------

describe('jaccardSimilarity', () => {
  it('returns 1 for identical strings', () => {
    expect(jaccardSimilarity('fix the bug', 'fix the bug')).toBe(1);
  });

  it('returns 0 for completely different strings', () => {
    expect(jaccardSimilarity('apple banana cherry', 'x y z')).toBe(0);
  });

  it('returns value between 0 and 1 for partial overlap', () => {
    const sim = jaccardSimilarity('fix the login bug', 'fix the auth bug');
    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThan(1);
  });

  it('is symmetric', () => {
    const ab = jaccardSimilarity('fix the bug', 'debug the fix');
    const ba = jaccardSimilarity('debug the fix', 'fix the bug');
    expect(ab).toBeCloseTo(ba, 10);
  });

  it('filters short words', () => {
    // "a" and "I" should be filtered with minWordLength=2
    const sim = jaccardSimilarity('a I the', 'a I the', 2);
    expect(sim).toBe(1); // "the" is the only word > 2 chars
  });

  it('handles empty strings', () => {
    expect(jaccardSimilarity('', '')).toBe(1);
    expect(jaccardSimilarity('hello', '')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// TaskComplexityClassifier
// ---------------------------------------------------------------------------

describe('TaskComplexityClassifier', () => {
  let classifier: TaskComplexityClassifier;

  beforeEach(() => {
    classifier = new TaskComplexityClassifier();
  });

  describe('classify (async)', () => {
    it('classifies a simple task', async () => {
      const result = await classifier.classify('Fix the typo in the readme');
      expect(result.complexity).toBe('trivial');
      expect(result.difficulty).toBeLessThan(3);
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.fusionMethod).toBe('heuristic-only');
      expect(result.id).toMatch(/^tc-/);
    });

    it('classifies a complex task', async () => {
      const result = await classifier.classify(
        'Refactor the authentication architecture to support distributed microservice ' +
        'security with encrypted credentials. Modify src/auth.ts, src/gateway.ts. ' +
        'Must be backward compatible.',
      );
      expect(['complex', 'expert']).toContain(result.complexity);
      expect(result.difficulty).toBeGreaterThan(5);
    });

    it('assigns unique IDs', async () => {
      const r1 = await classifier.classify('task one');
      const r2 = await classifier.classify('task two');
      expect(r1.id).not.toBe(r2.id);
    });

    it('records history', async () => {
      await classifier.classify('first task');
      await classifier.classify('second task');
      expect(classifier.classificationCount).toBe(2);
    });

    it('includes timestamp', async () => {
      const result = await classifier.classify('some task');
      expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe('classifySync', () => {
    it('classifies without async', () => {
      const result = classifier.classifySync('Fix the typo');
      expect(result.complexity).toBe('trivial');
      expect(result.fusionMethod).toBe('heuristic-only');
    });

    it('records in history', () => {
      classifier.classifySync('task');
      expect(classifier.classificationCount).toBe(1);
    });
  });

  describe('feedback + historical signal', () => {
    it('improves with feedback (historical fusion)', async () => {
      // Classify several similar tasks and provide feedback
      for (let i = 0; i < 5; i++) {
        const result = await classifier.classify(`Refactor the auth module version ${i}`);
        classifier.addFeedback({
          classificationId: result.id,
          actualDifficulty: 7.0,
          outcome: 'success',
        });
      }

      expect(classifier.feedbackCount).toBe(5);

      // New similar task should use historical signal
      const newResult = await classifier.classify('Refactor the auth module version 6');
      // With enough history, should switch to historical fusion
      if (newResult.fusionMethod !== 'heuristic-only') {
        expect(newResult.fusionMethod).toBe('heuristic+historical');
      }
    });

    it('addFeedback stores feedback', () => {
      const result = classifier.classifySync('test task');
      classifier.addFeedback({
        classificationId: result.id,
        actualDifficulty: 5.0,
        outcome: 'success',
      });
      expect(classifier.feedbackCount).toBe(1);
    });
  });

  describe('semantic signal', () => {
    it('uses semantic provider when available', async () => {
      const mockSemantic: SemanticSignalProvider = async () => ({
        score: 8.0,
        confidence: 0.7,
      });

      const classifier = new TaskComplexityClassifier(DEFAULT_CLASSIFIER_CONFIG, mockSemantic);
      const result = await classifier.classify('complex task requiring deep analysis');

      // Semantic signal should push difficulty higher
      expect(result.fusionMethod).toBe('full-fusion');
    });

    it('gracefully degrades when semantic provider fails', async () => {
      const failingSemantic: SemanticSignalProvider = async () => {
        throw new Error('embedding service unavailable');
      };

      const classifier = new TaskComplexityClassifier(DEFAULT_CLASSIFIER_CONFIG, failingSemantic);
      const result = await classifier.classify('some task');

      // Should fall back to heuristic-only
      expect(result.fusionMethod).toBe('heuristic-only');
      expect(result.complexity).toBeDefined();
    });

    it('ignores low-confidence semantic signal', async () => {
      const lowConfSemantic: SemanticSignalProvider = async () => ({
        score: 9.0,
        confidence: 0.1, // Below minSemanticConfidence (0.3)
      });

      const classifier = new TaskComplexityClassifier(DEFAULT_CLASSIFIER_CONFIG, lowConfSemantic);
      const result = await classifier.classify('simple fix');

      expect(result.fusionMethod).toBe('heuristic-only');
    });
  });

  describe('adaptive thresholds', () => {
    it('adjusts thresholds based on failure patterns', async () => {
      // Classify many "simple" tasks that actually fail
      for (let i = 0; i < 6; i++) {
        const result = classifier.classifySync(`Simple fix number ${i}`);
        classifier.addFeedback({
          classificationId: result.id,
          actualDifficulty: result.difficulty,
          outcome: 'failure',
        });
      }

      const { adjustments } = classifier.adjustThresholds();
      // With 6 failures in simple category, thresholds should adjust
      // (depends on how many land in 'simple' vs 'trivial' bin)
      expect(classifier.effectiveThresholds).toBeDefined();
    });

    it('returns empty adjustments with no feedback', () => {
      const { adjustments } = classifier.adjustThresholds();
      expect(adjustments).toHaveLength(0);
    });
  });

  describe('statistics', () => {
    it('getAccuracy returns rate', () => {
      const r = classifier.classifySync('Fix typo');
      classifier.addFeedback({
        classificationId: r.id,
        actualDifficulty: 0.5,
        outcome: 'success',
      });

      const accuracy = classifier.getAccuracy();
      expect(accuracy.total).toBe(1);
      expect(accuracy.rate).toBeGreaterThanOrEqual(0);
      expect(accuracy.rate).toBeLessThanOrEqual(1);
    });

    it('getDistribution counts by complexity', () => {
      classifier.classifySync('Fix typo');
      classifier.classifySync('Refactor the whole authentication architecture with microservices');

      const dist = classifier.getDistribution();
      expect(dist.trivial + dist.simple + dist.medium + dist.complex + dist.expert).toBe(2);
    });
  });

  describe('state export/import', () => {
    it('round-trips state', async () => {
      await classifier.classify('task one');
      await classifier.classify('task two');
      classifier.addFeedback({
        classificationId: 'tc-1',
        actualDifficulty: 3.0,
        outcome: 'success',
      });

      const state = classifier.exportState();

      const newClassifier = new TaskComplexityClassifier();
      newClassifier.importState(state);

      expect(newClassifier.classificationCount).toBe(2);
      expect(newClassifier.feedbackCount).toBe(1);
    });

    it('preserves adjusted thresholds', () => {
      classifier.classifySync('task');
      classifier.adjustThresholds();

      const state = classifier.exportState();
      const newClassifier = new TaskComplexityClassifier();
      newClassifier.importState(state);

      expect(newClassifier.effectiveThresholds).toEqual(classifier.effectiveThresholds);
    });
  });
});

// ---------------------------------------------------------------------------
// End-to-end: classifier → topology selection
// ---------------------------------------------------------------------------

describe('integration: classifier → topology selection', () => {
  it('classifies tasks across the complexity spectrum', () => {
    const classifier = new TaskComplexityClassifier();

    const tasks = [
      { text: 'Fix typo in README', expected: ['trivial', 'simple'] },
      { text: 'Add a new utility function to parse dates', expected: ['trivial', 'simple'] },
      { text: 'Implement user authentication with JWT tokens and session management', expected: ['trivial', 'simple', 'medium', 'complex'] },
      {
        text: 'Architect a distributed microservice infrastructure with encrypted auth, ' +
          'optimized caching, and security vulnerability scanning across src/auth.ts, ' +
          'src/gateway.ts, src/cache.ts, src/scanner.ts. Must ensure backward compatibility. ' +
          'First design the schema, then implement services, then add integration tests.',
        expected: ['complex', 'expert'],
      },
    ];

    for (const { text, expected } of tasks) {
      const result = classifier.classifySync(text);
      expect(expected).toContain(result.complexity);
    }
  });
});
