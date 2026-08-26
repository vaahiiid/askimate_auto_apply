# ADR-0003 — Versioned migrations, not `drizzle-kit push --force`

**Status:** **Accepted** — approved by Vahid, 2026-08-26
**Date:** 2026-08-26
**Detail:** [Phase 0 · Deliverable 1 §3](../phase-0/01-existing-system-inventory.md)

## Context

Universitio's `scripts/post-merge.sh` runs `drizzle-kit push --force`, which diffs the schema
against the live database and applies changes directly. It is not versioned, ordered, or
reviewable. One migration file exists on disk (`drizzle/0000_tiny_toro.sql`) and the schema has
clearly moved well past it.

This is a reasonable trade-off for a small team and low-stakes data. It is not reasonable for a
database holding passport and bank-statement metadata, where `--force` can drop a column with no
review step and no rollback path.

## Decision

AAS uses **versioned, reviewed, forward-only migrations**, committed to the repository, applied
in order, and required to pass CI. `push --force` is never used against any environment.

## Consequences

- Schema history is auditable, which the brief's §4 audit requirements imply for the data layer
  as much as for cases.
- Slightly more ceremony per schema change. Accepted.
- Migrations are reviewable in a pull request before touching student data.
- Does not affect Universitio, which keeps its current workflow.
