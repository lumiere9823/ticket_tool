# Engineering Documentation Skill

## Purpose

Documentation is part of the engineering system.

Architecture, evidence, decisions, and implementation must remain synchronized.

---

## 1. Source Hierarchy

When sources conflict, use this hierarchy:

1. Verified runtime evidence
2. Accepted ADR
3. Technical design
4. Product requirements
5. Assumptions
6. TBD

Never silently resolve conflicts.

---

## 2. Repository Documentation

Current project documentation lives under:

docs/ticketbox/

Important documents include:

00-project-overview.md
01-product-requirements.md
02-technical-discovery.md
03-network-discovery.md
04-state-machine.md
05-reservation-boundary.md
06-multi-account-orchestration.md
07-extension-architecture.md
08-security-and-compliance.md
09-error-and-retry-matrix.md
10-implementation-roadmap.md
11-technical-design.md
12-ai-engineering-rules.md
13-test-strategy.md

---

## 3. ADR Rules

Create an ADR when changing:

- architecture
- critical path
- security boundary
- persistence strategy
- extension/controller boundary
- multi-profile architecture
- reservation semantics

Do not hide architectural decisions inside code.

---

## 4. Discovery Documentation

Every important observation should contain:

### Observation

What happened.

### Evidence

What proves it.

### Interpretation

What it means.

### Confidence

VERIFIED / DOCUMENTED / ASSUMPTION / TBD / BLOCKED

### Implementation Consequence

How it affects the code.

---

## 5. Roadmap

Use:

[ ] Not started
[-] In progress
[x] Complete
[?] Blocked / requires discovery

Never mark something complete when it is merely scaffolded.

---

## 6. Documentation Updates

When code changes architecture:

update documentation.

When evidence changes an assumption:

update documentation.

When an architectural decision changes:

create/update ADR.

---

## 7. Avoid Documentation Debt

Do not:

- duplicate contradictory rules
- invent API details
- document guesses as facts
- leave obsolete architecture without marking it
- silently rewrite project history

---

## 8. AI Agent Workflow

Before coding:

1. read relevant documentation;
2. identify constraints;
3. identify unknowns;
4. create a plan.

After coding:

1. test;
2. verify;
3. update documentation;
4. update roadmap.

---

## 9. Final Rule

Code explains HOW.

Documentation explains WHY.

Evidence explains WHETHER an assumption is true.