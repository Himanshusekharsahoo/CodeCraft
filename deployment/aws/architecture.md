# CodeCraft — AWS Cloud Infrastructure Architecture

**Status:** Production Infrastructure Blueprint
**Date:** 2026-09-07
**System:** CodeCraft Collaborative AI-Based Code Editor

---

## 1. Executive Summary & Philosophy

The CodeCraft cloud deployment architecture is designed around the principle of **Maximum Simplicity and Zero Unnecessary Infrastructure**.

Rather than adding external databases (PostgreSQL, MongoDB), caching clusters (Redis), or message queues (Kafka, RabbitMQ) simply because AWS is available, CodeCraft strictly preserves its core architecture:
- **Cloud Firestore**: Primary persistent document and metadata store.
- **Firebase Auth**: User identity and authorization management.
- **Yjs CRDT Engine**: Real-time multi-client document state convergence.
- **Pure Node.js GitService**: Isolated workspace version control.
- **Docker Sandbox**: Secure, fail-closed runtime code isolation.
- **Google Gemini Provider**: Bounded AI coding agent.

---

## 2. Target Production Architecture Topology

```
                                INTERNET
                                   │
                                   ▼
                            Route 53 (DNS)
                                   │
                                   ▼
                   Application Load Balancer (ALB)
                   [ACM TLS Termination: HTTPS / WSS]
                    │                              │
          Port 443 (HTTP/HTTPS)          Port 443 (WSS /collab)
                    │                              │
                    ▼                              ▼
             Target Group 1                 Target Group 2
             [Port 3000]                    [Port 1234]
                    │                              │
  ┌─────────────────┼──────────────────────────────┼──────────────────┐
  │                 │    Amazon VPC (Private)      │                  │
  │                 ▼                              ▼                  │
  │        ┌──────────────────┐           ┌──────────────────┐        │
  │        │   Next.js App    │◄─────────►│  Collaboration   │        │
  │        │   Server (Node)  │   Flush   │   Server (Yjs)   │        │
  │        └────────┬─────────┘           └──────────────────┘        │
  │                 │                                                 │
  │        ┌────────┴─────────┬──────────────────────┐                │
  │        ▼                  ▼                      ▼                │
  │   Amazon EBS         Docker Engine         AWS Secrets Manager    │
  │   [Git Storage:     [SandboxExecutor:      [GEMINI_API_KEY]       │
  │   /data/git]        Isolated Containers]                          │
  └────────┼──────────────────┼───────────────────────────────────────┘
           │                  │
           ▼                  ▼
     Cloud Firestore    Google Gemini API
      (Firebase)       (generativelanguage)
```

---

## 3. AWS Service Selection & Justification

| AWS Service | Selected? | Operational Justification |
|---|---|---|
| **Amazon VPC** | **YES** | Creates an isolated virtual network with public and private subnets, security groups, and route tables. |
| **Application Load Balancer (ALB)** | **YES** | Terminates TLS (HTTPS/WSS) using AWS Certificate Manager (ACM), handles WebSocket upgrades, and routes traffic between Next.js (port 3000) and Collaboration Server (port 1234). |
| **Amazon EC2 / ECS (EC2 Launch Type)** | **YES** | **Crucial Architectural Choice:** CodeCraft's `SandboxExecutor` requires Docker Engine to spawn isolated per-execution containers (`docker run ...`), which requires access to the Docker daemon (`/var/run/docker.sock`). AWS Fargate does NOT permit nested Docker daemon container spawning, making EC2 or ECS with EC2 launch type mandatory. |
| **Amazon EBS (Elastic Block Store)** | **YES** | Provides durable POSIX filesystem storage for Git repositories (`data/git/workspaces/`). Ensures workspace code persists across process restarts, deployments, and EC2 reboots. |
| **AWS Secrets Manager** | **YES** | Stores sensitive production credentials (`GEMINI_API_KEY`, Firebase service credentials) and injects them securely at runtime without baking keys into images or code. |
| **Amazon CloudWatch** | **YES** | Ingests structured JSON logs (`logAgentEvent`, `logExecutionEvent`), application metrics, and provides latency/error alarms. |
| **Amazon Route 53** | **YES** | Manages apex and subdomain DNS records with low-latency routing and ACM health checks. |
| **AWS ECR (Elastic Container Registry)** | **YES** | Secure private container registry hosting versioned application images. |
| **Amazon RDS / Aurora** | **NO** | **REJECTED**: CodeCraft uses Cloud Firestore. Introducing relational databases would violate architectural invariants. |
| **Amazon ElastiCache (Redis)** | **NO** | **REJECTED**: In-memory Yjs CRDT rooms and debounce engines handle ephemeral state; adding Redis adds maintenance overhead without architectural need. |
| **Amazon MSK (Kafka) / SQS** | **NO** | **REJECTED**: Not needed for CodeCraft's direct event processing. |

---

## 4. Storage & Persistence Strategy

### 4.1 Git Workspaces Storage (`/app/data/git/workspaces`)
- **Durable Media**: Amazon EBS gp3 volume mounted to `/app/data/git`.
- **Durability**: 99.999% volume durability with point-in-time automated EBS snapshots.
- **Isolation**: Each workspace repository is isolated in `data/git/workspaces/{workspaceId}` under strict path traversal guards.

### 4.2 Temporary Execution Workspace (`/app/data/executions`)
- **Durable Media**: Ephemeral local instance storage or scratch volume.
- **Lifecycle**: Directory created per run (`data/executions/{executionId}`), source written, mounted to Docker container, and strictly deleted upon execution termination (`fs.rmSync(tempDir, { recursive: true, force: true })`).

---

## 5. Security & Network Boundary

1. **Least-Privilege Ports**:
   - Only ports `80` (HTTP redirect) and `443` (HTTPS/WSS) are exposed to the public Internet via ALB.
   - Application instances accept traffic only from the ALB security group on ports `3000` and `1234`.
   - SSH (port 22) is disabled or restricted to AWS Systems Manager (SSM Session Manager), eliminating open bastion ports.
2. **IAM Least-Privilege Role**:
   - Instance role grants read-only access to specific Secrets Manager secret ARNs and write-only access to CloudWatch log groups.
   - No `AdministratorAccess` or broad wildcard policies.

---

## 6. Firebase Realtime Database & Firestore Security Configuration

CodeCraft utilizes Firebase for Authentication, Firestore for persistent document/workspace metadata, and Firebase Realtime Database (RTDB) for ephemeral collaborator cursor presence:
- **Firestore Security Rules (`firestore.rules`)**: Enforce role-based access control (RBAC) across workspaces, files, members, invites, and message collections. Contributor privilege escalation is blocked (CC-002), and AI chat messages cannot be forged by clients (CC-009).
- **Realtime Database Security Rules (`database.rules.json`)**: Configured via `firebase.json` with fail-closed defaults (`.read: false`, `.write: false` at root). Cursors are stored under `/workspaces/$workspaceId/cursors/$userId`, where read requires authenticated access (`auth != null`) and write strictly requires `auth != null && auth.uid === $userId`. In addition, cursor payload attributes (`x`, `y`, `displayName`, `color`, `timestamp`) are strictly validated against numeric boundaries, max string lengths, and timestamp limits (CC-016).
- **Presence Disconnect Handling**: Client components register `onDisconnect(cursorRef).remove()` handlers so network drops or tab closures trigger immediate server-side cursor cleanup (CC-028).
