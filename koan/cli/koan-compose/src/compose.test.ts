import { describe, it, expect } from 'vitest';
import {
  parsePipeline,
  validatePipeline,
  renderPipeline,
  renderConceptList,
  renderPipelineJson,
  parseConceptRef,
  KNOWN_CONCEPTS,
} from './compose.js';

// --- parseConceptRef ---

describe('parseConceptRef', () => {
  it('parses simple concept', () => {
    const ref = parseConceptRef('architecture');
    expect(ref).toEqual({ concept: 'architecture' });
  });

  it('parses concept with model hint', () => {
    const ref = parseConceptRef('architecture:opus');
    expect(ref).toEqual({ concept: 'architecture', model: 'opus' });
  });

  it('parses concept with action', () => {
    const ref = parseConceptRef('quality.review');
    expect(ref).toEqual({ concept: 'quality', action: 'review' });
  });

  it('parses concept with action and model', () => {
    const ref = parseConceptRef('quality.review:sonnet');
    expect(ref).toEqual({ concept: 'quality', action: 'review', model: 'sonnet' });
  });

  it('parses concept with passes', () => {
    const ref = parseConceptRef('verification[2]');
    expect(ref).toEqual({ concept: 'verification', passes: 2 });
  });

  it('parses concept with passes and model', () => {
    const ref = parseConceptRef('verification[2]:sonnet');
    expect(ref).toEqual({ concept: 'verification', passes: 2, model: 'sonnet' });
  });

  it('resolves aliases', () => {
    const ref = parseConceptRef('arch:opus');
    expect(ref.concept).toBe('architecture');
  });

  it('handles whitespace', () => {
    const ref = parseConceptRef('  architecture:opus  ');
    expect(ref.concept).toBe('architecture');
    expect(ref.model).toBe('opus');
  });

  it('is case-insensitive for model', () => {
    const ref = parseConceptRef('architecture:OPUS');
    expect(ref.model).toBe('opus');
  });
});

// --- parsePipeline ---

describe('parsePipeline', () => {
  it('parses simple sequential pipeline', () => {
    const p = parsePipeline('story | architecture | implementation');
    expect(p.steps).toHaveLength(3);
    expect(p.steps[0].type).toBe('sequential');
    expect(p.steps[0].concepts).toEqual(['story']);
    expect(p.steps[1].concepts).toEqual(['architecture']);
    expect(p.steps[2].concepts).toEqual(['implementation']);
  });

  it('parses parallel steps', () => {
    const p = parsePipeline('story | parallel(architecture, security) | implementation');
    expect(p.steps).toHaveLength(3);
    expect(p.steps[1].type).toBe('parallel');
    expect(p.steps[1].concepts).toEqual(['architecture', 'security']);
  });

  it('resolves aliases', () => {
    const p = parsePipeline('story | arch | impl | qa | ship');
    expect(p.steps[1].concepts[0]).toBe('architecture');
    expect(p.steps[2].concepts[0]).toBe('implementation');
    expect(p.steps[3].concepts[0]).toBe('quality');
    expect(p.steps[4].concepts[0]).toBe('version');
  });

  it('resolves aliases in parallel', () => {
    const p = parsePipeline('parallel(arch, sec)');
    expect(p.steps[0].concepts).toEqual(['architecture', 'security']);
  });

  it('handles empty input', () => {
    const p = parsePipeline('');
    expect(p.steps).toEqual([]);
  });

  it('trims whitespace', () => {
    const p = parsePipeline('  story  |  architecture  ');
    expect(p.steps).toHaveLength(2);
    expect(p.steps[0].concepts[0]).toBe('story');
  });

  it('preserves raw input', () => {
    const p = parsePipeline('story | arch');
    expect(p.raw).toBe('story | arch');
  });

  it('is case-insensitive', () => {
    const p = parsePipeline('Story | ARCHITECTURE');
    expect(p.steps[0].concepts[0]).toBe('story');
    expect(p.steps[1].concepts[0]).toBe('architecture');
  });

  it('parses single concept', () => {
    const p = parsePipeline('story');
    expect(p.steps).toHaveLength(1);
    expect(p.steps[0].concepts).toEqual(['story']);
  });

  it('handles parallel with many concepts', () => {
    const p = parsePipeline('parallel(quality, security, verification)');
    expect(p.steps[0].concepts).toEqual(['quality', 'security', 'verification']);
  });
});

// --- validatePipeline ---

describe('validatePipeline', () => {
  it('validates correct pipeline', () => {
    const p = parsePipeline('story | architecture | implementation');
    const v = validatePipeline(p);
    expect(v.valid).toBe(true);
    expect(v.errors).toEqual([]);
  });

  it('rejects unknown concepts', () => {
    const p = parsePipeline('story | banana | implementation');
    const v = validatePipeline(p);
    expect(v.valid).toBe(false);
    expect(v.errors[0].message).toContain('Unknown concept: banana');
    expect(v.errors[0].step).toBe(2);
  });

  it('rejects empty pipeline', () => {
    const p = parsePipeline('');
    const v = validatePipeline(p);
    expect(v.valid).toBe(false);
    expect(v.errors[0].message).toContain('empty');
  });

  it('rejects parallel with single concept', () => {
    const p = parsePipeline('parallel(architecture)');
    const v = validatePipeline(p);
    expect(v.valid).toBe(false);
    expect(v.errors[0].message).toContain('at least 2');
  });

  it('warns about duplicate concepts', () => {
    const p = parsePipeline('story | architecture | story');
    const v = validatePipeline(p);
    expect(v.valid).toBe(true); // duplicates are warnings, not errors
    expect(v.warnings.length).toBeGreaterThan(0);
    expect(v.warnings[0]).toContain('more than once');
  });

  it('warns when story is not first', () => {
    const p = parsePipeline('architecture | story | implementation');
    const v = validatePipeline(p);
    expect(v.warnings.some(w => w.includes('not the first step'))).toBe(true);
  });

  it('warns when implementation precedes architecture', () => {
    const p = parsePipeline('story | implementation | architecture');
    const v = validatePipeline(p);
    expect(v.warnings.some(w => w.includes('precedes architecture'))).toBe(true);
  });

  it('validates parallel steps with known concepts', () => {
    const p = parsePipeline('story | parallel(architecture, security) | implementation');
    const v = validatePipeline(p);
    expect(v.valid).toBe(true);
  });

  it('rejects unknown concept in parallel', () => {
    const p = parsePipeline('parallel(architecture, bogus)');
    const v = validatePipeline(p);
    expect(v.valid).toBe(false);
    expect(v.errors[0].message).toContain('bogus');
  });

  it('no warnings for clean pipeline', () => {
    const p = parsePipeline('story | architecture | implementation | quality');
    const v = validatePipeline(p);
    expect(v.warnings).toEqual([]);
  });
});

// --- renderPipeline ---

describe('renderPipeline', () => {
  it('renders sequential steps with brackets', () => {
    const p = parsePipeline('story | architecture');
    const output = renderPipeline(p);
    expect(output).toContain('story');
    expect(output).toContain('architecture');
  });

  it('renders parallel steps in a box', () => {
    const p = parsePipeline('parallel(architecture, security)');
    const output = renderPipeline(p);
    expect(output).toContain('architecture');
    expect(output).toContain('security');
  });

  it('shows validation errors', () => {
    const p = parsePipeline('story | banana');
    const v = validatePipeline(p);
    const output = renderPipeline(p, v);
    expect(output).toContain('errors');
    expect(output).toContain('banana');
  });

  it('shows valid indicator', () => {
    const p = parsePipeline('story | architecture');
    const v = validatePipeline(p);
    const output = renderPipeline(p, v);
    expect(output).toContain('valid');
  });

  it('shows warnings', () => {
    const p = parsePipeline('architecture | story');
    const v = validatePipeline(p);
    const output = renderPipeline(p, v);
    expect(output).toContain('not the first');
  });

  it('includes raw pipeline in header', () => {
    const p = parsePipeline('story | impl');
    const output = renderPipeline(p);
    expect(output).toContain('story | impl');
  });
});

// --- renderConceptList ---

describe('renderConceptList', () => {
  it('lists all known concepts', () => {
    const output = renderConceptList();
    for (const concept of KNOWN_CONCEPTS) {
      expect(output).toContain(concept);
    }
  });

  it('shows aliases', () => {
    const output = renderConceptList();
    expect(output).toContain('arch');
    expect(output).toContain('impl');
    expect(output).toContain('verify');
    expect(output).toContain('ship');
  });

  it('shows syntax hint', () => {
    const output = renderConceptList();
    expect(output).toContain('parallel');
  });
});

// --- renderPipelineJson ---

describe('renderPipelineJson', () => {
  it('returns valid JSON', () => {
    const p = parsePipeline('story | architecture');
    const v = validatePipeline(p);
    const json = renderPipelineJson(p, v);
    const parsed = JSON.parse(json);
    expect(parsed.pipeline.steps).toHaveLength(2);
    expect(parsed.validation.valid).toBe(true);
  });

  it('includes errors in JSON', () => {
    const p = parsePipeline('story | banana');
    const v = validatePipeline(p);
    const parsed = JSON.parse(renderPipelineJson(p, v));
    expect(parsed.validation.valid).toBe(false);
    expect(parsed.validation.errors).toHaveLength(1);
  });

  it('preserves pipeline structure', () => {
    const p = parsePipeline('story | parallel(arch, sec) | impl');
    const v = validatePipeline(p);
    const parsed = JSON.parse(renderPipelineJson(p, v));
    expect(parsed.pipeline.steps[1].type).toBe('parallel');
    expect(parsed.pipeline.steps[1].concepts).toEqual(['architecture', 'security']);
  });
});

// --- Extended Syntax (v2) ---

describe('extended syntax', () => {
  describe('annotations', () => {
    it('parses @slo annotation', () => {
      const p = parsePipeline('story | architecture @slo:standard');
      expect(p.annotations.slo).toBe('standard');
      expect(p.steps).toHaveLength(2);
    });

    it('parses @errors annotation', () => {
      const p = parsePipeline('story | arch @errors:graceful');
      expect(p.annotations.errors).toBe('graceful');
    });

    it('parses both annotations', () => {
      const p = parsePipeline('story | architecture @slo:standard @errors:graceful');
      expect(p.annotations.slo).toBe('standard');
      expect(p.annotations.errors).toBe('graceful');
    });

    it('handles annotations in any order', () => {
      const p = parsePipeline('story @errors:strict @slo:fast');
      expect(p.annotations.slo).toBe('fast');
      expect(p.annotations.errors).toBe('strict');
    });

    it('empty annotations by default', () => {
      const p = parsePipeline('story | architecture');
      expect(p.annotations).toEqual({});
    });
  });

  describe('model hints', () => {
    it('parses model hint in step', () => {
      const p = parsePipeline('story | architecture:opus | implementation:sonnet');
      expect(p.steps[1].conceptRefs[0].model).toBe('opus');
      expect(p.steps[2].conceptRefs[0].model).toBe('sonnet');
    });

    it('validates known models', () => {
      const p = parsePipeline('architecture:unknown');
      const v = validatePipeline(p);
      expect(v.errors.some(e => e.message.includes('Unknown model'))).toBe(true);
    });
  });

  describe('pass counts', () => {
    it('parses pass count', () => {
      const p = parsePipeline('verification[2]');
      expect(p.steps[0].conceptRefs[0].passes).toBe(2);
    });

    it('parses pass count with model', () => {
      const p = parsePipeline('verification[3]:sonnet');
      expect(p.steps[0].conceptRefs[0].passes).toBe(3);
      expect(p.steps[0].conceptRefs[0].model).toBe('sonnet');
    });

    it('warns about unusual pass counts', () => {
      const p = parsePipeline('verification[10]');
      const v = validatePipeline(p);
      expect(v.warnings.some(w => w.includes('unusual'))).toBe(true);
    });
  });

  describe('actions', () => {
    it('parses concept with action', () => {
      const p = parsePipeline('quality.review | quality.test');
      expect(p.steps[0].conceptRefs[0].concept).toBe('quality');
      expect(p.steps[0].conceptRefs[0].action).toBe('review');
      expect(p.steps[1].conceptRefs[0].action).toBe('test');
    });

    it('allows same concept with different actions', () => {
      const p = parsePipeline('quality.review | quality.test');
      const v = validatePipeline(p);
      // Should not warn about duplicates because actions are different
      expect(v.warnings.filter(w => w.includes('more than once'))).toHaveLength(0);
    });
  });

  describe('parallel with extended syntax', () => {
    it('parses parallel with model hints', () => {
      const p = parsePipeline('parallel(architecture:opus, security:sonnet)');
      expect(p.steps[0].conceptRefs[0].model).toBe('opus');
      expect(p.steps[0].conceptRefs[1].model).toBe('sonnet');
    });

    it('parses parallel with actions', () => {
      const p = parsePipeline('parallel(quality.review, quality.test)');
      expect(p.steps[0].conceptRefs[0].action).toBe('review');
      expect(p.steps[0].conceptRefs[1].action).toBe('test');
    });
  });

  describe('complex pipelines', () => {
    it('parses full workflow with all features', () => {
      const p = parsePipeline(
        'story | parallel(code-analysis, security) | architecture:opus | verification[2] | implementation:sonnet | parallel(quality.review, quality.test) | version @slo:standard @errors:graceful'
      );
      expect(p.steps).toHaveLength(7);
      expect(p.steps[2].conceptRefs[0].model).toBe('opus');
      expect(p.steps[3].conceptRefs[0].passes).toBe(2);
      expect(p.annotations.slo).toBe('standard');
      expect(p.annotations.errors).toBe('graceful');
    });
  });
});
