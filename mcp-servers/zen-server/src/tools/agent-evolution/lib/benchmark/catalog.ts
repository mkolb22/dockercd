/**
 * Benchmark task catalog: curated evaluation scenarios for agent fitness.
 *
 * 12 tasks across 4 agent types and 4 difficulty levels, each with:
 * - Realistic prompt and self-contained context files
 * - Multi-dimensional evaluation criteria with standard rubrics
 * - Expected elements checklist for automated scoring
 * - Target section mappings for mutation guidance
 *
 * Task distribution:
 *   story-concept:          3 tasks (trivial, simple, moderate)
 *   architecture-concept:   3 tasks (simple, moderate, complex)
 *   implementation-concept: 3 tasks (trivial, simple, moderate)
 *   quality-concept:        3 tasks (simple, moderate, complex)
 */

import type {
  BenchmarkTask,
  BenchmarkValidation,
  EvaluationCriterion,
  EvaluationDimension,
} from './schema.js';
import { STANDARD_RUBRICS, validateTask } from './schema.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a criterion with the standard rubric for its dimension.
 * Reduces boilerplate: callers only specify the varying fields.
 */
function criterion(
  id: string,
  dimension: EvaluationDimension,
  description: string,
  weight: number,
  targetSections?: readonly string[],
): EvaluationCriterion {
  return {
    id,
    dimension,
    description,
    weight,
    rubric: STANDARD_RUBRICS[dimension],
    targetSections: targetSections as EvaluationCriterion['targetSections'],
  };
}

// ---------------------------------------------------------------------------
// Story Concept Tasks
// ---------------------------------------------------------------------------

const storyDarkMode: BenchmarkTask = {
  id: 'story-dark-mode',
  name: 'Dark Mode Toggle',
  description: 'Simple feature request: add dark mode toggle to settings page',
  targetAgent: 'story-concept',
  category: 'feature',
  difficulty: 'trivial',

  prompt: 'User wants a dark mode toggle in the settings page that persists their preference.',

  context: {
    projectDescription: 'React SPA with TypeScript, using a ThemeProvider context for styling.',
    files: [
      {
        path: 'src/contexts/ThemeContext.tsx',
        language: 'tsx',
        content: `import { createContext, useContext, useState, type ReactNode } from 'react';

type Theme = 'light';

const ThemeContext = createContext<{ theme: Theme }>({ theme: 'light' });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme] = useState<Theme>('light');
  return <ThemeContext.Provider value={{ theme }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);`,
      },
      {
        path: 'src/pages/Settings.tsx',
        language: 'tsx',
        content: `import { useTheme } from '../contexts/ThemeContext';

export function Settings() {
  const { theme } = useTheme();
  return (
    <div>
      <h1>Settings</h1>
      <p>Current theme: {theme}</p>
    </div>
  );
}`,
      },
    ],
    constraints: [
      'Must persist preference across sessions (localStorage)',
      'Must respect system color-scheme preference as default',
      'Must not cause layout shift on initial load',
    ],
  },

  criteria: [
    criterion('requirements-captured', 'correctness', 'Feature requirements accurately captured with toggle, persistence, and system preference', 0.30, ['purpose', 'methodology']),
    criterion('acceptance-criteria', 'completeness', 'INVEST-compliant acceptance criteria covering all scenarios', 0.25, ['validation_rules', 'methodology']),
    criterion('story-structure', 'quality', 'Clear story structure with title, description, and testable criteria', 0.20, ['output_format', 'methodology']),
    criterion('response-efficiency', 'efficiency', 'Concise story without unnecessary elaboration', 0.15),
    criterion('safety-considerations', 'safety', 'Accessibility and WCAG contrast considerations noted', 0.10, ['constraints']),
  ],

  expectedElements: [
    'dark mode toggle UI element',
    'localStorage persistence',
    'system color-scheme preference detection',
    'acceptance criteria with Given/When/Then or equivalent',
    'accessibility considerations',
  ],

  tags: ['react', 'ui', 'theming', 'accessibility'],
};

const storyApiAuth: BenchmarkTask = {
  id: 'story-api-auth',
  name: 'API Key Authentication',
  description: 'Add API key authentication to all REST endpoints',
  targetAgent: 'story-concept',
  category: 'security',
  difficulty: 'simple',

  prompt: 'We need to add API key authentication to all our REST endpoints. Keys should be per-organization with rate limiting.',

  context: {
    projectDescription: 'Express.js REST API serving a multi-tenant SaaS platform.',
    files: [
      {
        path: 'src/server.ts',
        language: 'typescript',
        content: `import express from 'express';
import { usersRouter } from './routes/users';
import { projectsRouter } from './routes/projects';

const app = express();
app.use(express.json());
app.use('/api/users', usersRouter);
app.use('/api/projects', projectsRouter);

app.listen(3000);`,
      },
      {
        path: 'src/routes/users.ts',
        language: 'typescript',
        content: `import { Router } from 'express';

export const usersRouter = Router();

usersRouter.get('/', async (req, res) => {
  // No auth check
  const users = await db.users.findMany();
  res.json(users);
});`,
      },
    ],
    constraints: [
      'Must support per-organization API keys',
      'Must implement rate limiting (configurable per key)',
      'Must not break existing endpoints during rollout',
      'Keys must be revocable without downtime',
    ],
  },

  criteria: [
    criterion('requirements-captured', 'correctness', 'Authentication requirements cover key generation, validation, rate limiting, and revocation', 0.30, ['purpose', 'methodology']),
    criterion('acceptance-criteria', 'completeness', 'Criteria cover happy path, error cases, rate limiting, and key rotation', 0.25, ['validation_rules', 'methodology']),
    criterion('story-structure', 'quality', 'Well-organized story with security context and rollout considerations', 0.20, ['output_format']),
    criterion('response-efficiency', 'efficiency', 'Focused on requirements without implementation details', 0.15),
    criterion('security-awareness', 'safety', 'Key storage security, timing-safe comparison, and audit logging noted', 0.10, ['constraints', 'never_do']),
  ],

  expectedElements: [
    'API key generation mechanism',
    'per-organization key scoping',
    'rate limiting per key',
    'key revocation without downtime',
    'secure key storage (hashing)',
    'rollout strategy for existing endpoints',
  ],

  tags: ['auth', 'security', 'api', 'rate-limiting', 'multi-tenant'],
};

const storyRealtimeCollab: BenchmarkTask = {
  id: 'story-realtime-collab',
  name: 'Real-Time Collaborative Editing',
  description: 'Users should edit documents simultaneously with live cursors',
  targetAgent: 'story-concept',
  category: 'feature',
  difficulty: 'moderate',

  prompt: 'Users should be able to edit documents simultaneously with live cursors and real-time sync. Need conflict resolution and offline support.',

  context: {
    projectDescription: 'Document editor web app with React frontend and Node.js backend, using PostgreSQL for storage.',
    files: [
      {
        path: 'src/models/document.ts',
        language: 'typescript',
        content: `export interface Document {
  id: string;
  title: string;
  content: string;
  ownerId: string;
  updatedAt: Date;
  version: number;
}`,
      },
      {
        path: 'src/services/websocket.ts',
        language: 'typescript',
        content: `import { WebSocketServer } from 'ws';

export function createWSServer(server: any) {
  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws) => {
    ws.on('message', (data) => {
      // Broadcast to all clients (no conflict handling)
      wss.clients.forEach(client => client.send(data));
    });
  });
}`,
      },
    ],
    constraints: [
      'Must handle concurrent edits without data loss',
      'Must show live cursor positions of other users',
      'Must work offline with sync on reconnect',
      'Must support documents up to 100K characters',
      'Latency for local edits must be < 50ms',
    ],
  },

  criteria: [
    criterion('requirements-captured', 'correctness', 'Requirements cover real-time sync, conflict resolution, cursors, and offline support', 0.30, ['purpose', 'methodology']),
    criterion('acceptance-criteria', 'completeness', 'Criteria cover concurrent editing, offline, reconnect, cursor display, and document size limits', 0.25, ['validation_rules']),
    criterion('story-structure', 'quality', 'Story decomposes into coherent sub-stories with clear dependencies', 0.20, ['output_format', 'methodology']),
    criterion('response-efficiency', 'efficiency', 'Appropriately detailed for moderate complexity without over-specification', 0.15),
    criterion('safety-considerations', 'safety', 'Data integrity, conflict resolution strategy, and permission model noted', 0.10, ['constraints', 'error_handling']),
  ],

  expectedElements: [
    'CRDT or OT for conflict resolution',
    'cursor position broadcasting',
    'offline queue with sync on reconnect',
    'document versioning',
    'permission model for shared documents',
    'performance constraints (latency, document size)',
    'sub-story decomposition',
  ],

  tags: ['real-time', 'collaboration', 'websocket', 'crdt', 'offline'],
};

// ---------------------------------------------------------------------------
// Architecture Concept Tasks
// ---------------------------------------------------------------------------

const archCachingLayer: BenchmarkTask = {
  id: 'arch-caching-layer',
  name: 'Query Caching Layer',
  description: 'Design caching for frequently accessed database queries',
  targetAgent: 'architecture-concept',
  category: 'optimization',
  difficulty: 'simple',

  prompt: 'Design a caching layer for our most frequently accessed database queries. Current p99 latency is 800ms; target is < 100ms for cached queries.',

  context: {
    projectDescription: 'Node.js API with PostgreSQL, serving 10K RPM with 60% read-heavy traffic.',
    files: [
      {
        path: 'src/db/queries.ts',
        language: 'typescript',
        content: `import { Pool } from 'pg';

const pool = new Pool({ max: 20 });

export async function getUserProfile(userId: string) {
  const result = await pool.query(
    'SELECT u.*, p.* FROM users u JOIN profiles p ON u.id = p.user_id WHERE u.id = $1',
    [userId]
  );
  return result.rows[0];
}

export async function getProjectMembers(projectId: string) {
  const result = await pool.query(
    'SELECT m.*, u.name FROM members m JOIN users u ON m.user_id = u.id WHERE m.project_id = $1',
    [projectId]
  );
  return result.rows;
}`,
      },
    ],
    constraints: [
      'Must handle cache invalidation on data updates',
      'Cache must not serve stale data beyond 5 seconds for profiles',
      'Must not increase memory usage beyond 512MB for cache',
      'Must work in multi-process deployment (PM2 cluster)',
    ],
  },

  criteria: [
    criterion('design-soundness', 'correctness', 'Cache architecture addresses latency target with valid invalidation strategy', 0.25, ['core_principle', 'methodology']),
    criterion('trade-off-analysis', 'quality', 'Clear comparison of caching options (Redis vs in-memory vs hybrid) with reasoned selection', 0.25, ['methodology', 'constraints']),
    criterion('completeness-of-design', 'completeness', 'Covers cache warming, eviction, invalidation, monitoring, and failure modes', 0.20, ['methodology', 'error_handling']),
    criterion('safety-assessment', 'safety', 'Stale data bounds, memory limits, and failure fallback addressed', 0.15, ['constraints', 'error_handling']),
    criterion('response-efficiency', 'efficiency', 'Architecture decisions are crisp without unnecessary exploration', 0.15),
  ],

  expectedElements: [
    'cache technology selection with rationale',
    'invalidation strategy (TTL, event-based, or hybrid)',
    'cache key design',
    'eviction policy (LRU, LFU)',
    'multi-process cache sharing solution',
    'monitoring and hit-rate metrics',
    'graceful degradation on cache failure',
  ],

  tags: ['caching', 'performance', 'redis', 'postgresql', 'latency'],
};

const archEventSystem: BenchmarkTask = {
  id: 'arch-event-system',
  name: 'Event-Driven Notifications',
  description: 'Design event-driven notification system with multiple delivery channels',
  targetAgent: 'architecture-concept',
  category: 'feature',
  difficulty: 'moderate',

  prompt: 'Design an event-driven notification system supporting email, push, and in-app channels. Must support user preferences, delivery guarantees, and batching.',

  context: {
    projectDescription: 'Microservices architecture with 5 services, using PostgreSQL and RabbitMQ.',
    files: [
      {
        path: 'src/services/notification.ts',
        language: 'typescript',
        content: `// Current: direct synchronous notification calls
export async function notifyUser(userId: string, message: string) {
  await sendEmail(userId, message);  // Blocks request
  await sendPush(userId, message);   // Blocks request
  // No batching, no preferences, no retry
}`,
      },
      {
        path: 'src/models/user-preferences.ts',
        language: 'typescript',
        content: `export interface UserPreferences {
  userId: string;
  emailEnabled: boolean;
  pushEnabled: boolean;
  inAppEnabled: boolean;
  quietHoursStart?: string;  // HH:MM
  quietHoursEnd?: string;
  batchDigest: boolean;      // Batch non-urgent notifications
}`,
      },
    ],
    constraints: [
      'At-least-once delivery guarantee for critical notifications',
      'User preference compliance (channel opt-out, quiet hours)',
      'Batch non-urgent notifications into digests (configurable interval)',
      'Must not delay critical notifications (security alerts)',
      'Must handle 100K notifications/hour peak',
    ],
  },

  criteria: [
    criterion('design-soundness', 'correctness', 'Event-driven architecture with proper decoupling, routing, and delivery guarantees', 0.25, ['core_principle', 'methodology']),
    criterion('trade-off-analysis', 'quality', 'Clear analysis of event bus options, delivery semantics, and batching strategies', 0.25, ['methodology']),
    criterion('completeness-of-design', 'completeness', 'Covers event schema, routing, preferences, batching, DLQ, monitoring, and scaling', 0.20, ['methodology', 'state_management']),
    criterion('safety-assessment', 'safety', 'Delivery guarantees, idempotency, and failure handling addressed', 0.15, ['error_handling', 'constraints']),
    criterion('response-efficiency', 'efficiency', 'Focused architecture without over-engineering for stated scale', 0.15),
  ],

  expectedElements: [
    'event schema with priority levels',
    'channel routing based on user preferences',
    'quiet hours enforcement',
    'digest batching for non-urgent notifications',
    'dead letter queue for failed deliveries',
    'idempotency mechanism',
    'scaling strategy for 100K/hour',
    'monitoring and alerting',
  ],

  tags: ['event-driven', 'notifications', 'rabbitmq', 'microservices', 'batching'],
};

const archMigrationStrategy: BenchmarkTask = {
  id: 'arch-migration-strategy',
  name: 'Zero-Downtime Database Migration',
  description: 'Design migration from MongoDB to PostgreSQL for user service',
  targetAgent: 'architecture-concept',
  category: 'refactor',
  difficulty: 'complex',

  prompt: 'Design a zero-downtime migration from MongoDB to PostgreSQL for the user service. 10M user records, live traffic at 5K RPM. Must not lose data or increase error rate above 0.1%.',

  context: {
    projectDescription: 'Production SaaS platform with 10M users. User service handles auth, profiles, and preferences.',
    files: [
      {
        path: 'src/models/user.mongo.ts',
        language: 'typescript',
        content: `import { Schema, model } from 'mongoose';

const userSchema = new Schema({
  email: { type: String, unique: true, required: true },
  name: String,
  passwordHash: String,
  preferences: Schema.Types.Mixed,  // Schemaless JSON
  loginHistory: [{ timestamp: Date, ip: String }],
  createdAt: { type: Date, default: Date.now },
});

export const User = model('User', userSchema);`,
      },
      {
        path: 'src/services/user-service.ts',
        language: 'typescript',
        content: `import { User } from '../models/user.mongo';

export async function findByEmail(email: string) {
  return User.findOne({ email }).lean();
}

export async function updatePreferences(userId: string, prefs: any) {
  return User.findByIdAndUpdate(userId, { preferences: prefs });
}

// 47 more methods using Mongoose API...`,
      },
    ],
    constraints: [
      'Zero downtime: no maintenance window allowed',
      'No data loss: every write during migration must be captured',
      'Error rate must stay below 0.1% during migration',
      'Must support rollback at any point during migration',
      'schemaless preferences must map to structured PostgreSQL columns or JSONB',
      'loginHistory must be migrated but can be batched (not real-time)',
    ],
  },

  criteria: [
    criterion('design-soundness', 'correctness', 'Migration strategy handles dual-write, data verification, and cutover correctly', 0.25, ['core_principle', 'methodology']),
    criterion('trade-off-analysis', 'quality', 'Thorough analysis of migration approaches (dual-write vs CDC vs shadow) with reasoned selection', 0.25, ['methodology']),
    criterion('completeness-of-design', 'completeness', 'Covers schema mapping, data migration, dual-write, verification, cutover, rollback, and monitoring', 0.20, ['methodology', 'state_management']),
    criterion('safety-assessment', 'safety', 'Data integrity verification, rollback plan, and error budget monitoring', 0.15, ['error_handling', 'constraints', 'never_do']),
    criterion('response-efficiency', 'efficiency', 'Focused on decision-relevant details without unnecessary background', 0.15),
  ],

  expectedElements: [
    'schema mapping (MongoDB → PostgreSQL)',
    'dual-write or CDC mechanism',
    'bulk data migration strategy',
    'data verification/reconciliation',
    'traffic cutover plan (gradual)',
    'rollback procedure at each phase',
    'monitoring dashboard requirements',
    'error budget enforcement',
    'preferences schema design (JSONB vs columns)',
  ],

  tags: ['migration', 'mongodb', 'postgresql', 'zero-downtime', 'dual-write'],
};

// ---------------------------------------------------------------------------
// Implementation Concept Tasks
// ---------------------------------------------------------------------------

const implRateLimiter: BenchmarkTask = {
  id: 'impl-rate-limiter',
  name: 'Token Bucket Rate Limiter',
  description: 'Implement a token bucket rate limiter with configurable rate and burst',
  targetAgent: 'implementation-concept',
  category: 'feature',
  difficulty: 'trivial',

  prompt: 'Implement a token bucket rate limiter in TypeScript. Must support configurable fill rate, bucket size, and per-key tracking. Include tests.',

  context: {
    projectDescription: 'TypeScript utility library with zero external dependencies. ESM modules, vitest for testing.',
    files: [
      {
        path: 'src/types.ts',
        language: 'typescript',
        content: `export interface RateLimiterConfig {
  /** Tokens added per second. */
  fillRate: number;
  /** Maximum tokens in bucket. */
  bucketSize: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remainingTokens: number;
  retryAfterMs: number;
}`,
      },
    ],
    constraints: [
      'Zero external dependencies',
      'Must handle concurrent access safely',
      'Must use monotonic clock (not Date.now) for timing',
      'Memory for unused keys must be bounded (cleanup after inactivity)',
    ],
  },

  criteria: [
    criterion('code-correctness', 'correctness', 'Token bucket algorithm correctly tracks fill rate, consumption, and burst', 0.30, ['methodology', 'validation_rules']),
    criterion('test-coverage', 'completeness', 'Tests cover basic rate limiting, burst, refill, per-key isolation, and edge cases', 0.20, ['validation_rules', 'always_do']),
    criterion('code-quality', 'quality', 'Clean, idiomatic TypeScript with proper typing and clear naming', 0.20, ['output_format']),
    criterion('implementation-efficiency', 'efficiency', 'O(1) per check, lazy refill, bounded memory', 0.15, ['cost_optimization']),
    criterion('safety-practices', 'safety', 'No timing vulnerabilities, handles clock edge cases, bounded memory', 0.15, ['constraints', 'never_do']),
  ],

  expectedElements: [
    'token bucket class with configurable fill rate and bucket size',
    'per-key tracking with Map',
    'lazy token refill on check (not timer-based)',
    'monotonic clock usage (performance.now)',
    'cleanup of stale keys',
    'unit tests for rate limiting behavior',
  ],

  tags: ['rate-limiting', 'algorithm', 'utility', 'zero-deps'],
};

const implWebhookHandler: BenchmarkTask = {
  id: 'impl-webhook-handler',
  name: 'Webhook Receiver with Retry',
  description: 'Implement webhook receiver with signature verification and retry queue',
  targetAgent: 'implementation-concept',
  category: 'feature',
  difficulty: 'simple',

  prompt: 'Implement a webhook receiver Express middleware with HMAC-SHA256 signature verification, idempotency deduplication, and a retry queue for failed handlers.',

  context: {
    projectDescription: 'Express.js API in TypeScript, using PostgreSQL for persistence.',
    files: [
      {
        path: 'src/middleware/types.ts',
        language: 'typescript',
        content: `export interface WebhookConfig {
  secret: string;
  headerName: string;          // e.g., 'x-webhook-signature'
  maxRetries: number;
  retryDelayMs: number;        // Base delay, exponential backoff
  idempotencyWindowMs: number; // Dedup window
}

export interface WebhookEvent {
  id: string;
  type: string;
  timestamp: string;
  payload: unknown;
}`,
      },
      {
        path: 'src/db/schema.sql',
        language: 'sql',
        content: `CREATE TABLE webhook_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT DEFAULT 'pending',
  attempts INTEGER DEFAULT 0,
  next_retry_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);`,
      },
    ],
    constraints: [
      'HMAC-SHA256 signature must use timing-safe comparison',
      'Idempotency: same webhook ID processed at most once',
      'Retry with exponential backoff (base * 2^attempt)',
      'Must respond 200 to sender within 5 seconds regardless of processing outcome',
      'Must handle request body as raw buffer for signature verification',
    ],
  },

  criteria: [
    criterion('code-correctness', 'correctness', 'Signature verification, idempotency, and retry logic all function correctly', 0.30, ['methodology', 'validation_rules']),
    criterion('test-coverage', 'completeness', 'Tests cover valid/invalid signatures, duplicate events, retry behavior, and timeout', 0.20, ['validation_rules']),
    criterion('code-quality', 'quality', 'Clean middleware pattern, proper error types, clear separation of concerns', 0.20, ['output_format']),
    criterion('implementation-efficiency', 'efficiency', 'Efficient dedup lookup, bounded retry queue, no memory leaks', 0.15, ['cost_optimization']),
    criterion('security-practices', 'safety', 'Timing-safe comparison, raw body handling, no secret exposure in logs', 0.15, ['constraints', 'never_do']),
  ],

  expectedElements: [
    'HMAC-SHA256 signature verification with timing-safe compare',
    'raw body buffer parsing (before JSON middleware)',
    'idempotency check via webhook event ID',
    'immediate 200 response before processing',
    'retry queue with exponential backoff',
    'error isolation (handler failure does not affect response)',
  ],

  tags: ['webhook', 'security', 'middleware', 'retry', 'idempotency'],
};

const implTaskScheduler: BenchmarkTask = {
  id: 'impl-task-scheduler',
  name: 'Priority Task Queue',
  description: 'Implement priority task queue with configurable concurrency and cancellation',
  targetAgent: 'implementation-concept',
  category: 'feature',
  difficulty: 'moderate',

  prompt: 'Implement a priority task queue in TypeScript with configurable max concurrency, task cancellation via AbortController, and error isolation between tasks.',

  context: {
    projectDescription: 'Background job processing system in Node.js, TypeScript, zero external dependencies.',
    files: [
      {
        path: 'src/scheduler/types.ts',
        language: 'typescript',
        content: `export type TaskPriority = 'critical' | 'high' | 'normal' | 'low';

export interface TaskDefinition<T = unknown> {
  id: string;
  priority: TaskPriority;
  execute: (signal: AbortSignal) => Promise<T>;
  timeoutMs?: number;
}

export interface TaskStatus {
  id: string;
  state: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  result?: unknown;
  error?: Error;
  queuedAt: number;
  startedAt?: number;
  completedAt?: number;
}`,
      },
    ],
    constraints: [
      'Must respect priority ordering: critical > high > normal > low',
      'Concurrency limit must be strictly enforced',
      'Cancelled tasks must release their concurrency slot immediately',
      'Task timeout must use AbortController signal',
      'One task failure must not affect other running tasks',
      'Must support waiting for all tasks to complete (drain)',
    ],
  },

  criteria: [
    criterion('code-correctness', 'correctness', 'Priority ordering, concurrency control, cancellation, and timeout all work correctly', 0.30, ['methodology', 'validation_rules']),
    criterion('test-coverage', 'completeness', 'Tests cover priority ordering, concurrency limits, cancellation, timeout, error isolation, and drain', 0.20, ['validation_rules', 'always_do']),
    criterion('code-quality', 'quality', 'Clean API design, proper TypeScript generics, clear state machine for task lifecycle', 0.20, ['output_format']),
    criterion('implementation-efficiency', 'efficiency', 'Efficient priority queue structure, minimal overhead per task', 0.15, ['cost_optimization']),
    criterion('safety-practices', 'safety', 'Error isolation, proper AbortController cleanup, no unhandled rejections', 0.15, ['error_handling', 'never_do']),
  ],

  expectedElements: [
    'priority queue data structure (heap or sorted)',
    'concurrency limiter with slot tracking',
    'AbortController integration for cancellation',
    'timeout enforcement via AbortSignal.timeout or manual',
    'error isolation between concurrent tasks',
    'drain/waitAll method',
    'task lifecycle state machine',
  ],

  tags: ['concurrency', 'scheduler', 'priority-queue', 'abort-controller', 'zero-deps'],
};

// ---------------------------------------------------------------------------
// Quality Concept Tasks
// ---------------------------------------------------------------------------

const qualityAuthMiddleware: BenchmarkTask = {
  id: 'quality-auth-middleware',
  name: 'Auth Middleware Review',
  description: 'Review authentication middleware for security issues',
  targetAgent: 'quality-concept',
  category: 'security',
  difficulty: 'simple',

  prompt: 'Review this authentication middleware for security vulnerabilities, correctness issues, and code quality. Provide severity ratings and suggested fixes.',

  context: {
    projectDescription: 'Express.js API handling user authentication with JWT tokens.',
    files: [
      {
        path: 'src/middleware/auth.ts',
        language: 'typescript',
        content: `import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';

const SECRET = process.env.JWT_SECRET || 'default-secret';

export function authenticate(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, SECRET) as any;
    (req as any).user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token', details: err.message });
  }
}

export async function login(req: Request, res: Response) {
  const { username, password } = req.body;

  const user = await db.users.findOne({ username });
  if (!user) {
    return res.status(401).json({ error: 'User not found' });
  }

  if (user.password === password) {
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      SECRET,
      { expiresIn: '30d' }
    );
    return res.json({ token });
  }

  return res.status(401).json({ error: 'Wrong password' });
}`,
      },
    ],
    constraints: [
      'Focus on security-critical issues first',
      'Rate severity as: critical, high, medium, low',
      'Provide actionable fix for each issue',
    ],
  },

  criteria: [
    criterion('issues-identified', 'correctness', 'Identifies critical security flaws: plaintext password comparison, hardcoded default secret, error message leaking, excessive token lifetime', 0.30, ['methodology', 'validation_rules']),
    criterion('coverage-of-concerns', 'completeness', 'Covers all issue categories: auth bypass, information disclosure, weak defaults, missing rate limiting', 0.25, ['methodology', 'validation_rules']),
    criterion('actionability', 'quality', 'Each issue has clear severity, explanation, and concrete fix suggestion', 0.20, ['output_format']),
    criterion('safety-depth', 'safety', 'Identifies non-obvious security concerns: timing attack on password check, user enumeration via different error messages', 0.15, ['methodology', 'never_do']),
    criterion('review-efficiency', 'efficiency', 'Focused on real issues without false positives or noise', 0.10),
  ],

  expectedElements: [
    'plaintext password comparison (not bcrypt)',
    'hardcoded fallback secret',
    'error details leaking jwt internals',
    'user enumeration via distinct error messages',
    '30-day token lifetime too long',
    'no rate limiting on login',
    'missing input validation on request body',
    'any type usage instead of proper typing',
  ],

  tags: ['security-review', 'auth', 'jwt', 'vulnerabilities'],
};

const qualityDataPipeline: BenchmarkTask = {
  id: 'quality-data-pipeline',
  name: 'ETL Pipeline Review',
  description: 'Review ETL data pipeline for reliability and performance issues',
  targetAgent: 'quality-concept',
  category: 'optimization',
  difficulty: 'moderate',

  prompt: 'Review this ETL data pipeline for reliability, performance, and correctness issues. Focus on production readiness.',

  context: {
    projectDescription: 'Node.js data processing pipeline that ingests CSV files and loads into PostgreSQL.',
    files: [
      {
        path: 'src/pipeline/etl.ts',
        language: 'typescript',
        content: `import { createReadStream } from 'fs';
import { parse } from 'csv-parse';
import { Pool } from 'pg';

const pool = new Pool({ max: 5 });

export async function processFile(filePath: string) {
  const records: any[] = [];

  const parser = createReadStream(filePath).pipe(parse({ columns: true }));

  for await (const record of parser) {
    // Transform
    const transformed = {
      name: record.name.trim(),
      amount: parseFloat(record.amount),
      date: new Date(record.date),
      category: record.category?.toLowerCase(),
    };

    records.push(transformed);
  }

  // Load all at once
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const record of records) {
      await client.query(
        'INSERT INTO transactions (name, amount, date, category) VALUES ($1, $2, $3, $4)',
        [record.name, record.amount, record.date, record.category]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return { processed: records.length };
}`,
      },
    ],
    constraints: [
      'Pipeline must handle files up to 10GB',
      'Must not lose data on partial failure',
      'Must be restartable from last checkpoint',
      'Memory usage must stay under 512MB',
    ],
  },

  criteria: [
    criterion('issues-identified', 'correctness', 'Identifies memory issues (loading all records), missing validation, and single-transaction risk', 0.30, ['methodology', 'validation_rules']),
    criterion('coverage-of-concerns', 'completeness', 'Covers memory, error handling, validation, performance, resumability, and observability', 0.25, ['methodology']),
    criterion('actionability', 'quality', 'Each issue has severity, impact explanation, and concrete refactoring suggestion', 0.20, ['output_format']),
    criterion('safety-assessment', 'safety', 'Data integrity risks, NaN propagation from parseFloat, and date parsing edge cases', 0.15, ['error_handling', 'validation_rules']),
    criterion('review-efficiency', 'efficiency', 'Prioritizes high-impact issues without dwelling on style', 0.10),
  ],

  expectedElements: [
    'all records loaded into memory (OOM for large files)',
    'no streaming/chunked insertion',
    'single transaction for entire file (lock contention)',
    'no input validation (NaN from parseFloat, invalid dates)',
    'no checkpoint/resume on failure',
    'no progress reporting or observability',
    'missing null/undefined handling for optional fields',
    'no backpressure mechanism',
  ],

  tags: ['code-review', 'etl', 'performance', 'reliability', 'data-pipeline'],
};

const qualityPaymentProcessor: BenchmarkTask = {
  id: 'quality-payment-processor',
  name: 'Payment Processor Review',
  description: 'Review payment processing module for correctness and security',
  targetAgent: 'quality-concept',
  category: 'security',
  difficulty: 'complex',

  prompt: 'Review this payment processing module for correctness, security, and financial integrity. This is a critical code path handling real money.',

  context: {
    projectDescription: 'E-commerce platform payment processing module. Handles charges, refunds, and ledger entries.',
    files: [
      {
        path: 'src/payments/processor.ts',
        language: 'typescript',
        content: `import { Pool } from 'pg';

const pool = new Pool({ max: 10 });

export async function chargeCustomer(orderId: string, amount: number, currency: string) {
  const tax = amount * 0.08;
  const total = amount + tax;

  const client = await pool.connect();
  try {
    // Check order exists
    const order = await client.query(
      \`SELECT * FROM orders WHERE id = '\${orderId}'\`
    );
    if (order.rows.length === 0) throw new Error('Order not found');

    // Process payment
    const paymentResult = await externalPaymentAPI.charge({
      amount: total,
      currency,
      metadata: { orderId },
    });

    // Record in ledger
    await client.query(
      'INSERT INTO ledger (order_id, amount, type) VALUES ($1, $2, $3)',
      [orderId, total, 'charge']
    );

    return { success: true, transactionId: paymentResult.id, total };
  } catch (err) {
    console.error('Payment failed:', err);
    throw err;
  } finally {
    client.release();
  }
}

export async function refundOrder(orderId: string, amount: number) {
  const result = await pool.query(
    'SELECT * FROM ledger WHERE order_id = $1 AND type = $2',
    [orderId, 'charge']
  );

  if (result.rows.length === 0) throw new Error('No charge found');

  const originalAmount = result.rows[0].amount;
  if (amount > originalAmount) throw new Error('Refund exceeds charge');

  await externalPaymentAPI.refund({ orderId, amount });

  await pool.query(
    'INSERT INTO ledger (order_id, amount, type) VALUES ($1, $2, $3)',
    [orderId, amount, 'refund']
  );

  return { success: true, refunded: amount };
}`,
      },
    ],
    constraints: [
      'Financial code: correctness is paramount',
      'Must pass PCI-DSS relevant security checks',
      'All operations must be auditable',
      'Must handle concurrent operations safely',
    ],
  },

  criteria: [
    criterion('issues-identified', 'correctness', 'Identifies SQL injection, floating-point currency, missing transaction boundaries, and race conditions', 0.30, ['methodology', 'validation_rules']),
    criterion('coverage-of-concerns', 'completeness', 'Covers security (injection, logging), financial integrity (floating point, double charge), concurrency, auditability', 0.25, ['methodology', 'validation_rules']),
    criterion('actionability', 'quality', 'Each issue has clear severity, financial impact explanation, and production-ready fix', 0.20, ['output_format']),
    criterion('safety-depth', 'safety', 'Identifies non-obvious issues: payment API success but DB failure leaves inconsistent state, refund race condition', 0.15, ['error_handling', 'never_do']),
    criterion('review-efficiency', 'efficiency', 'Prioritizes financial and security issues over style', 0.10),
  ],

  expectedElements: [
    'SQL injection via string interpolation in orderId query',
    'floating-point arithmetic for currency (0.08 tax)',
    'no transaction boundary around payment + ledger write',
    'payment API success but ledger INSERT failure = lost record',
    'no idempotency protection against double charge',
    'race condition on concurrent refunds (total may exceed charge)',
    'missing audit trail fields (timestamp, actor, IP)',
    'sensitive data in console.error logs',
    'no currency validation or amount bounds checking',
  ],

  tags: ['security-review', 'payments', 'financial', 'sql-injection', 'critical'],
};

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

/** Complete benchmark catalog: 12 tasks across 4 agent types. */
export const BENCHMARK_CATALOG: readonly BenchmarkTask[] = [
  // Story Concept (3)
  storyDarkMode,
  storyApiAuth,
  storyRealtimeCollab,
  // Architecture Concept (3)
  archCachingLayer,
  archEventSystem,
  archMigrationStrategy,
  // Implementation Concept (3)
  implRateLimiter,
  implWebhookHandler,
  implTaskScheduler,
  // Quality Concept (3)
  qualityAuthMiddleware,
  qualityDataPipeline,
  qualityPaymentProcessor,
];

// ---------------------------------------------------------------------------
// Catalog validation
// ---------------------------------------------------------------------------

/** Validates the entire benchmark catalog for structural integrity. */
export function validateCatalog(
  catalog: readonly BenchmarkTask[] = BENCHMARK_CATALOG,
): BenchmarkValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  // No duplicate IDs
  const ids = new Set<string>();
  for (const task of catalog) {
    if (ids.has(task.id)) {
      errors.push(`duplicate task id: ${task.id}`);
    }
    ids.add(task.id);
  }

  // Validate each task individually
  for (const task of catalog) {
    const result = validateTask(task);
    for (const err of result.errors) {
      errors.push(`[${task.id}] ${err}`);
    }
    for (const warn of result.warnings) {
      warnings.push(`[${task.id}] ${warn}`);
    }
  }

  // Coverage: at least 2 agent types
  const agents = new Set(catalog.map(t => t.targetAgent));
  if (agents.size < 2) {
    warnings.push(`catalog covers only ${agents.size} agent type(s); recommend >= 2`);
  }

  // Coverage: at least 2 difficulty levels
  const difficulties = new Set(catalog.map(t => t.difficulty));
  if (difficulties.size < 2) {
    warnings.push(`catalog covers only ${difficulties.size} difficulty level(s); recommend >= 2`);
  }

  return { valid: errors.length === 0, errors, warnings };
}
