---
name: Security Design Patterns
description: Apply OWASP-aligned security patterns during architecture design to prevent vulnerabilities from the start
version: 1.0.0
trigger_keywords: [security, auth, authorization, encryption, OWASP, vulnerability, authentication, password, token, session]
author: Zen Architecture
applies_to: [architecture-concept]
priority: P0
impact: critical
---

# Security Design Patterns - Expert Skill

Apply security best practices during architecture design to prevent vulnerabilities before they're implemented.

## Purpose

Security design patterns provide:
- **Prevention over detection**: Catch security issues at design time, not production
- **OWASP alignment**: Industry-standard security checklist
- **Cost savings**: Security retrofits are 10x more expensive than design-time fixes
- **Compliance readiness**: Meet security audit requirements from the start

## When to Use

Use security design patterns when:
- ✅ Designing authentication or authorization systems
- ✅ Handling sensitive data (PII, credentials, financial)
- ✅ Creating API endpoints exposed to users
- ✅ Integrating with third-party services
- ✅ Processing user input of any kind
- ✅ Storing or transmitting secrets

## OWASP Top 10 Checklist

### A01: Broken Access Control

**Design Checklist**:
```yaml
access_control:
  - principle: "Deny by default"
    implementation: "All endpoints require explicit authorization"
    pattern: |
      // Middleware-first authorization
      router.use(authMiddleware);
      router.use(authzMiddleware);
      
  - principle: "Least privilege"
    implementation: "Users get minimum permissions needed"
    pattern: |
      // Role-based with minimal grants
      const permissions = {
        viewer: ['read'],
        editor: ['read', 'write'],
        admin: ['read', 'write', 'delete', 'admin']
      };
      
  - principle: "Ownership verification"
    implementation: "Verify user owns resource before access"
    pattern: |
      // Always check ownership
      async function getResource(userId, resourceId) {
        const resource = await db.find(resourceId);
        if (resource.ownerId !== userId) {
          throw new ForbiddenError();
        }
        return resource;
      }
```

### A02: Cryptographic Failures

**Design Checklist**:
```yaml
cryptography:
  - principle: "Encrypt sensitive data at rest"
    implementation: "Use AES-256 for data at rest"
    pattern: |
      // Encrypt before storing
      const encrypted = await encrypt(sensitiveData, key);
      await db.store({ data: encrypted, iv: iv });
      
  - principle: "TLS everywhere"
    implementation: "HTTPS only, no HTTP fallback"
    pattern: |
      // Force HTTPS in production
      if (process.env.NODE_ENV === 'production') {
        app.use(helmet.hsts());
        app.use(redirectToHttps());
      }
      
  - principle: "No hardcoded secrets"
    implementation: "Use environment variables or secret managers"
    pattern: |
      // Load from environment
      const config = {
        dbPassword: process.env.DB_PASSWORD,
        apiKey: process.env.API_KEY,
        jwtSecret: process.env.JWT_SECRET
      };
      
  - principle: "Secure password storage"
    implementation: "bcrypt with cost factor >= 12"
    pattern: |
      // Hash passwords properly
      const BCRYPT_ROUNDS = 12;
      const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
```

### A03: Injection

**Design Checklist**:
```yaml
injection_prevention:
  - principle: "Parameterized queries only"
    implementation: "Never concatenate user input into queries"
    pattern: |
      // GOOD: Parameterized
      const result = await db.query(
        'SELECT * FROM users WHERE id = $1',
        [userId]
      );
      
      // BAD: Concatenation (NEVER DO THIS)
      // const result = await db.query(
      //   `SELECT * FROM users WHERE id = ${userId}`
      // );
      
  - principle: "Input validation"
    implementation: "Validate and sanitize all input"
    pattern: |
      // Validate with schema
      const schema = Joi.object({
        email: Joi.string().email().required(),
        age: Joi.number().integer().min(0).max(150)
      });
      const validated = await schema.validateAsync(input);
      
  - principle: "Output encoding"
    implementation: "Encode output based on context"
    pattern: |
      // HTML context
      const safeHtml = escapeHtml(userInput);
      
      // URL context
      const safeUrl = encodeURIComponent(userInput);
      
      // JavaScript context
      const safeJs = JSON.stringify(userInput);
```

### A04: Insecure Design

**Design Checklist**:
```yaml
secure_design:
  - principle: "Threat modeling"
    implementation: "Identify threats during design"
    questions:
      - "What data is sensitive?"
      - "Who should access what?"
      - "What could an attacker try?"
      - "What's the blast radius of a breach?"
      
  - principle: "Defense in depth"
    implementation: "Multiple layers of security"
    layers:
      - "Network: Firewall, VPN"
      - "Application: Auth, authz, validation"
      - "Data: Encryption, access controls"
      - "Monitoring: Logging, alerting"
      
  - principle: "Fail securely"
    implementation: "Errors don't leak information"
    pattern: |
      // Don't reveal internal details
      catch (error) {
        logger.error('Internal error', { error, userId });
        return res.status(500).json({
          error: 'An error occurred',
          // NOT: error.message, error.stack
        });
      }
```

### A05: Security Misconfiguration

**Design Checklist**:
```yaml
configuration:
  - principle: "Secure defaults"
    implementation: "Default to most secure option"
    examples:
      - "CORS: Deny all origins by default"
      - "Headers: Enable security headers"
      - "Permissions: No access by default"
      
  - principle: "Remove unnecessary features"
    implementation: "Disable unused endpoints, methods, features"
    pattern: |
      // Only enable needed HTTP methods
      router.route('/users/:id')
        .get(getUser)
        .put(updateUser);
      // DELETE not enabled unless needed
      
  - principle: "Security headers"
    implementation: "Use helmet.js or equivalent"
    pattern: |
      app.use(helmet({
        contentSecurityPolicy: true,
        crossOriginEmbedderPolicy: true,
        crossOriginOpenerPolicy: true,
        crossOriginResourcePolicy: true,
        dnsPrefetchControl: true,
        frameguard: true,
        hidePoweredBy: true,
        hsts: true,
        ieNoOpen: true,
        noSniff: true,
        originAgentCluster: true,
        permittedCrossDomainPolicies: true,
        referrerPolicy: true,
        xssFilter: true
      }));
```

### A06: Vulnerable Components

**Design Checklist**:
```yaml
dependencies:
  - principle: "Minimal dependencies"
    implementation: "Only add necessary packages"
    
  - principle: "Regular updates"
    implementation: "Automated dependency updates"
    tools:
      - "Dependabot"
      - "Renovate"
      - "npm audit"
      
  - principle: "Vulnerability scanning"
    implementation: "CI/CD security scanning"
    pattern: |
      # In CI pipeline
      - name: Security audit
        run: npm audit --audit-level=high
```

### A07: Authentication Failures

**Design Checklist**:
```yaml
authentication:
  - principle: "Strong password policy"
    implementation: "Minimum requirements + breach check"
    pattern: |
      const passwordPolicy = {
        minLength: 12,
        requireUppercase: true,
        requireLowercase: true,
        requireNumber: true,
        requireSpecial: true,
        checkBreached: true // Check haveibeenpwned
      };
      
  - principle: "Rate limiting"
    implementation: "Limit auth attempts"
    pattern: |
      const loginLimiter = rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 5, // 5 attempts
        message: 'Too many login attempts'
      });
      app.post('/login', loginLimiter, loginHandler);
      
  - principle: "Multi-factor authentication"
    implementation: "MFA for sensitive operations"
    triggers:
      - "New device login"
      - "Password change"
      - "Financial transactions"
      - "Admin operations"
      
  - principle: "Secure session management"
    implementation: "HTTP-only, secure cookies"
    pattern: |
      app.use(session({
        cookie: {
          httpOnly: true,
          secure: true,
          sameSite: 'strict',
          maxAge: 3600000 // 1 hour
        },
        resave: false,
        saveUninitialized: false
      }));
```

### A08: Software and Data Integrity

**Design Checklist**:
```yaml
integrity:
  - principle: "Verify dependencies"
    implementation: "Lock files and integrity checks"
    pattern: |
      # package-lock.json with integrity hashes
      npm ci # Use ci, not install
      
  - principle: "Code signing"
    implementation: "Sign releases and verify signatures"
    
  - principle: "CI/CD security"
    implementation: "Secure pipeline configuration"
    checks:
      - "Protected branches"
      - "Required reviews"
      - "Signed commits"
```

### A09: Security Logging and Monitoring

**Design Checklist**:
```yaml
logging:
  - principle: "Log security events"
    implementation: "Audit trail for sensitive operations"
    events_to_log:
      - "Login success/failure"
      - "Password changes"
      - "Permission changes"
      - "Data access"
      - "Admin operations"
      
  - principle: "Don't log sensitive data"
    implementation: "Redact PII and secrets"
    pattern: |
      function sanitizeForLog(data) {
        return {
          ...data,
          password: '[REDACTED]',
          ssn: '[REDACTED]',
          creditCard: '[REDACTED]'
        };
      }
      
  - principle: "Alerting"
    implementation: "Alert on suspicious patterns"
    triggers:
      - "Multiple failed logins"
      - "Unusual access patterns"
      - "Privilege escalation attempts"
```

### A10: Server-Side Request Forgery (SSRF)

**Design Checklist**:
```yaml
ssrf_prevention:
  - principle: "URL validation"
    implementation: "Whitelist allowed destinations"
    pattern: |
      const allowedHosts = ['api.trusted.com', 'cdn.trusted.com'];
      
      function validateUrl(url) {
        const parsed = new URL(url);
        if (!allowedHosts.includes(parsed.host)) {
          throw new Error('URL not allowed');
        }
        return parsed;
      }
      
  - principle: "No internal access"
    implementation: "Block requests to internal IPs"
    blocked:
      - "127.0.0.0/8"
      - "10.0.0.0/8"
      - "172.16.0.0/12"
      - "192.168.0.0/16"
      - "169.254.0.0/16"
```

## Authentication Pattern Selection

### Pattern: OAuth 2.0 / OIDC

**When to Use**:
- Third-party identity provider integration
- "Sign in with Google/GitHub/etc"
- Delegated authorization

**Architecture**:
```yaml
oauth_architecture:
  components:
    - name: "OAuth Client"
      purpose: "Initiate auth flow, handle callbacks"
      
    - name: "Token Store"
      purpose: "Secure storage of access/refresh tokens"
      encryption: "AES-256"
      
    - name: "Token Refresh Service"
      purpose: "Automatic token refresh before expiry"
      
  flow:
    1. "User clicks 'Sign in with Provider'"
    2. "Redirect to provider with client_id, scope, state"
    3. "User authenticates with provider"
    4. "Provider redirects back with authorization code"
    5. "Exchange code for tokens (server-side)"
    6. "Store tokens securely"
    7. "Create local session"
```

### Pattern: JWT Authentication

**When to Use**:
- Stateless authentication
- Microservices architecture
- Mobile app backends

**Architecture**:
```yaml
jwt_architecture:
  token_structure:
    header: "Algorithm, type"
    payload: "Claims (sub, exp, iat, custom)"
    signature: "HMAC or RSA signature"
    
  best_practices:
    - algorithm: "RS256 (asymmetric) or HS256 (symmetric)"
    - expiry: "Short-lived (15-60 minutes)"
    - refresh: "Separate refresh token with longer life"
    - storage: "HTTP-only cookie (web) or secure storage (mobile)"
    - revocation: "Token blacklist or short expiry + refresh"
    
  pattern: |
    // Generate token
    const token = jwt.sign(
      { sub: userId, role: userRole },
      privateKey,
      { algorithm: 'RS256', expiresIn: '15m' }
    );
    
    // Verify token
    const decoded = jwt.verify(token, publicKey, {
      algorithms: ['RS256']
    });
```

### Pattern: Session-Based Authentication

**When to Use**:
- Traditional web applications
- When server state is acceptable
- Simpler security model needed

**Architecture**:
```yaml
session_architecture:
  storage: "Redis or database"
  
  best_practices:
    - "Regenerate session ID on login"
    - "Set appropriate expiry"
    - "Use secure, HTTP-only cookies"
    - "Implement session fixation protection"
    
  pattern: |
    // Session configuration
    app.use(session({
      store: new RedisStore({ client: redisClient }),
      secret: process.env.SESSION_SECRET,
      name: 'sessionId',
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: true,
        httpOnly: true,
        sameSite: 'strict',
        maxAge: 3600000
      }
    }));
```

## Authorization Model Selection

### Model: Role-Based Access Control (RBAC)

**When to Use**:
- Simple permission structure
- Users fit into clear roles
- Permissions don't vary by resource

**Architecture**:
```yaml
rbac_architecture:
  structure:
    roles:
      - admin: [create, read, update, delete, manage_users]
      - editor: [create, read, update]
      - viewer: [read]
      
  implementation: |
    function hasPermission(user, permission) {
      const rolePermissions = permissions[user.role];
      return rolePermissions.includes(permission);
    }
```

### Model: Attribute-Based Access Control (ABAC)

**When to Use**:
- Complex permission rules
- Permissions depend on resource attributes
- Context-aware access control

**Architecture**:
```yaml
abac_architecture:
  attributes:
    subject: [role, department, clearance]
    resource: [owner, classification, type]
    action: [read, write, delete]
    environment: [time, location, ip]
    
  policy_example: |
    // User can edit if:
    // - They are the owner, OR
    // - They are an editor AND resource is not confidential
    function canEdit(user, resource) {
      if (resource.ownerId === user.id) return true;
      if (user.role === 'editor' && !resource.confidential) return true;
      return false;
    }
```

## Data Protection Patterns

### Pattern: Encryption at Rest

```yaml
encryption_at_rest:
  database:
    method: "Transparent Data Encryption (TDE) or application-level"
    algorithm: "AES-256"
    key_management: "AWS KMS, HashiCorp Vault, or equivalent"
    
  files:
    method: "Encrypt before storage"
    pattern: |
      async function storeSecurely(data) {
        const key = await kms.getKey('data-encryption-key');
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        const encrypted = Buffer.concat([
          cipher.update(data),
          cipher.final()
        ]);
        const tag = cipher.getAuthTag();
        return { encrypted, iv, tag };
      }
```

### Pattern: Data Masking

```yaml
data_masking:
  purposes:
    - "Display in UI"
    - "Logging"
    - "Non-production environments"
    
  patterns:
    email: "j***@example.com"
    phone: "***-***-1234"
    ssn: "***-**-1234"
    credit_card: "****-****-****-1234"
    
  implementation: |
    function maskEmail(email) {
      const [local, domain] = email.split('@');
      return `${local[0]}***@${domain}`;
    }
    
    function maskCreditCard(cc) {
      return `****-****-****-${cc.slice(-4)}`;
    }
```

## Security Architecture Decision Template

When designing security for a feature, use this template:

```yaml
security_design:
  feature: "${feature_name}"
  
  threat_model:
    assets:
      - description: "What sensitive data is involved?"
        data_types: []
        sensitivity: "low|medium|high|critical"
        
    threats:
      - threat: "What could an attacker try?"
        likelihood: "low|medium|high"
        impact: "low|medium|high|critical"
        mitigations: []
        
  authentication:
    method: "oauth|jwt|session|api_key"
    mfa_required: true|false
    session_duration: ""
    
  authorization:
    model: "rbac|abac|acl"
    permissions: []
    ownership_checks: []
    
  data_protection:
    encryption_at_rest: true|false
    encryption_in_transit: true|false
    pii_fields: []
    masking_required: []
    
  input_validation:
    schemas: []
    sanitization: []
    
  logging:
    security_events: []
    pii_redaction: []
    
  compliance:
    requirements: []  # GDPR, HIPAA, PCI-DSS, etc.
```

## Integration with Architecture Concept

When the architecture concept designs a feature with security implications:

1. **Identify Security Requirements**
   - What data is sensitive?
   - Who needs access?
   - What regulations apply?

2. **Apply OWASP Checklist**
   - Review each of the Top 10
   - Document mitigations

3. **Select Patterns**
   - Choose authentication method
   - Choose authorization model
   - Design data protection

4. **Document in Architecture Output**
   ```yaml
   architecture:
     # ... other sections ...
     
     security_considerations:
       authentication: "OAuth 2.0 with Google provider"
       authorization: "RBAC with viewer/editor/admin roles"
       data_protection:
         - "PII encrypted at rest with AES-256"
         - "All traffic over TLS 1.3"
       owasp_mitigations:
         - "A01: Middleware-based authorization on all routes"
         - "A03: Parameterized queries, Joi validation"
         - "A07: Rate limiting on auth endpoints"
   ```

## Best Practices Summary

1. ✅ **Design security in, don't bolt it on**
2. ✅ **Apply principle of least privilege**
3. ✅ **Validate all input, encode all output**
4. ✅ **Use parameterized queries exclusively**
5. ✅ **Encrypt sensitive data at rest and in transit**
6. ✅ **Implement proper authentication and session management**
7. ✅ **Log security events, but never log sensitive data**
8. ✅ **Keep dependencies updated and audited**
9. ✅ **Fail securely - don't leak information in errors**
10. ✅ **Defense in depth - multiple layers of protection**

---

**Use this skill when**: Designing any feature that handles user data, authentication, authorization, or external input. Security should be considered at architecture time, not as an afterthought.
