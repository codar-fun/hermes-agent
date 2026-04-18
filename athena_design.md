# Athena — Cloud Hosting Service for Hermes Agent

Design discussion notes. Date: 2026-04-18.

---

## Overview

Athena is a proposed cloud hosting service that runs Hermes Agent instances for end users. The core challenge is adapting Hermes (designed as a single-tenant personal agent) into a multi-tenant hosted platform with proper isolation, resource efficiency, and cost control.

---

## Hermes Single-Tenant Assumption

Hermes's existing architecture is explicitly single-tenant:

> **SECURITY.md:** "Single Tenant: The system protects the operator from LLM actions, not from malicious co-tenants. Multi-user isolation must happen at the OS/host level."

The `_agent_cache` in `gateway/run.py` (LRU OrderedDict, max 128 slots, 1h idle TTL) is designed for **one operator across multiple platforms** (same person's Telegram + Discord + Slack), not for multi-tenant hosting. All `AIAgent` objects live in the same process as plain Python objects — no process isolation, no memory isolation between users.

For Athena, this means the gateway's built-in session multiplexing **cannot** be used as the multi-tenant boundary. OS-level isolation per user is required.

---

## Isolation Requirements

Each user must have:
- **Independent process** — crash/runaway agent doesn't affect other users
- **Independent filesystem** — `terminal` tool (direct shell execution) cannot cross user boundaries
- **Independent `HERMES_HOME`** — config, memory, state, credentials isolated per user

The `terminal` tool with `backend: local` executes shell commands directly on the host. `HERMES_HOME` only isolates Hermes config files, not the broader filesystem. Without OS-level isolation, a malicious or buggy agent in one user's session can access another user's files.

---

## Architecture

### Correct Multi-Tenant Design

```
┌─────────────────────────────────────────┐
│           Ingress / Auth Gateway        │  ← identity verification, routing
└────────────────┬────────────────────────┘
                 │ routes to user container
     ┌───────────┼───────────┐
     ▼           ▼           ▼
┌─────────┐ ┌─────────┐ ┌─────────┐
│ User A  │ │ User B  │ │ User C  │   ← each = isolated container/VM
│ Hermes  │ │ Hermes  │ │ Hermes  │
│ process │ │ process │ │ process │
└────┬────┘ └────┬────┘ └────┬────┘
     │           │           │
     └───────────┴───────────┘
           Shared Storage
     (per-user HERMES_HOME dirs)
```

### Lifecycle: On-Demand, Not Always-On

To control cost, containers should be **ephemeral** rather than permanently resident:

- User sends message → start/wake container (~1-2s cold start)
- Agent processes request
- No activity for N minutes → container paused or destroyed
- Persistent state survives in shared storage (`state.db`, `memory/`, `cron/jobs.json`)

---

## Platform Options Evaluated

### Option 1: Fly.io + gVisor ❌

**Rejected.** Fly.io Machines use Firecracker microVMs — each Machine gets its own Linux kernel. gVisor is a userspace kernel reimplementation that sits between the container and the host kernel; it requires a real Linux host kernel to intercept syscalls. On Fly.io, gVisor has cgroup conflicts and does not work correctly. Firecracker itself already provides strong VM-level isolation, making gVisor redundant and broken.

**Fly.io correct approach:** Use the Machines API to create ephemeral per-user Machines (Firecracker VMs). No gVisor needed — Firecracker isolation is sufficient.

### Option 2: GKE Autopilot + gVisor ✅

Google Kubernetes Engine Autopilot (1.27.4+) uses gVisor (GKE Sandbox) by default. Pods annotated with `sandbox.gke.io/runtime: gvisor` run under gVisor's `runsc` container runtime.

- gVisor intercepts all syscalls in userspace — kernel exploits from inside container don't reach the host
- Autopilot handles node scaling automatically
- Suitable for production multi-tenant workloads

```yaml
# Per-user pod annotation
metadata:
  annotations:
    sandbox.gke.io/runtime: gvisor
```

### Option 3: Modal (Serverless) ⚠️ Partial Fit

Hermes already supports Modal as a `terminal.backend`. Modal provides:
- Per-second billing, scale-to-zero
- `modal.Volume` for persistent storage
- Native `Cron()` scheduling (solves the cron-on-serverless problem)
- 1h function timeout

**Modal cron solution:** Use Modal's native `Cron("* * * * *")` as a global ticker that spawns per-user `run_user_cron_tick(user_id)` functions, each setting `HERMES_HOME` and calling Hermes's existing `tick()` — zero changes to Hermes cron code.

**Modal isolation concern:** Modal containers are gVisor-isolated (Modal uses gVisor internally), but the multi-tenant boundary between Modal users is managed by Modal's infrastructure, not by Athena. For self-managed isolation, GKE or Fly.io gives more control.

**The keep_warm misconception clarified:**
- `keep_warm=1` is for the entire gateway function, NOT per user
- However, because Hermes's single-process gateway is not multi-tenant safe, Modal cannot be used as a shared gateway the way a single-operator deployment would
- Per-user Modal functions with per-user `keep_warm` would be expensive at scale

### Option 4: Docker Swarm / Self-hosted Kubernetes ✅ (cost-effective at scale)

For self-hosted deployments:
- Docker Swarm: simpler ops, sufficient for small-medium scale
- Kubernetes: more complex but better scheduling, autoscaling, resource limits
- Use gVisor (`runsc`) as the container runtime for both

No managed service costs, but requires infra maintenance.

---

## Resource Model Comparison

| Architecture | Isolation | Cold Start | Cost Model | Complexity |
|---|---|---|---|---|
| Shared gateway process | ❌ None (same process) | None | Low | Low |
| Per-user ephemeral container (Fly/GKE) | ✅ VM/gVisor | ~1-3s | Pay per use | Medium |
| Per-user Modal function | ✅ gVisor | ~2-3s | Per-second | Medium |
| Per-user always-on container | ✅ VM/gVisor | None | Always paying | Low |

---

## Recommended Architecture for Athena MVP

1. **Auth layer:** Lightweight API gateway (Caddy / nginx / Cloudflare Workers) handling authentication and routing
2. **Compute:** GKE Autopilot with gVisor sandbox — ephemeral pods per active user session, scale-to-zero via KEDA or custom controller
3. **Storage:** GCS bucket or Filestore, mounted per-user pod as `HERMES_HOME` subdirectory
4. **Cron:** Kubernetes CronJob per user, or a single global ticker pod that fans out per-user `tick()` calls
5. **Cold start mitigation:** Pre-warmed pod pool of 2-5 instances; assign to new user sessions, recycle after session ends

---

## Key Design Constraints from Hermes Internals

| Constraint | Impact on Athena |
|---|---|
| Synchronous `run_conversation()` loop | One container per concurrent agent run; can't share a process across users |
| `terminal` tool = direct shell | Must have filesystem isolation (gVisor/VM), not just HERMES_HOME |
| Prompt cache discipline (frozen system prompt) | Don't reload config mid-session; container restart = new session |
| In-memory state lost on restart | Accept cold-start context loss or implement state serialization |
| `state.db` WAL mode, file-locked | Persistent volume must support file locking (NFS may cause issues; use local SSDs or GCS FUSE carefully) |
| Cron uses file lock + croniter in gateway thread | For serverless, replace with external scheduler (K8s CronJob or Modal Cron) |

---

## Open Questions

- How to handle Hermes memory/context across container restarts (serialize `messages` list to storage?)
- Per-user resource limits (CPU/RAM quotas in K8s) to prevent one user's heavy workload from starving others
- Billing and metering integration
- Approval system UX — how does `approvals.mode` work in a hosted context where the "operator" is the end user?
