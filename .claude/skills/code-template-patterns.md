---
name: Code Template Patterns
description: Reusable code templates and scaffolding patterns
version: 1.0.0
author: Dragonfly Framework
applies_to:
  - implementation-concept
trigger_keywords:
  - template
  - scaffold
  - boilerplate
  - generate
  - create component
  - create service
priority: P3
impact: medium
---

# Code Template Patterns Skill

## Purpose

Enable the Implementation Concept agent to generate consistent, high-quality code using project-specific templates and patterns.

## Template Categories

### 1. React Component Templates

```yaml
functional_component:
  template: |
    import React from 'react';
    import styles from './{ComponentName}.module.css';
    
    interface {ComponentName}Props {
      /** Description of prop */
      propName: string;
    }
    
    /**
     * {ComponentName} - Brief description
     */
    export const {ComponentName}: React.FC<{ComponentName}Props> = ({
      propName,
    }) => {
      return (
        <div className={styles.container}>
          {/* Component content */}
        </div>
      );
    };
    
    {ComponentName}.displayName = '{ComponentName}';

with_hooks:
  template: |
    import React, { useState, useEffect, useCallback } from 'react';
    
    interface {ComponentName}Props {
      initialValue?: string;
      onChange?: (value: string) => void;
    }
    
    export const {ComponentName}: React.FC<{ComponentName}Props> = ({
      initialValue = '',
      onChange,
    }) => {
      const [value, setValue] = useState(initialValue);
      
      useEffect(() => {
        // Effect logic
        return () => {
          // Cleanup
        };
      }, [/* dependencies */]);
      
      const handleChange = useCallback((newValue: string) => {
        setValue(newValue);
        onChange?.(newValue);
      }, [onChange]);
      
      return (
        <div>
          {/* Component content */}
        </div>
      );
    };
```

### 2. API Endpoint Templates

```yaml
rest_endpoint:
  express:
    template: |
      import { Router, Request, Response, NextFunction } from 'express';
      import { {ServiceName} } from '../services/{serviceName}';
      import { validate } from '../middleware/validation';
      import { {DtoName}Schema } from '../schemas/{dtoName}';
      
      const router = Router();
      const service = new {ServiceName}();
      
      /**
       * GET /{resource}
       * List all {resource}
       */
      router.get('/', async (req: Request, res: Response, next: NextFunction) => {
        try {
          const items = await service.findAll(req.query);
          res.json({ data: items });
        } catch (error) {
          next(error);
        }
      });
      
      /**
       * GET /{resource}/:id
       * Get single {resource}
       */
      router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
        try {
          const item = await service.findById(req.params.id);
          if (!item) {
            return res.status(404).json({ error: 'Not found' });
          }
          res.json({ data: item });
        } catch (error) {
          next(error);
        }
      });
      
      /**
       * POST /{resource}
       * Create new {resource}
       */
      router.post(
        '/',
        validate({DtoName}Schema),
        async (req: Request, res: Response, next: NextFunction) => {
          try {
            const item = await service.create(req.body);
            res.status(201).json({ data: item });
          } catch (error) {
            next(error);
          }
        }
      );
      
      export default router;
```

### 3. Service Class Templates

```yaml
service_class:
  template: |
    import { {Repository} } from '../repositories/{repository}';
    import { {Entity}, Create{Entity}Dto, Update{Entity}Dto } from '../types/{entity}';
    import { NotFoundError, ValidationError } from '../errors';
    
    export class {ServiceName} {
      constructor(private readonly repository: {Repository}) {}
      
      /**
       * Find all entities with optional filtering
       */
      async findAll(filters?: Partial<{Entity}>): Promise<{Entity}[]> {
        return this.repository.find(filters);
      }
      
      /**
       * Find entity by ID
       * @throws NotFoundError if entity doesn't exist
       */
      async findById(id: string): Promise<{Entity}> {
        const entity = await this.repository.findById(id);
        if (!entity) {
          throw new NotFoundError(`{Entity} with id ${id} not found`);
        }
        return entity;
      }
      
      /**
       * Create new entity
       */
      async create(data: Create{Entity}Dto): Promise<{Entity}> {
        await this.validateCreate(data);
        return this.repository.create(data);
      }
      
      /**
       * Update existing entity
       */
      async update(id: string, data: Update{Entity}Dto): Promise<{Entity}> {
        await this.findById(id); // Ensure exists
        await this.validateUpdate(id, data);
        return this.repository.update(id, data);
      }
      
      /**
       * Delete entity
       */
      async delete(id: string): Promise<void> {
        await this.findById(id); // Ensure exists
        await this.repository.delete(id);
      }
      
      private async validateCreate(data: Create{Entity}Dto): Promise<void> {
        // Add business validation logic
      }
      
      private async validateUpdate(id: string, data: Update{Entity}Dto): Promise<void> {
        // Add business validation logic
      }
    }
```

### 4. Test File Templates

```yaml
unit_test:
  template: |
    import { describe, it, expect, beforeEach, vi } from 'vitest';
    import { {ClassName} } from './{className}';
    
    describe('{ClassName}', () => {
      let instance: {ClassName};
      
      beforeEach(() => {
        vi.clearAllMocks();
        instance = new {ClassName}();
      });
      
      describe('{methodName}', () => {
        it('should return expected result when given valid input', () => {
          // Arrange
          const input = { /* test data */ };
          const expected = { /* expected result */ };
          
          // Act
          const result = instance.{methodName}(input);
          
          // Assert
          expect(result).toEqual(expected);
        });
        
        it('should throw error when given invalid input', () => {
          // Arrange
          const invalidInput = { /* invalid data */ };
          
          // Act & Assert
          expect(() => instance.{methodName}(invalidInput)).toThrow();
        });
      });
    });

integration_test:
  template: |
    import { describe, it, expect, beforeAll, afterAll } from 'vitest';
    import request from 'supertest';
    import { app } from '../src/app';
    import { setupTestDatabase, teardownTestDatabase } from './helpers';
    
    describe('{Endpoint} Integration', () => {
      beforeAll(async () => {
        await setupTestDatabase();
      });
      
      afterAll(async () => {
        await teardownTestDatabase();
      });
      
      describe('GET /{resource}', () => {
        it('should return list of {resource}', async () => {
          const response = await request(app)
            .get('/{resource}')
            .expect(200);
            
          expect(response.body.data).toBeInstanceOf(Array);
        });
      });
      
      describe('POST /{resource}', () => {
        it('should create new {resource}', async () => {
          const payload = { /* valid data */ };
          
          const response = await request(app)
            .post('/{resource}')
            .send(payload)
            .expect(201);
            
          expect(response.body.data).toMatchObject(payload);
        });
        
        it('should return 422 for invalid data', async () => {
          const invalidPayload = { /* invalid data */ };
          
          await request(app)
            .post('/{resource}')
            .send(invalidPayload)
            .expect(422);
        });
      });
    });
```

### 5. Database Migration Templates

```yaml
migration:
  prisma:
    template: |
      -- CreateTable
      CREATE TABLE "{TableName}" (
          "id" TEXT NOT NULL,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL,
          {columns}
          
          CONSTRAINT "{TableName}_pkey" PRIMARY KEY ("id")
      );
      
      -- CreateIndex
      CREATE INDEX "{TableName}_{indexColumn}_idx" ON "{TableName}"("{indexColumn}");
      
  knex:
    template: |
      exports.up = async function(knex) {
        return knex.schema.createTable('{table_name}', (table) => {
          table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
          table.timestamps(true, true);
          {columns}
          
          table.index(['{index_column}']);
        });
      };
      
      exports.down = async function(knex) {
        return knex.schema.dropTable('{table_name}');
      };
```

### 6. Configuration Templates

```yaml
environment_config:
  template: |
    import { z } from 'zod';
    
    const envSchema = z.object({
      NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
      PORT: z.string().transform(Number).default('3000'),
      DATABASE_URL: z.string().url(),
      JWT_SECRET: z.string().min(32),
      LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    });
    
    const parsed = envSchema.safeParse(process.env);
    
    if (!parsed.success) {
      console.error('Invalid environment variables:', parsed.error.format());
      process.exit(1);
    }
    
    export const config = parsed.data;
```

### 7. Template Variables

```yaml
template_variables:
  naming_transformations:
    PascalCase: "{ComponentName}"
    camelCase: "{componentName}"
    snake_case: "{component_name}"
    kebab-case: "{component-name}"
    SCREAMING_SNAKE: "{COMPONENT_NAME}"
    
  common_placeholders:
    - "{EntityName}": "The entity/model name"
    - "{ServiceName}": "The service class name"
    - "{RepositoryName}": "The repository name"
    - "{TableName}": "Database table name"
    - "{description}": "Brief description"
    - "{author}": "Code author"
    - "{date}": "Generation date"
```

## Output Format

```yaml
template_generation:
  request:
    type: "React component"
    name: "UserProfile"
    features:
      - "useState for form data"
      - "API integration"
      - "Error handling"
      
  generated_files:
    - path: "src/components/UserProfile/UserProfile.tsx"
      content: "{component code}"
      
    - path: "src/components/UserProfile/UserProfile.test.tsx"
      content: "{test code}"
      
    - path: "src/components/UserProfile/UserProfile.module.css"
      content: "{styles}"
      
    - path: "src/components/UserProfile/index.ts"
      content: "export { UserProfile } from './UserProfile';"
      
  next_steps:
    - "Add component to router"
    - "Implement API service method"
    - "Add form validation"
```
