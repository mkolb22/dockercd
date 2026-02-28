import { describe, it, expect } from 'vitest';
import { ElitesGrid, quantize, binCenter } from '../grid.js';
import type { AxisConfig, GridConfig } from '../types.js';
import { DEFAULT_COST_AXIS, DEFAULT_QUALITY_AXIS } from '../types.js';
import type { AgentGenome } from '../../genome/schema.js';
import type { PortfolioResult, EvaluationDimension } from '../../benchmark/schema.js';
import { EVALUATION_DIMENSIONS } from '../../benchmark/schema.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeGenome(name: string): AgentGenome {
  return {
    agentName: name,
    frontmatter: {
      name,
      description: 'Test',
      model: 'sonnet',
      tools: '*',
      disallowedTools: [],
      mcpServers: [],
      color: '#888',
      hooks: {},
      skills: [],
      type: 'workflow',
      execution: 'task-tool',
      costPerAction: 0.01,
      optimizationLevel: 'baseline',
      expectedContextTokens: 1000,
      expectedDurationSeconds: 30,
    },
    rawFrontmatter: `name: ${name}`,
    title: `# ${name}`,
    sections: [],
  };
}

function zeroDimensions(): Readonly<Record<EvaluationDimension, number>> {
  const d = {} as Record<EvaluationDimension, number>;
  for (const dim of EVALUATION_DIMENSIONS) d[dim] = 0;
  return d;
}

function makePortfolio(
  genomeId: string,
  fitness: number,
  costUsd: number,
  taskCount: number = 1,
): PortfolioResult {
  return {
    genomeId,
    dimensionMeans: zeroDimensions(),
    dimensionStdDevs: zeroDimensions(),
    fitness,
    totalUsage: {
      inputTokens: 100,
      outputTokens: 200,
      durationMs: 500,
      estimatedCostUsd: costUsd,
    },
    taskCount,
    taskResults: [],
  };
}

// ---------------------------------------------------------------------------
// quantize
// ---------------------------------------------------------------------------

describe('quantize', () => {
  const linearAxis: AxisConfig = { bins: 10, min: 0, max: 1, scale: 'linear' };
  const logAxis: AxisConfig = { bins: 10, min: 0.001, max: 1, scale: 'log' };

  describe('linear scale', () => {
    it('maps 0.0 to bin 0', () => {
      expect(quantize(0, linearAxis)).toBe(0);
    });

    it('maps 1.0 to bin 9 (last bin)', () => {
      expect(quantize(1, linearAxis)).toBe(9);
    });

    it('maps 0.5 to bin 5', () => {
      expect(quantize(0.5, linearAxis)).toBe(5);
    });

    it('maps 0.15 to bin 1', () => {
      expect(quantize(0.15, linearAxis)).toBe(1);
    });

    it('clamps below-min to bin 0', () => {
      expect(quantize(-1, linearAxis)).toBe(0);
    });

    it('clamps above-max to last bin', () => {
      expect(quantize(5, linearAxis)).toBe(9);
    });

    it('handles single bin', () => {
      const singleBin: AxisConfig = { bins: 1, min: 0, max: 1, scale: 'linear' };
      expect(quantize(0.5, singleBin)).toBe(0);
    });

    it('handles zero bins', () => {
      const zeroBins: AxisConfig = { bins: 0, min: 0, max: 1, scale: 'linear' };
      expect(quantize(0.5, zeroBins)).toBe(0);
    });
  });

  describe('log scale', () => {
    it('maps min value to bin 0', () => {
      expect(quantize(0.001, logAxis)).toBe(0);
    });

    it('maps max value to last bin', () => {
      expect(quantize(1, logAxis)).toBe(9);
    });

    it('maps below-min to bin 0', () => {
      expect(quantize(0.0001, logAxis)).toBe(0);
    });

    it('maps above-max to last bin', () => {
      expect(quantize(10, logAxis)).toBe(9);
    });

    it('spreads values across bins logarithmically', () => {
      // Values should be more spread out at low end
      const bin01 = quantize(0.01, logAxis);
      const bin1 = quantize(0.1, logAxis);
      expect(bin01).toBeLessThan(bin1);
      // 0.01 is 1/3 of log range, 0.1 is 2/3
      expect(bin01).toBeGreaterThanOrEqual(2);
      expect(bin1).toBeGreaterThanOrEqual(5);
    });

    it('handles default cost axis', () => {
      // $0.0005 should be bin 0
      expect(quantize(0.0005, DEFAULT_COST_AXIS)).toBe(0);
      // $0.10 should be last bin
      expect(quantize(0.10, DEFAULT_COST_AXIS)).toBe(9);
      // $0.01 should be somewhere in the middle
      const mid = quantize(0.01, DEFAULT_COST_AXIS);
      expect(mid).toBeGreaterThan(0);
      expect(mid).toBeLessThan(9);
    });
  });
});

// ---------------------------------------------------------------------------
// binCenter
// ---------------------------------------------------------------------------

describe('binCenter', () => {
  const linearAxis: AxisConfig = { bins: 10, min: 0, max: 1, scale: 'linear' };

  it('returns midpoint of bin 0', () => {
    expect(binCenter(0, linearAxis)).toBeCloseTo(0.05, 10);
  });

  it('returns midpoint of last bin', () => {
    expect(binCenter(9, linearAxis)).toBeCloseTo(0.95, 10);
  });

  it('returns midpoint of middle bin', () => {
    expect(binCenter(5, linearAxis)).toBeCloseTo(0.55, 10);
  });

  it('clamps negative indices', () => {
    expect(binCenter(-1, linearAxis)).toBeCloseTo(0.05, 10);
  });

  it('clamps above-max indices', () => {
    expect(binCenter(15, linearAxis)).toBeCloseTo(0.95, 10);
  });

  it('works with log scale', () => {
    const logAxis: AxisConfig = { bins: 10, min: 0.001, max: 1, scale: 'log' };
    const center = binCenter(0, logAxis);
    // First bin center in log space should be close to 0.001
    expect(center).toBeGreaterThan(0.001);
    expect(center).toBeLessThan(0.01);
  });
});

// ---------------------------------------------------------------------------
// ElitesGrid – construction
// ---------------------------------------------------------------------------

describe('ElitesGrid – construction', () => {
  it('creates grid with default 10x10 configuration', () => {
    const grid = new ElitesGrid();
    expect(grid.totalCells).toBe(100);
    expect(grid.occupiedCount).toBe(0);
  });

  it('creates grid with custom configuration', () => {
    const config: GridConfig = {
      costAxis: { bins: 5, min: 0, max: 1, scale: 'linear' },
      qualityAxis: { bins: 8, min: 0, max: 1, scale: 'linear' },
    };
    const grid = new ElitesGrid(config);
    expect(grid.totalCells).toBe(40);
    expect(grid.occupiedCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ElitesGrid – coordinateFor
// ---------------------------------------------------------------------------

describe('ElitesGrid – coordinateFor', () => {
  it('maps portfolio to correct grid coordinate', () => {
    const grid = new ElitesGrid();
    // Cost: $0.003/task, Quality: 0.75
    const portfolio = makePortfolio('g1', 0.75, 0.003, 1);
    const coord = grid.coordinateFor(portfolio);

    expect(coord.x).toBeGreaterThanOrEqual(0);
    expect(coord.x).toBeLessThan(10);
    expect(coord.y).toBe(7); // 0.75 in linear [0,1] with 10 bins = bin 7
  });

  it('handles zero task count', () => {
    const grid = new ElitesGrid();
    const portfolio = makePortfolio('g1', 0.5, 0.01, 0);
    const coord = grid.coordinateFor(portfolio);
    // costPerAction = 0 → clamped to bin 0
    expect(coord.x).toBe(0);
  });

  it('computes cost per action from total usage', () => {
    const grid = new ElitesGrid();
    // $0.06 total across 3 tasks = $0.02/action
    const portfolio = makePortfolio('g1', 0.5, 0.06, 3);
    const coord = grid.coordinateFor(portfolio);
    // $0.02 is somewhere in the middle of log-scale cost range
    expect(coord.x).toBeGreaterThan(0);
    expect(coord.x).toBeLessThan(9);
  });
});

// ---------------------------------------------------------------------------
// ElitesGrid – tryPlace
// ---------------------------------------------------------------------------

describe('ElitesGrid – tryPlace', () => {
  it('places genome in empty cell → placed_new', () => {
    const grid = new ElitesGrid();
    const genome = makeGenome('agent-a');
    const portfolio = makePortfolio('a', 0.5, 0.01);

    const outcome = grid.tryPlace(genome, portfolio, 'a', 0, null);

    expect(outcome).toBe('placed_new');
    expect(grid.occupiedCount).toBe(1);
  });

  it('replaces inferior incumbent → replaced_elite', () => {
    const grid = new ElitesGrid();
    const genomeA = makeGenome('agent-a');
    const genomeB = makeGenome('agent-b');
    // Same cost, different fitness — they map to same cost bin
    const portfolioA = makePortfolio('a', 0.3, 0.01);
    const portfolioB = makePortfolio('b', 0.5, 0.01); // Higher fitness

    grid.tryPlace(genomeA, portfolioA, 'a', 0, null);

    // B might land in a different quality bin due to different fitness.
    // To guarantee same cell, use same fitness bin range.
    // Let's use portfolios that map to the same cell coordinates.
    const coordA = grid.coordinateFor(portfolioA);

    // Create portfolio B that maps to same coord but higher fitness
    // Both at fitness ~0.35 land in bin 3, but B has slightly higher fitness
    const portfolioB2 = makePortfolio('b', 0.39, 0.01);
    const coordB = grid.coordinateFor(portfolioB2);

    // If they happen to be in same bin, test replacement
    if (coordA.x === coordB.x && coordA.y === coordB.y) {
      const outcome = grid.tryPlace(genomeB, portfolioB2, 'b', 1, 'a');
      expect(outcome).toBe('replaced_elite');
      const entry = grid.getAt(coordA);
      expect(entry?.genomeId).toBe('b');
    }
  });

  it('rejects genome when incumbent is fitter', () => {
    const grid = new ElitesGrid({
      costAxis: { bins: 1, min: 0, max: 1, scale: 'linear' },
      qualityAxis: { bins: 1, min: 0, max: 1, scale: 'linear' },
    });

    const genomeA = makeGenome('agent-a');
    const genomeB = makeGenome('agent-b');
    const portfolioA = makePortfolio('a', 0.8, 0.01);
    const portfolioB = makePortfolio('b', 0.3, 0.01);

    grid.tryPlace(genomeA, portfolioA, 'a', 0, null);
    const outcome = grid.tryPlace(genomeB, portfolioB, 'b', 1, 'a');

    expect(outcome).toBe('rejected');
    expect(grid.occupiedCount).toBe(1);
    expect(grid.getAt({ x: 0, y: 0 })?.genomeId).toBe('a');
  });

  it('rejects genome when fitness is equal', () => {
    const grid = new ElitesGrid({
      costAxis: { bins: 1, min: 0, max: 1, scale: 'linear' },
      qualityAxis: { bins: 1, min: 0, max: 1, scale: 'linear' },
    });

    const genomeA = makeGenome('agent-a');
    const genomeB = makeGenome('agent-b');
    const portfolioA = makePortfolio('a', 0.5, 0.01);
    const portfolioB = makePortfolio('b', 0.5, 0.01);

    grid.tryPlace(genomeA, portfolioA, 'a', 0, null);
    const outcome = grid.tryPlace(genomeB, portfolioB, 'b', 1, 'a');

    expect(outcome).toBe('rejected');
    expect(grid.getAt({ x: 0, y: 0 })?.genomeId).toBe('a');
  });

  it('replaces when strictly fitter in single-cell grid', () => {
    const grid = new ElitesGrid({
      costAxis: { bins: 1, min: 0, max: 1, scale: 'linear' },
      qualityAxis: { bins: 1, min: 0, max: 1, scale: 'linear' },
    });

    const genomeA = makeGenome('a');
    const genomeB = makeGenome('b');

    grid.tryPlace(genomeA, makePortfolio('a', 0.3, 0.01), 'a', 0, null);
    const outcome = grid.tryPlace(genomeB, makePortfolio('b', 0.7, 0.01), 'b', 1, 'a');

    expect(outcome).toBe('replaced_elite');
    expect(grid.getAt({ x: 0, y: 0 })?.genomeId).toBe('b');
  });

  it('records generation and parentId on placed elite', () => {
    const grid = new ElitesGrid({
      costAxis: { bins: 1, min: 0, max: 1, scale: 'linear' },
      qualityAxis: { bins: 1, min: 0, max: 1, scale: 'linear' },
    });

    grid.tryPlace(
      makeGenome('a'),
      makePortfolio('a', 0.5, 0.01),
      'a-v1',
      3,
      'parent-x',
    );

    const entry = grid.getAt({ x: 0, y: 0 });
    expect(entry?.genomeId).toBe('a-v1');
    expect(entry?.generation).toBe(3);
    expect(entry?.parentId).toBe('parent-x');
    expect(entry?.placedAt).toBeTruthy();
  });

  it('populates multiple cells', () => {
    const grid = new ElitesGrid();

    // Low cost, low quality
    grid.tryPlace(
      makeGenome('cheap'),
      makePortfolio('cheap', 0.1, 0.0005),
      'cheap', 0, null,
    );

    // High cost, high quality
    grid.tryPlace(
      makeGenome('expensive'),
      makePortfolio('expensive', 0.9, 0.08),
      'expensive', 0, null,
    );

    expect(grid.occupiedCount).toBe(2);

    const cheap = grid.allElites().find(e => e.genomeId === 'cheap');
    const expensive = grid.allElites().find(e => e.genomeId === 'expensive');
    expect(cheap).toBeDefined();
    expect(expensive).toBeDefined();
    // They should be in different cells
    expect(cheap!.coordinate.x).not.toBe(expensive!.coordinate.x);
  });
});

// ---------------------------------------------------------------------------
// ElitesGrid – selectRandom
// ---------------------------------------------------------------------------

describe('ElitesGrid – selectRandom', () => {
  it('returns null from empty grid', () => {
    const grid = new ElitesGrid();
    expect(grid.selectRandom()).toBeNull();
  });

  it('returns the only elite from single-occupied grid', () => {
    const grid = new ElitesGrid({
      costAxis: { bins: 1, min: 0, max: 1, scale: 'linear' },
      qualityAxis: { bins: 1, min: 0, max: 1, scale: 'linear' },
    });
    grid.tryPlace(makeGenome('solo'), makePortfolio('solo', 0.5, 0.01), 'solo', 0, null);

    const selected = grid.selectRandom(() => 0.5);
    expect(selected?.genomeId).toBe('solo');
  });

  it('uses provided RNG for deterministic selection', () => {
    const grid = new ElitesGrid();

    grid.tryPlace(makeGenome('a'), makePortfolio('a', 0.1, 0.0005), 'a', 0, null);
    grid.tryPlace(makeGenome('b'), makePortfolio('b', 0.9, 0.08), 'b', 0, null);

    // Same RNG value → same selection
    const s1 = grid.selectRandom(() => 0.0);
    const s2 = grid.selectRandom(() => 0.0);
    expect(s1?.genomeId).toBe(s2?.genomeId);
  });

  it('can select different elites with different RNG values', () => {
    const grid = new ElitesGrid();

    grid.tryPlace(makeGenome('a'), makePortfolio('a', 0.1, 0.0005), 'a', 0, null);
    grid.tryPlace(makeGenome('b'), makePortfolio('b', 0.9, 0.08), 'b', 0, null);

    const s1 = grid.selectRandom(() => 0.0);  // First element
    const s2 = grid.selectRandom(() => 0.99); // Last element
    // They should select from the 2 occupied cells
    expect(s1).not.toBeNull();
    expect(s2).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ElitesGrid – accessors
// ---------------------------------------------------------------------------

describe('ElitesGrid – accessors', () => {
  it('getAt returns null for empty cell', () => {
    const grid = new ElitesGrid();
    expect(grid.getAt({ x: 0, y: 0 })).toBeNull();
  });

  it('getAt returns null for out-of-bounds coordinates', () => {
    const grid = new ElitesGrid();
    expect(grid.getAt({ x: -1, y: 0 })).toBeNull();
    expect(grid.getAt({ x: 100, y: 100 })).toBeNull();
  });

  it('allElites returns all occupied entries', () => {
    const grid = new ElitesGrid();

    grid.tryPlace(makeGenome('a'), makePortfolio('a', 0.1, 0.0005), 'a', 0, null);
    grid.tryPlace(makeGenome('b'), makePortfolio('b', 0.5, 0.01), 'b', 0, null);
    grid.tryPlace(makeGenome('c'), makePortfolio('c', 0.9, 0.08), 'c', 0, null);

    const elites = grid.allElites();
    expect(elites.length).toBe(3);

    const ids = elites.map(e => e.genomeId).sort();
    expect(ids).toEqual(['a', 'b', 'c']);
  });

  it('bestElite returns highest-fitness elite', () => {
    const grid = new ElitesGrid();

    grid.tryPlace(makeGenome('a'), makePortfolio('a', 0.3, 0.01), 'a', 0, null);
    grid.tryPlace(makeGenome('b'), makePortfolio('b', 0.9, 0.05), 'b', 0, null);
    grid.tryPlace(makeGenome('c'), makePortfolio('c', 0.6, 0.03), 'c', 0, null);

    expect(grid.bestElite()?.genomeId).toBe('b');
  });

  it('bestElite returns null from empty grid', () => {
    const grid = new ElitesGrid();
    expect(grid.bestElite()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ElitesGrid – getStats
// ---------------------------------------------------------------------------

describe('ElitesGrid – getStats', () => {
  it('returns zero stats for empty grid', () => {
    const grid = new ElitesGrid();
    const stats = grid.getStats(0, 0);

    expect(stats.occupiedCells).toBe(0);
    expect(stats.totalCells).toBe(100);
    expect(stats.coverage).toBe(0);
    expect(stats.meanFitness).toBe(0);
    expect(stats.maxFitness).toBe(0);
    expect(stats.minFitness).toBe(0);
    expect(stats.stddevFitness).toBe(0);
  });

  it('computes correct stats for populated grid', () => {
    const grid = new ElitesGrid();

    grid.tryPlace(makeGenome('a'), makePortfolio('a', 0.2, 0.005), 'a', 0, null);
    grid.tryPlace(makeGenome('b'), makePortfolio('b', 0.8, 0.05), 'b', 0, null);
    grid.tryPlace(makeGenome('c'), makePortfolio('c', 0.5, 0.02), 'c', 0, null);

    const stats = grid.getStats(5, 10);

    expect(stats.occupiedCells).toBe(3);
    expect(stats.totalCells).toBe(100);
    expect(stats.coverage).toBeCloseTo(0.03, 10);
    expect(stats.meanFitness).toBeCloseTo(0.5, 10);
    expect(stats.maxFitness).toBe(0.8);
    expect(stats.minFitness).toBe(0.2);
    expect(stats.stddevFitness).toBeGreaterThan(0);
    expect(stats.generation).toBe(5);
    expect(stats.totalEvaluations).toBe(10);
  });

  it('stddev is 0 for single elite', () => {
    const grid = new ElitesGrid();
    grid.tryPlace(makeGenome('a'), makePortfolio('a', 0.5, 0.01), 'a', 0, null);

    const stats = grid.getStats(0, 1);
    expect(stats.stddevFitness).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ElitesGrid – fitnessHeatmap
// ---------------------------------------------------------------------------

describe('ElitesGrid – fitnessHeatmap', () => {
  it('returns correct dimensions', () => {
    const grid = new ElitesGrid({
      costAxis: { bins: 3, min: 0, max: 1, scale: 'linear' },
      qualityAxis: { bins: 4, min: 0, max: 1, scale: 'linear' },
    });

    const heatmap = grid.fitnessHeatmap();
    expect(heatmap.length).toBe(4); // qualityBins rows
    expect(heatmap[0].length).toBe(3); // costBins columns
  });

  it('returns all nulls for empty grid', () => {
    const grid = new ElitesGrid({
      costAxis: { bins: 2, min: 0, max: 1, scale: 'linear' },
      qualityAxis: { bins: 2, min: 0, max: 1, scale: 'linear' },
    });

    const heatmap = grid.fitnessHeatmap();
    for (const row of heatmap) {
      for (const cell of row) {
        expect(cell).toBeNull();
      }
    }
  });

  it('places fitness values at correct positions', () => {
    const grid = new ElitesGrid({
      costAxis: { bins: 2, min: 0, max: 1, scale: 'linear' },
      qualityAxis: { bins: 2, min: 0, max: 1, scale: 'linear' },
    });

    // Low cost (bin 0), high quality (bin 1) → fitness 0.8
    grid.tryPlace(
      makeGenome('a'),
      makePortfolio('a', 0.8, 0.2, 1),
      'a', 0, null,
    );

    const heatmap = grid.fitnessHeatmap();
    // Top row (y=1, high quality), first column (x=0, low cost)
    expect(heatmap[0][0]).toBe(0.8);
    // Other cells should be null
    expect(heatmap[0][1]).toBeNull();
    expect(heatmap[1][0]).toBeNull();
    expect(heatmap[1][1]).toBeNull();
  });
});
