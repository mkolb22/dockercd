# High Availability Architecture for dockercd on Docker Swarm

This document outlines a research-backed plan for deploying dockercd across multiple hosts using Docker Swarm for high availability. It covers Swarm fundamentals, state replication strategies, leader election, failover behavior, and a phased implementation approach.

---

## 1. Docker Swarm Fundamentals

Swarm has two node roles. **Manager nodes** maintain cluster state using the Raft consensus algorithm, schedule services, and serve the Swarm API. **Worker nodes** execute tasks assigned by managers. Managers also run workloads by default, but production deployments should drain them:

```bash
docker node update --availability drain <MANAGER-NODE>
```

### Raft Consensus and Quorum

Swarm managers use Raft to replicate state. Raft tolerates `(N-1)/2` failures and requires a quorum of `(N/2)+1` nodes.

| Managers | Quorum | Tolerated Failures |
|----------|--------|--------------------|
| 1        | 1      | 0                  |
| 3        | 2      | 1                  |
| 5        | 3      | 2                  |
| 7        | 4      | 3                  |

**Minimum viable HA**: 3 manager nodes across 3 availability zones (1-1-1). A 5-manager swarm is recommended if you regularly perform maintenance.

Key constraints:

- Manager nodes **must have static IP addresses** (if all managers restart with new IPs, the swarm is unrecoverable without backup)
- Always maintain an **odd number** of managers to avoid split-brain during network partitions
- **Never exceed 7 managers** — Raft consensus overhead increases with count
- When quorum is lost, existing tasks keep running but no new scheduling or state changes can occur

### Quorum Loss Recovery

When the manager set is unhealthy, the Swarm enters a degraded state. Recovery requires:

```bash
docker swarm init --force-new-cluster
```

This creates a new single-manager swarm from the surviving node's state, after which other managers can be re-added.

---

## 2. docker compose vs docker stack deploy

### The Critical Difference

`docker compose up` on a Swarm manager only deploys to the **local node**. It does not distribute services across the swarm. All containers are scheduled on the current node.

To deploy services across a Swarm, you must use `docker stack deploy`:

```bash
docker stack deploy -c docker-compose.yml myapp
```

### Key Differences

| Feature | `docker compose up` | `docker stack deploy` |
|---------|---------------------|-----------------------|
| Multi-node | No (local only) | Yes (full swarm) |
| Compose file format | Latest Compose spec | Legacy v3 only |
| Build directive | Supported | **Not supported** |
| Scaling | Single host only | Cluster-wide |
| Rolling updates | No | Yes (update_config) |
| Deploy section | Ignored | Used for placement, replicas, resources |
| Volumes | Full support | Bind mounts require pre-existing dirs on each node |

### Impact on dockercd

Two possible multi-host strategies:

**Option A (recommended): Keep docker compose, target multiple hosts individually.** The inspector already has a `ClientFactory` pattern that supports `client.WithHost(host)`. The deployer accepts `DockerHost` in `DeployRequest`. Each application targets a specific Docker host. dockercd runs on one node and issues `docker compose` commands with `DOCKER_HOST=tcp://node2:2376`.

**Option B: Add docker stack deploy as a new deployer backend.** This would allow true swarm-native service distribution but requires applications to use Compose v3 format and loses some features (builds, some volume types).

Option A is the pragmatic path — it preserves the existing architecture and works today with the existing `DockerHost` field in application specs.

---

## 3. Docker Socket Scope in Swarm

When a container mounts `/var/run/docker.sock` on a Swarm **manager** node:

- **Swarm API operations** (services, stacks, nodes) are **cluster-wide** — they go through the Raft-replicated Swarm manager
- **Container API operations** (`docker ps`, `docker inspect`) **only see the local node's containers**

### Implications for dockercd

**Inspector**: Uses `ContainerList` and `ContainerInspect`, which are container-level APIs. When connected to a single docker.sock, it only sees containers on that node. To inspect containers across the swarm, dockercd would need to either:

1. Use the Swarm service API (`docker service ls`, `docker service ps`) instead of container APIs
2. Connect to each node's Docker socket individually via `tcp://nodeN:2376`

**Event Watcher**: The `Events` API similarly only sees events from the local daemon. Cross-swarm event watching requires connections to each node.

**Deployer**: `docker compose up` only affects the local daemon. For remote nodes, set `DOCKER_HOST` to the target node's socket.

---

## 4. SQLite in HA — The Core Problem

dockercd uses SQLite with WAL mode and `busy_timeout=5000ms`. SQLite is single-writer by design. Running multiple dockercd instances against the same database is the central challenge.

### Option A: SQLite on NFS/GlusterFS — DO NOT DO THIS

SQLite on NFS **will corrupt your database**. SQLite's locking mechanism relies on POSIX advisory locks (`fcntl`), which NFS does not implement reliably. WAL mode makes this worse because it uses shared memory files (`-shm` and `-wal`) that are not safe on network filesystems.

**Verdict**: Eliminated. Not viable.

### Option B: PostgreSQL

Replace `SQLiteStore` with a PostgreSQL-backed implementation behind the existing `Store` interface.

| Pros | Cons |
|------|------|
| True multi-writer support | Adds an external dependency |
| Mature replication (streaming, logical) | No longer "single binary" deployment |
| Connection pooling handles many clients | Requires separate PostgreSQL HA (Patroni, etc.) |
| Already in infra stack (Gitea uses it) | Operational complexity increases |

### Option C: rqlite (Distributed SQLite)

rqlite combines SQLite with Raft consensus. Runs as a separate 3+ node cluster with an HTTP API.

- **CP system** (Consistency-Partition tolerant): during network partitions, only the majority side remains available
- **Write performance reduced** relative to standalone SQLite due to Raft round-trips
- **No `BEGIN`/`COMMIT`/`ROLLBACK`** — traditional transactions not supported
- **Single-binary deployment**, cluster setup takes seconds
- **Go client** (`gorqlite/stdlib`) provides `database/sql`-compatible driver

```go
import "github.com/rqlite/gorqlite/stdlib"
db, err := sql.Open("rqlite", "http://rqlite-node1:4001,http://rqlite-node2:4001")
```

dockercd's current queries are simple CRUD and would adapt well.

### Option D: LiteFS (Distributed Filesystem for SQLite)

LiteFS is a FUSE-based filesystem that transparently replicates SQLite across nodes. Zero application code changes.

- **Single-writer model**: only the primary node can write; replicas are read-only
- **Primary election via Consul** distributed leases with TTL
- **Asynchronous replication**: writes streamed to replicas via HTTP
- **Requires FUSE** and `--privileged` in Docker
- **Requires Consul** for leader election
- If primary dies, Consul TTL must expire before new primary elected (10-30 seconds)

### Option E: Leader Election (Only One Writer)

Keep SQLite as-is. Ensure only one dockercd instance is active at any time. The standby instances do not open the database.

### Comparison Matrix

| Option | Code Changes | Ops Complexity | Reliability | Best For |
|--------|-------------|----------------|-------------|----------|
| NFS/GlusterFS | None | Medium | **Will corrupt** | Never |
| PostgreSQL | High (new store impl) | High (PG cluster) | Excellent | Large deployments |
| rqlite | Medium (HTTP API) | Medium (3-node cluster) | Good | Medium deployments |
| LiteFS | None | High (FUSE + Consul) | Good | Zero code change requirement |
| Leader election | None | Low | Good | **Simplest HA path** |

---

## 5. Leader Election Options

### Option A: Swarm replicas=1 (Simplest)

Deploy dockercd as a Swarm service with one replica. Swarm automatically reschedules when a node goes down.

```yaml
services:
  dockercd:
    image: dockercd:latest
    deploy:
      replicas: 1
      placement:
        constraints:
          - node.role == manager
      restart_policy:
        condition: on-failure
        delay: 5s
        max_attempts: 3
        window: 120s
      update_config:
        parallelism: 1
        delay: 10s
        order: start-first
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - dockercd-data:/data
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:8080/api/v1/health"]
      interval: 5s
      timeout: 3s
      retries: 3
      start_period: 10s
```

Only one instance runs at any time. When the host dies, Swarm detects the failure and starts a new instance on another manager. The SQLite database is local to the node, so the new instance starts fresh and re-syncs from git.

**Split-brain risk**: Swarm does not guarantee exactly-one semantics. During failover there can be a brief window where two instances coexist. However, since each uses its own local SQLite and `docker compose up -d` is idempotent, the risk is minimal.

**Failover time**: With the health check config above, detection takes ~15-25 seconds. Container start adds 2-5 seconds. **Total: 20-35 seconds**.

### Option B: Docker API Leader Detection

Deploy dockercd as a `global` service on all manager nodes. Each instance checks if its node is the Swarm Raft leader. Only the leader runs the reconciler; others serve read-only API/UI.

```go
info, err := cli.Info(ctx)
if info.Swarm.ControlAvailable && info.Swarm.Cluster.ID != "" {
    nodeID := info.Swarm.NodeID
    node, _, err := cli.NodeInspectWithRaw(ctx, nodeID)
    isLeader := node.ManagerStatus != nil && node.ManagerStatus.Leader
}
```

Failover happens automatically when Swarm elects a new Raft leader (**sub-5 seconds**). All instances stay warm, serving read-only API/UI traffic.

### Option C: External Distributed Lock (etcd/Consul)

```go
session, _, err := consul.Session().Create(&api.SessionEntry{
    Name:     "dockercd-leader",
    TTL:      "15s",
    Behavior: "delete",
}, nil)

acquired, _, err := consul.KV().Acquire(&api.KVPair{
    Key:     "dockercd/leader",
    Value:   []byte(instanceID),
    Session: session,
}, nil)
```

Most robust leader election but adds Consul or etcd as a dependency. Only justified if already running in the infrastructure.

---

## 6. Swarm Replicas in Detail

### How replicas Works

When you set `deploy.replicas: N` in a stack file, the Swarm scheduler distributes N task instances across available nodes. Each task is a running container. The scheduler tries to spread tasks evenly, respecting placement constraints.

```yaml
deploy:
  replicas: 3
  placement:
    constraints:
      - node.role == manager
    preferences:
      - spread: node.id    # Spread across nodes evenly
```

### replicas=1 for HA

This is the simplest HA pattern. Swarm maintains exactly one running instance. If the node hosting it dies, Swarm detects the failure and reschedules the task on another node. The key settings that control this behavior:

- **`restart_policy`** — what happens when a container crashes on the *same* node (restarts locally)
- **Rescheduling** — what happens when a *node* goes down (moves to another node). This is automatic and not configurable beyond health checks.

### Detection Speed

Detection speed depends on two things:

1. **Health checks** — Swarm polls the container. With `interval: 5s` and `retries: 3`, detection takes ~15-20 seconds.
2. **Node heartbeat** — managers check worker/manager heartbeats every 5 seconds. If a node misses heartbeats for ~30 seconds, it's marked as down.

### replicas vs global Mode

With `replicas: 1`, exactly one instance runs somewhere in the cluster. With `mode: global`, one instance runs on *every* node matching constraints. For dockercd Phase 3, global mode on managers (3 instances, only the leader active) gives the fastest failover since the replacement is already running.

### The Catch with replicas=1

During failover or rolling updates, there's a brief window where zero or two instances may exist:

- **`update_config.order: start-first`** — starts the new container before killing the old one (brief overlap, two instances running)
- **`update_config.order: stop-first`** — kills the old container before starting the new one (brief gap, zero instances running)

For dockercd, `start-first` is preferred since idempotent reconciliation handles the overlap safely. Two instances both running `docker compose up -d` with the same compose file converge to the same desired state.

---

## 7. What Happens When an HA Container Goes Offline

### Detection and Rescheduling

| Config | Detection Time | Total Failover |
|--------|---------------|----------------|
| Default health checks (30s interval, 3 retries) | ~90 seconds | ~100 seconds |
| Aggressive (5s interval, 3 retries) | ~15-20 seconds | ~20-35 seconds |

### State Recovery Timeline

When a new dockercd instance starts on a different node:

1. **Container start + migrations**: ~2 seconds
2. **Application config reload** (from YAML files): ~1 second
3. **Git repo re-clone** (cold cache): 5-60 seconds per repo depending on size
4. **First reconciliation**: 2-10 seconds per app
5. **Total to fully operational**: ~30-120 seconds after Swarm schedules the container

In-memory state (reconciler schedule, circuit breakers, app locks) resets cleanly. The reconciler loads all apps from the store on startup and schedules immediate reconciliation for each.

### Split-Brain Prevention

1. **Swarm quorum**: If a network partition causes quorum loss on one side, that side cannot schedule new tasks
2. **Application-level fencing**: If using rqlite or PostgreSQL, only the database leader accepts writes
3. **Idempotency**: dockercd's reconciliation is inherently idempotent — `docker compose up -d` with the same compose file is a no-op if nothing changed
4. **Per-app mutexes**: Prevent concurrent reconciliation of the same app within one instance (but not across instances)

---

## 8. Swarm Cluster Management

### Adding and Removing Nodes

```bash
# Get join tokens
docker swarm join-token manager
docker swarm join-token worker

# Join from new node
docker swarm join --token <TOKEN> <MANAGER-IP>:2377

# Clean removal
docker node demote <NODE>    # If manager
docker node rm <NODE>

# Force removal of unresponsive node
docker node rm --force <NODE>
```

### Certificate Rotation and TLS

All Swarm inter-node communication uses mutual TLS (mTLS). Docker generates a root CA on `swarm init` and issues certificates to every node. Certificates auto-rotate every 3 months by default:

```bash
docker swarm update --cert-expiry 720h  # 30 days
```

Rotation is transparent — cross-signed certificates allow nodes to validate during transitions.

### Overlay Networking

Swarm overlay networks use VXLAN encapsulation to tunnel traffic between hosts:

```yaml
networks:
  dockercd-net:
    driver: overlay
    attachable: true  # Allows standalone containers to attach
```

Services on an overlay network communicate by service name via Swarm's embedded DNS server.

### Service Discovery

- **VIP mode** (default): Each service gets a virtual IP. DNS resolves to VIP, IPVS load-balances to containers.
- **DNSRR mode**: DNS returns all container IPs directly. Client chooses.

### Rolling Updates of dockercd

```yaml
services:
  dockercd:
    deploy:
      update_config:
        parallelism: 1
        delay: 10s
        order: start-first     # New container starts before old stops
        failure_action: rollback
        monitor: 30s
      rollback_config:
        parallelism: 1
        order: stop-first
```

With `order: start-first` and `replicas: 1`, there is a brief overlap during updates. Since reconciliation is idempotent, this is safe.

---

## 9. Alternative HA Approaches

### Approach A: Active-Passive with Shared Storage

Two dockercd instances, one active and one standby. Shared state via rqlite or PostgreSQL. Only the active runs the reconciler; passive serves read-only API/UI.

```
                    +-------------------+
                    |   Load Balancer   |
                    +--------+----------+
                             |
              +--------------+--------------+
              |                             |
    +---------v---------+     +-------------v-------+
    | dockercd (active) |     | dockercd (passive)  |
    | - Reconciler: ON  |     | - Reconciler: OFF   |
    | - API: read/write |     | - API: read-only    |
    | - Git sync: ON    |     | - Git sync: OFF     |
    +---------+---------+     +-------------+-------+
              |                             |
              +----------+---------+--------+
                         |
                 +-------v--------+
                 |    rqlite      |
                 | (3-node Raft)  |
                 +----------------+
```

**Failover**: 15-30 seconds. API remains available during transition.

### Approach B: Active-Active with Partitioned Workloads

Multiple dockercd instances, each responsible for a subset of applications. No shared state needed.

```
    +-------------------+     +-------------------+
    | dockercd-1        |     | dockercd-2        |
    | Apps: A, B, C     |     | Apps: D, E, F     |
    | SQLite: local     |     | SQLite: local     |
    | Docker: node1,2   |     | Docker: node3,4   |
    +-------------------+     +-------------------+
```

**Best for**: Large deployments (50+ applications) where a single reconciler becomes a bottleneck. No automatic failover unless a watcher reassigns partitions.

### Approach C: Sidecar Consensus Layer

dockercd runs unmodified. A sidecar handles leader election and database replication (e.g., LiteFS with Consul).

**Pros**: Zero changes to dockercd. **Cons**: Requires `--privileged` for FUSE, adds Consul dependency.

### Comparison

| Approach | Complexity | Failover Time | Code Changes | Best For |
|----------|-----------|---------------|--------------|----------|
| Swarm replicas=1 | **Low** | 20-35s | None | Starting point |
| Active-passive + rqlite | Medium | 15-30s | Medium | Production HA |
| Active-passive + Docker API leader | Medium | <5s | Small | Fast failover |
| Active-active partitioned | Medium | N/A | Medium | Large scale |
| Sidecar + LiteFS | High | 10-30s | None | Zero code change HA |

---

## 10. Recommended Phased Approach

### Phase 1: Swarm replicas=1 (No Code Changes)

Deploy dockercd as a Swarm service with `replicas: 1` on manager nodes. Configure aggressive health checks. Accept 20-35 second failover and state reconstruction from git + Docker.

**Deliverables**:
- Swarm stack YAML file for dockercd
- Health check tuning documentation
- Runbook for quorum loss recovery

### Phase 2: rqlite Store Backend (Medium Code Changes)

Add rqlite as an optional store backend behind the existing `Store` interface. Deploy a 3-node rqlite cluster alongside dockercd. The `gorqlite/stdlib` package provides `database/sql` compatibility, minimizing changes.

**Deliverables**:
- `RqliteStore` implementation of `Store` interface
- Configuration flag to select SQLite vs rqlite
- rqlite cluster compose/stack file
- Migration tooling from SQLite to rqlite

### Phase 3: Docker API Leader Detection (Small Code Change)

Implement leader detection using the Docker Swarm API. Deploy dockercd as a global service on 3 manager nodes. All instances serve API/UI. Only the Swarm leader's instance runs the reconciler.

**Deliverables**:
- Leader detection goroutine with configurable check interval
- Reconciler start/stop based on leader status
- Read-only API mode for non-leader instances
- Global service stack YAML
