---
name: API Design Patterns
description: RESTful and GraphQL API design patterns with versioning and documentation standards
version: 1.0.0
author: Dragonfly Framework
applies_to:
  - architecture-concept
trigger_keywords:
  - api
  - rest
  - graphql
  - endpoint
  - api design
  - api versioning
priority: P2
impact: high
---

# API Design Patterns Skill

## Purpose

Guide the Architecture Concept agent in designing consistent, scalable, and well-documented APIs following industry best practices.

## RESTful API Design

### 1. Resource Naming Conventions

```yaml
naming_rules:
  resources:
    format: "plural nouns"
    examples:
      good:
        - /users
        - /orders
        - /products
      bad:
        - /getUsers
        - /user
        - /product-list
        
  nested_resources:
    format: "parent/id/child"
    max_depth: 3
    examples:
      good:
        - /users/{userId}/orders
        - /orders/{orderId}/items
      bad:
        - /users/{userId}/orders/{orderId}/items/{itemId}/reviews
        
  actions:
    format: "verb as sub-resource (when CRUD doesn't fit)"
    examples:
      - POST /orders/{orderId}/cancel
      - POST /users/{userId}/verify-email
      - POST /reports/generate
```

### 2. HTTP Methods and Status Codes

```yaml
http_methods:
  GET:
    purpose: "Retrieve resource(s)"
    idempotent: true
    safe: true
    request_body: false
    success_codes: [200]
    
  POST:
    purpose: "Create resource"
    idempotent: false
    safe: false
    request_body: true
    success_codes: [201, 202]
    
  PUT:
    purpose: "Replace resource entirely"
    idempotent: true
    safe: false
    request_body: true
    success_codes: [200, 204]
    
  PATCH:
    purpose: "Partial update"
    idempotent: false
    safe: false
    request_body: true
    success_codes: [200, 204]
    
  DELETE:
    purpose: "Remove resource"
    idempotent: true
    safe: false
    request_body: false
    success_codes: [200, 204]

status_codes:
  2xx_success:
    200: "OK - Request succeeded"
    201: "Created - Resource created"
    202: "Accepted - Processing async"
    204: "No Content - Success with no body"
    
  4xx_client_error:
    400: "Bad Request - Malformed request"
    401: "Unauthorized - Authentication required"
    403: "Forbidden - Insufficient permissions"
    404: "Not Found - Resource doesn't exist"
    409: "Conflict - Resource state conflict"
    422: "Unprocessable Entity - Validation failed"
    429: "Too Many Requests - Rate limited"
    
  5xx_server_error:
    500: "Internal Server Error - Unexpected failure"
    502: "Bad Gateway - Upstream failure"
    503: "Service Unavailable - Temporarily down"
    504: "Gateway Timeout - Upstream timeout"
```

### 3. Request/Response Patterns

```yaml
response_envelope:
  single_resource:
    data:
      id: "123"
      type: "user"
      attributes: {}
      
  collection:
    data: []
    meta:
      total: 100
      page: 1
      per_page: 20
    links:
      self: "/users?page=1"
      next: "/users?page=2"
      prev: null
      first: "/users?page=1"
      last: "/users?page=5"
      
  error:
    error:
      code: "VALIDATION_ERROR"
      message: "User-friendly message"
      details:
        - field: "email"
          message: "Invalid email format"
          code: "INVALID_FORMAT"
```

### 4. Pagination Patterns

```yaml
pagination_strategies:
  offset_based:
    pros: "Simple, allows jumping to pages"
    cons: "Inconsistent with mutations, slow for large offsets"
    params: "?page=2&per_page=20"
    use_when: "Data changes infrequently"
    
  cursor_based:
    pros: "Consistent, performant"
    cons: "Can't jump to arbitrary pages"
    params: "?cursor=eyJpZCI6MTAwfQ&limit=20"
    use_when: "Real-time data, infinite scroll"
    
  keyset_based:
    pros: "Very performant, consistent"
    cons: "Requires sortable unique field"
    params: "?after_id=100&limit=20"
    use_when: "Large datasets, sorted by ID/date"
```

### 5. Filtering, Sorting, and Fields

```yaml
query_parameters:
  filtering:
    simple: "?status=active&role=admin"
    comparison: "?price[gte]=100&price[lte]=500"
    array: "?status[]=active&status[]=pending"
    
  sorting:
    single: "?sort=created_at"
    descending: "?sort=-created_at"
    multiple: "?sort=-created_at,name"
    
  field_selection:
    sparse: "?fields=id,name,email"
    nested: "?fields[user]=id,name&fields[order]=total"
    
  including_relations:
    simple: "?include=orders"
    nested: "?include=orders.items,profile"
```

## API Versioning

```yaml
versioning_strategies:
  url_path:
    format: "/api/v1/users"
    pros: "Clear, easy to route"
    cons: "Not RESTful purist"
    recommended: true
    
  header:
    format: "Accept: application/vnd.api+json; version=1"
    pros: "Clean URLs"
    cons: "Harder to test, less visible"
    
  query_param:
    format: "/api/users?version=1"
    pros: "Simple to implement"
    cons: "Not recommended for production"

version_lifecycle:
  alpha: "Unstable, may change without notice"
  beta: "Feature complete, may have bugs"
  stable: "Production ready"
  deprecated: "Still works, will be removed"
  sunset: "Removal date announced"
  
deprecation_headers:
  Deprecation: "true"
  Sunset: "Sat, 31 Dec 2024 23:59:59 GMT"
  Link: "</api/v2/users>; rel=\"successor-version\""
```

## GraphQL Patterns

### Schema Design

```graphql
# Type naming
type User {
  id: ID!
  email: String!
  profile: UserProfile
  orders(first: Int, after: String): OrderConnection!
}

# Connection pattern for pagination
type OrderConnection {
  edges: [OrderEdge!]!
  pageInfo: PageInfo!
  totalCount: Int!
}

type OrderEdge {
  node: Order!
  cursor: String!
}

type PageInfo {
  hasNextPage: Boolean!
  hasPreviousPage: Boolean!
  startCursor: String
  endCursor: String
}

# Input types
input CreateUserInput {
  email: String!
  name: String!
  role: UserRole = USER
}

# Mutations with payload
type Mutation {
  createUser(input: CreateUserInput!): CreateUserPayload!
}

type CreateUserPayload {
  user: User
  errors: [UserError!]!
}

type UserError {
  field: String
  message: String!
  code: ErrorCode!
}
```

### Query Patterns

```yaml
graphql_patterns:
  query_complexity:
    max_depth: 5
    max_complexity: 1000
    rate_limiting: "per_complexity_point"
    
  n_plus_one_prevention:
    use: "DataLoader"
    batch_window: "16ms"
    
  field_authorization:
    directive: "@auth(requires: ADMIN)"
    resolver_level: true
```

## API Documentation

### OpenAPI/Swagger Template

```yaml
openapi: 3.1.0
info:
  title: API Name
  version: 1.0.0
  description: |
    API description with usage examples.
    
    ## Authentication
    All endpoints require Bearer token authentication.
    
    ## Rate Limiting
    - 100 requests per minute for authenticated users
    - 10 requests per minute for unauthenticated

servers:
  - url: https://api.example.com/v1
    description: Production
  - url: https://staging-api.example.com/v1
    description: Staging

paths:
  /users:
    get:
      summary: List users
      operationId: listUsers
      tags: [Users]
      parameters:
        - $ref: '#/components/parameters/PageParam'
        - $ref: '#/components/parameters/LimitParam'
      responses:
        '200':
          description: Success
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/UserList'
              examples:
                default:
                  $ref: '#/components/examples/UserListExample'
```

## API Security Checklist

```yaml
security_requirements:
  authentication:
    - [ ] OAuth2/OIDC for user authentication
    - [ ] API keys for service-to-service
    - [ ] JWT validation with proper algorithms
    
  authorization:
    - [ ] RBAC or ABAC implemented
    - [ ] Resource-level permissions checked
    - [ ] No sensitive data in URLs
    
  rate_limiting:
    - [ ] Per-user rate limits
    - [ ] Per-endpoint rate limits
    - [ ] Retry-After header on 429
    
  input_validation:
    - [ ] Schema validation on all inputs
    - [ ] Size limits on request bodies
    - [ ] Content-Type enforcement
    
  output_security:
    - [ ] No sensitive data in responses
    - [ ] Proper CORS configuration
    - [ ] Security headers set
```

## Output Format

When designing an API, produce:

1. **Endpoint specification** with methods, paths, parameters
2. **Data models** with types and validation rules
3. **Error responses** with codes and messages
4. **Authentication/authorization** requirements
5. **Rate limiting** strategy
6. **Versioning** approach
7. **OpenAPI specification** (if requested)
