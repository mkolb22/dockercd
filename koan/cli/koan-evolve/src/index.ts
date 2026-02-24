/**
 * koan-evolve: Evolutionary prompt system with fitness tracking and variant selection.
 * Phase 3: Adaptive Model Routing
 */

import { Command } from 'commander';
import { requireProjectRoot, loadProvenanceActions, wrapCliAction } from '@zen/koan-core';
import type { Concept } from '@zen/koan-core';
import type { CliOptions, ConceptFitness } from './types.js';
import { computeFitness } from './fitness/calculator.js';
import { loadFitnessState, saveFitnessState, listFitnessStates } from './fitness/loader.js';
import { renderStatus, renderFitness, renderJson } from './renderer.js';
import {
  initializePopulation,
  selectVariant,
  checkPromotion,
  archiveVariant,
  getNextVariantId,
  saveVariant,
  updateMetadata,
} from './population/manager.js';
import { mutate, crossover, buildMutationPrompt, buildCrossoverPrompt } from './population/mutator.js';
import { fullValidation, getQuarantinedVariants } from './security/variant-validator.js';
import { loadPerformanceState } from './routing/loader.js';
import { getRecommendations } from './routing/router.js';
import { generateOptimizationReport } from './routing/optimizer.js';
import { loadBudgetState, saveBudgetState } from './routing/loader.js';
import { getBudgetStatus, updateBudgetLimits } from './security/budget-enforcer.js';
import chalk from 'chalk';

async function statusCommand(options: CliOptions) {
  const projectRoot = requireProjectRoot();

  // List all fitness states
  const concepts = await listFitnessStates(projectRoot);

  if (concepts.length === 0) {
    console.log('No fitness data available yet. Run some workflows to generate fitness data.');
    return;
  }

  // Load fitness for each concept
  const statusList: ConceptFitness[] = [];
  for (const concept of concepts) {
    const state = await loadFitnessState(projectRoot, concept);
    if (state) {
      const currentVariant = state.variants.find(v => v.variant_id === state.current_variant);
      if (currentVariant) {
        statusList.push({
          concept: state.concept,
          current_variant: state.current_variant,
          current_fitness: currentVariant.fitness.current,
          runs: currentVariant.runs,
          trend: currentVariant.fitness.trend,
          variant_count: state.variants.length,
        });
      }
    }
  }

  if (options.json) {
    console.log(renderJson(statusList));
  } else {
    console.log(renderStatus(statusList));
  }
}

async function fitnessCommand(options: CliOptions) {
  const projectRoot = requireProjectRoot();

  if (!options.concept) {
    console.error('Error: --concept is required for fitness command');
    process.exit(1);
  }

  const concept = options.concept as Concept;

  // Load fitness state
  const state = await loadFitnessState(projectRoot, concept);

  if (!state) {
    console.log(`No fitness data available for concept "${concept}".`);
    console.log('Run some workflows with this concept to generate fitness data.');
    return;
  }

  if (options.json) {
    console.log(renderJson(state));
  } else {
    console.log(renderFitness(state, options.verbose || false));
  }
}

async function updateCommand(options: CliOptions) {
  const projectRoot = requireProjectRoot();

  // Load all provenance actions
  const allActions = await loadProvenanceActions(projectRoot);

  if (allActions.length === 0) {
    console.log('No provenance actions found. Nothing to update.');
    return;
  }

  // Group actions by concept
  const actionsByConcept = new Map<Concept, typeof allActions>();
  for (const action of allActions) {
    const existing = actionsByConcept.get(action.concept) || [];
    existing.push(action);
    actionsByConcept.set(action.concept, existing);
  }

  // Update fitness for each concept
  let updatedCount = 0;
  for (const [concept, actions] of actionsByConcept) {
    // For Phase 1, we assume all actions use variant-00 (baseline)
    const variantId = 'variant-00';

    // Compute fitness
    const fitnessScore = computeFitness(variantId, actions);

    // Load existing state or create new
    let state = await loadFitnessState(projectRoot, concept);
    if (!state) {
      state = {
        concept,
        current_variant: variantId,
        variants: [],
        promotion_threshold: 0.10,
        minimum_runs: 10,
        metadata: {
          last_updated: new Date().toISOString(),
          checksum: '',
        },
      };
    }

    // Update or add variant
    const existingIndex = state.variants.findIndex(v => v.variant_id === variantId);
    if (existingIndex >= 0) {
      state.variants[existingIndex] = fitnessScore;
    } else {
      state.variants.push(fitnessScore);
    }

    // Save state
    await saveFitnessState(projectRoot, state);
    updatedCount++;
  }

  console.log(`Updated fitness for ${updatedCount} concept(s).`);
}

// ============================================================================
// PHASE 5.2: PROMPT POPULATION COMMANDS
// ============================================================================

async function mutateCommand(options: CliOptions) {
  const projectRoot = requireProjectRoot();

  if (!options.concept) {
    console.error('Error: --concept is required for mutate command');
    process.exit(1);
  }

  const concept = options.concept as Concept;
  const focus = options.focus || 'general improvement';

  // Load population
  const population = await initializePopulation(projectRoot, concept);

  // Select base variant (current default)
  const baseVariant = population.variants.find(
    v => v.variant_id === population.metadata.current_default
  );

  if (!baseVariant) {
    console.error('Error: No base variant found');
    process.exit(1);
  }

  const recentFailures: string[] = [];

  // --prepare mode: output mutation prompt for Claude Code to use
  if (options.prepare) {
    const prompt = buildMutationPrompt(baseVariant, { focus, recentFailures });
    console.log(prompt);
    return;
  }

  // --content-file mode: store caller-provided content as a new variant
  if (!options.contentFile) {
    console.error('Error: --content-file <path> or --prepare is required');
    console.error('  --prepare         Output mutation prompt for Claude Code');
    console.error('  --content-file    Store generated content as a new variant');
    process.exit(1);
  }

  const fs = await import('node:fs/promises');
  const content = await fs.readFile(options.contentFile, 'utf-8');

  // Create variant from provided content
  const mutatedVariant = mutate(baseVariant, content, { focus, recentFailures });

  // Get next variant ID
  const nextId = getNextVariantId(population);
  mutatedVariant.variant_id = nextId;

  // Validate
  const validationResult = await fullValidation(projectRoot, mutatedVariant);

  if (validationResult.quarantine) {
    console.error(`✗ Variant failed validation and was quarantined`);
    console.error(`  Findings: ${validationResult.findings.length}`);
    for (const finding of validationResult.findings) {
      console.error(`  - [${finding.severity}] ${finding.pattern}`);
    }
    process.exit(1);
  }

  if (options.dryRun) {
    console.log('\n[DRY RUN] Would create variant:');
    console.log(`  ID: ${nextId}`);
    console.log(`  Parent: ${baseVariant.variant_id}`);
    console.log(`  Validation: PASSED`);
    console.log('\nPrompt preview:');
    console.log(mutatedVariant.content.split('\n').slice(0, 10).join('\n'));
    console.log('...');
    return;
  }

  // Save variant
  await saveVariant(projectRoot, concept, mutatedVariant);

  // Update metadata
  population.metadata.variants.push({
    variant_id: nextId,
    parent: baseVariant.variant_id,
    created_at: mutatedVariant.created_at,
    mutation_type: 'targeted',
    status: 'active',
  });
  await updateMetadata(projectRoot, concept, population.metadata);

  console.log(`\n✓ Generated ${nextId}`);
  console.log(`✓ Saved to .claude/prompts/${concept}/${nextId}.md`);
  console.log(`✓ Added to evolution pool`);
}

async function crossoverCommand(options: CliOptions) {
  const projectRoot = requireProjectRoot();

  if (!options.concept) {
    console.error('Error: --concept is required for crossover command');
    process.exit(1);
  }

  if (!options.parents) {
    console.error('Error: --parents is required (e.g., --parents 01,02)');
    process.exit(1);
  }

  const concept = options.concept as Concept;
  const [parentAId, parentBId] = options.parents.split(',').map(id => `variant-${id.trim().padStart(2, '0')}`);

  // Load population
  const population = await initializePopulation(projectRoot, concept);

  const variantA = population.variants.find(v => v.variant_id === parentAId);
  const variantB = population.variants.find(v => v.variant_id === parentBId);

  if (!variantA || !variantB) {
    console.error('Error: One or both parent variants not found');
    process.exit(1);
  }

  // Get fitness scores
  const fitnessA = population.fitnessState?.variants.find(v => v.variant_id === parentAId)?.fitness.current || 0.5;
  const fitnessB = population.fitnessState?.variants.find(v => v.variant_id === parentBId)?.fitness.current || 0.5;

  const crossoverConfig = { variantA, variantB, fitnessA, fitnessB };

  // --prepare mode: output crossover prompt for Claude Code to use
  if (options.prepare) {
    const prompt = buildCrossoverPrompt(crossoverConfig);
    console.log(prompt);
    return;
  }

  // --content-file mode: store caller-provided content as a new variant
  if (!options.contentFile) {
    console.error('Error: --content-file <path> or --prepare is required');
    console.error('  --prepare         Output crossover prompt for Claude Code');
    console.error('  --content-file    Store generated content as a new variant');
    process.exit(1);
  }

  const fs = await import('node:fs/promises');
  const content = await fs.readFile(options.contentFile, 'utf-8');

  // Create variant from provided content
  const crossedVariant = crossover(content, crossoverConfig);

  // Get next variant ID
  const nextId = getNextVariantId(population);
  crossedVariant.variant_id = nextId;

  // Validate
  const validationResult = await fullValidation(projectRoot, crossedVariant);

  if (validationResult.quarantine) {
    console.error(`✗ Variant failed validation and was quarantined`);
    console.error(`  Findings: ${validationResult.findings.length}`);
    process.exit(1);
  }

  if (options.dryRun) {
    console.log('\n[DRY RUN] Would create variant:');
    console.log(`  ID: ${nextId}`);
    console.log(`  Parents: ${parentAId} (${fitnessA.toFixed(3)}) × ${parentBId} (${fitnessB.toFixed(3)})`);
    console.log(`  Validation: PASSED`);
    return;
  }

  // Save variant
  await saveVariant(projectRoot, concept, crossedVariant);

  // Update metadata
  population.metadata.variants.push({
    variant_id: nextId,
    created_at: crossedVariant.created_at,
    mutation_type: 'crossover',
    parents: [parentAId, parentBId],
    status: 'active',
  });
  await updateMetadata(projectRoot, concept, population.metadata);

  console.log(`\n✓ Generated ${nextId}`);
  console.log(`✓ Saved to .claude/prompts/${concept}/${nextId}.md`);
  console.log(`✓ Added to evolution pool`);
}

async function variantsCommand(options: CliOptions) {
  const projectRoot = requireProjectRoot();

  if (!options.concept) {
    console.error('Error: --concept is required for variants command');
    process.exit(1);
  }

  const concept = options.concept as Concept;

  // Load population
  const population = await initializePopulation(projectRoot, concept);

  console.log(`\nVariants for concept: ${concept}`);
  console.log('═'.repeat(60));

  for (const variant of population.variants) {
    const fitness = population.fitnessState?.variants.find(v => v.variant_id === variant.variant_id);
    const isDefault = variant.variant_id === population.metadata.current_default;

    console.log(`\n${isDefault ? '→' : ' '} ${variant.variant_id} ${isDefault ? '(DEFAULT)' : ''}`);
    console.log(`  Status: ${variant.status}`);
    if (variant.parent) {
      console.log(`  Parent: ${variant.parent}`);
    }
    if (variant.mutation_type) {
      console.log(`  Type: ${variant.mutation_type}`);
    }
    if (fitness) {
      console.log(`  Fitness: ${fitness.fitness.current.toFixed(3)} (${fitness.runs} runs, ${fitness.fitness.trend})`);
    }
  }

  // Check for promotion
  const promotionResult = checkPromotion(population);
  if (promotionResult.promoted) {
    console.log(`\n⚡ Promotion recommended: ${promotionResult.variant_id}`);
    console.log(`   Reason: ${promotionResult.reason}`);
  }

  console.log('');
}

async function promoteCommand(options: CliOptions) {
  const projectRoot = requireProjectRoot();

  if (!options.concept || !options.variant) {
    console.error('Error: --concept and --variant are required');
    process.exit(1);
  }

  const concept = options.concept as Concept;
  const variantId = options.variant;

  // Load population
  const population = await initializePopulation(projectRoot, concept);

  const variant = population.variants.find(v => v.variant_id === variantId);
  if (!variant) {
    console.error(`Error: Variant ${variantId} not found`);
    process.exit(1);
  }

  // Update metadata
  const oldDefault = population.metadata.current_default;
  population.metadata.current_default = variantId;
  await updateMetadata(projectRoot, concept, population.metadata);

  console.log(`✓ Promoted ${variantId} to default`);
  console.log(`  Previous default: ${oldDefault}`);
}

async function quarantineListCommand() {
  const projectRoot = requireProjectRoot();

  const quarantined = await getQuarantinedVariants(projectRoot);

  if (quarantined.length === 0) {
    console.log('No quarantined variants.');
    return;
  }

  console.log(`\nQuarantined Variants (${quarantined.length})`);
  console.log('═'.repeat(60));

  for (const record of quarantined) {
    console.log(`\n${record.variant_id}`);
    console.log(`  Quarantined: ${record.quarantined_at}`);
    console.log(`  Reason: ${record.reason}`);
    console.log(`  Findings: ${record.findings.length}`);
    for (const finding of record.findings.slice(0, 3)) {
      console.log(`    - [${finding.severity}] ${finding.pattern}`);
    }
  }

  console.log('');
}

// ============================================================================
// PHASE 5.3: MODEL ROUTING COMMANDS
// ============================================================================

async function routingCommand(options: CliOptions & { recommend?: boolean }) {
  const projectRoot = requireProjectRoot();

  const performanceState = await loadPerformanceState(projectRoot);

  if (performanceState.concept_actions.length === 0) {
    console.log('No routing performance data available yet.');
    console.log('Model routing will be available once workflows have run.');
    return;
  }

  if (options.recommend) {
    // Show optimization recommendations
    const report = generateOptimizationReport(performanceState);

    if (options.json) {
      console.log(renderJson(report));
    } else {
      console.log(chalk.bold('\nModel Routing Optimization Report'));
      console.log(chalk.gray('='.repeat(60)));
      console.log(report.summary);
    }
  } else {
    // Show current routing state
    if (options.json) {
      console.log(renderJson(performanceState));
    } else {
      console.log(chalk.bold('\nModel Performance Summary'));
      console.log(chalk.gray('='.repeat(60)));

      for (const ca of performanceState.concept_actions) {
        console.log(`\n${chalk.cyan(ca.concept)}.${chalk.cyan(ca.action)}`);

        const models = Object.entries(ca.models);
        if (models.length === 0) {
          console.log(chalk.gray('  No performance data yet'));
          continue;
        }

        for (const [model, metrics] of models) {
          const successRate = (metrics.success_rate * 100).toFixed(1);
          const color = metrics.success_rate >= 0.9 ? chalk.green : metrics.success_rate >= 0.7 ? chalk.yellow : chalk.red;

          console.log(
            `  ${chalk.white(model.padEnd(8))} | ` +
            `${color(successRate.padStart(5) + '%')} success | ` +
            `${metrics.runs.toString().padStart(3)} runs | ` +
            `$${metrics.avg_cost.toFixed(4)} avg`
          );
        }
      }

      console.log('\n' + chalk.gray('Run with --recommend to see optimization opportunities'));
    }
  }
}

async function budgetCommand(options: CliOptions & { setLimit?: string }) {
  const projectRoot = requireProjectRoot();

  let budgetState = await loadBudgetState(projectRoot);

  // Handle --set-limit flag
  if (options.setLimit) {
    const match = options.setLimit.match(/^(daily|weekly|monthly)=(\d+(?:\.\d+)?)$/);
    if (!match) {
      console.error('Invalid --set-limit format. Use: daily=10.00, weekly=50.00, or monthly=200.00');
      process.exit(1);
    }

    const [, period, amount] = match;
    const value = parseFloat(amount);

    const updates: any = {};
    if (period === 'daily') updates.daily_limit_usd = value;
    if (period === 'weekly') updates.weekly_limit_usd = value;
    if (period === 'monthly') updates.monthly_limit_usd = value;

    budgetState = updateBudgetLimits(budgetState, updates);
    await saveBudgetState(projectRoot, budgetState);

    console.log(chalk.green(`Updated ${period} budget limit to $${value.toFixed(2)}`));
    return;
  }

  // Show budget status
  const status = getBudgetStatus(budgetState);

  if (options.json) {
    console.log(renderJson({ limits: budgetState.limits, status }));
  } else {
    console.log(chalk.bold('\nBudget Status'));
    console.log(chalk.gray('='.repeat(60)));

    const renderBudgetLine = (label: string, spent: number, limit: number) => {
      const remaining = limit - spent;
      const percent = (spent / limit) * 100;
      const color = percent > 90 ? chalk.red : percent > 70 ? chalk.yellow : chalk.green;

      console.log(
        `${label.padEnd(12)} | ` +
        `${color('$' + spent.toFixed(2).padStart(8))} / $${limit.toFixed(2).padStart(8)} | ` +
        `${color(percent.toFixed(0).padStart(3) + '%')} used | ` +
        `$${remaining.toFixed(2)} remaining`
      );
    };

    renderBudgetLine('Daily', status.current_daily_spend, budgetState.limits.daily_limit_usd);
    renderBudgetLine('Weekly', status.current_weekly_spend, budgetState.limits.weekly_limit_usd);
    renderBudgetLine('Monthly', status.current_monthly_spend, budgetState.limits.monthly_limit_usd);

    console.log('\n' + chalk.gray('Reset Times:'));
    console.log(chalk.gray(`  Daily:   ${new Date(status.reset_times.daily_reset).toLocaleString()}`));
    console.log(chalk.gray(`  Weekly:  ${new Date(status.reset_times.weekly_reset).toLocaleString()}`));
    console.log(chalk.gray(`  Monthly: ${new Date(status.reset_times.monthly_reset).toLocaleString()}`));

    console.log('\n' + chalk.gray('To set limits: koan-evolve budget --set-limit daily=10.00'));
  }
}

async function debateCommand(options: CliOptions) {
  const projectRoot = requireProjectRoot();

  if (options.config) {
    // Show debate configuration
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const configPath = path.join(projectRoot, 'koan/evolution/debate-config.yaml');
    try {
      const content = await fs.readFile(configPath, 'utf-8');
      console.log(content);
    } catch {
      console.log('No debate configuration found. Using defaults:');
      console.log(`
enabled: true
trigger_concepts:
  - architecture
timeout_seconds: 30
min_confidence_for_auto_accept: 0.85
require_human_approval_below: 0.70
`);
    }
    return;
  }

  if (options.list) {
    // List all debates
    const { listDebates } = await import('./debate/output.js');
    const debates = await listDebates(projectRoot);

    if (debates.length === 0) {
      console.log('No debates found yet.');
      return;
    }

    console.log(`Found ${debates.length} debates:\n`);
    for (const archId of debates) {
      console.log(`  ${archId}`);
    }
    return;
  }

  if (options.arch) {
    // Show specific debate
    const { loadDebate } = await import('./debate/output.js');
    const { renderDebate } = await import('./renderer.js');

    const debate = await loadDebate(projectRoot, options.arch);

    if (!debate) {
      console.log(`No debate found for architecture "${options.arch}".`);
      return;
    }

    if (options.json) {
      console.log(renderJson(debate));
    } else {
      console.log(renderDebate(debate));
    }
    return;
  }

  console.error('Error: Use --arch <id>, --list, or --config');
  process.exit(1);
}

export function createEvolveCommand(): Command {
  const cmd = new Command('evolve')
    .description('Evolutionary prompt system with fitness tracking and variant selection')
    .version('1.0.0');

  cmd
    .command('status')
    .description('Show evolution status for all concepts')
    .option('-j, --json', 'Output as JSON')
    .action(wrapCliAction(statusCommand));

  cmd
    .command('fitness')
    .description('Show fitness metrics for a concept')
    .option('-c, --concept <name>', 'Concept name (required)')
    .option('-v, --verbose', 'Show detailed breakdown')
    .option('-j, --json', 'Output as JSON')
    .action(wrapCliAction(fitnessCommand));

  cmd
    .command('update')
    .description('Update fitness metrics from provenance data')
    .action(wrapCliAction(updateCommand));

  // Phase 5.2: Prompt Population commands
  cmd
    .command('mutate')
    .description('Generate new variant via mutation')
    .option('-c, --concept <name>', 'Concept name (required)')
    .option('-f, --focus <description>', 'Mutation focus (e.g., "improve clarity")')
    .option('--prepare', 'Output mutation prompt for Claude Code to generate')
    .option('--content-file <path>', 'Path to file with generated mutation content')
    .option('--dry-run', 'Preview mutation without saving')
    .action(wrapCliAction(mutateCommand));

  cmd
    .command('crossover')
    .description('Generate variant from two parents')
    .option('-c, --concept <name>', 'Concept name (required)')
    .option('-p, --parents <ids>', 'Parent variant IDs (e.g., "01,02")')
    .option('--prepare', 'Output crossover prompt for Claude Code to generate')
    .option('--content-file <path>', 'Path to file with generated crossover content')
    .option('--dry-run', 'Preview crossover without saving')
    .action(wrapCliAction(crossoverCommand));

  cmd
    .command('variants')
    .description('List all variants for a concept')
    .option('-c, --concept <name>', 'Concept name (required)')
    .action(wrapCliAction(variantsCommand));

  cmd
    .command('promote')
    .description('Manually promote a variant to default')
    .option('-c, --concept <name>', 'Concept name (required)')
    .option('-v, --variant <id>', 'Variant ID to promote (e.g., "variant-01")')
    .action(wrapCliAction(promoteCommand));

  cmd
    .command('quarantine:list')
    .description('List quarantined variants')
    .action(wrapCliAction(quarantineListCommand));

  // Phase 5.3: Model Routing commands
  cmd
    .command('routing')
    .description('Show model routing decisions and performance')
    .option('--recommend', 'Show optimization recommendations')
    .option('-j, --json', 'Output as JSON')
    .action(wrapCliAction(routingCommand));

  cmd
    .command('budget')
    .description('Show budget status and limits')
    .option('--set-limit <value>', 'Set budget limit (e.g., daily=10.00)')
    .option('-j, --json', 'Output as JSON')
    .action(wrapCliAction(budgetCommand));

  // Phase 5.4: Multi-Agent Debate commands
  cmd
    .command('debate')
    .description('Show debate summary or list debates')
    .option('--arch <id>', 'Architecture ID to show debate for')
    .option('--list', 'List all recent debates')
    .option('--config', 'Show debate configuration')
    .option('-j, --json', 'Output as JSON')
    .action(wrapCliAction(debateCommand));

  return cmd;
}
