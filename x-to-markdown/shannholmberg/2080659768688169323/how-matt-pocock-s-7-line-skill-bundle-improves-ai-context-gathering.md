---
url: "https://x.com/shannholmberg/status/2080659768688169323"
author: "Shann³ (@shannholmberg)"
publishedAt: "2026-07-24T22:22:00"
views: 5569
likes: 86
reposts: 8
replies: 7
---

# How @mattpocockuk’s 7-line skill bundle improves AI context gathering

It’s a grill-first workflow for Claude Code (or any other harness). It interviews you before agents start working on your codebase so they have the most accurate context.

Every skill and what it does:

## Interview

- **`/grill-me`** — a seven-line skill that interviews you one question at a time until every decision is resolved.
- **`/grilling`** — the reusable loop behind `grill-me` and `grill-with-docs`.
- **`/grill-with-docs`** — the same interview flow, while building a `CONTEXT.md` glossary and ADRs as it goes.

## Domain and design

- **`/domain-modeling`** — sharpens the project’s shared vocabulary and glossary.
- **`/codebase-design`** — deep-module design: a simple interface that hides deep functionality.
- **`/improve-codebase-architecture`** — scans for architecture opportunities, writes an HTML report, then interviews you about the option you choose.

## Specification and planning

- **`/to-spec`** — collapses the conversation into a spec without another interview, then publishes it to the tracker.
- **`/to-tickets`** — breaks the spec into tracer-bullet tickets, each declaring its blockers.
- **`/wayfinder`** — splits work too large for one session into investigation tickets on the tracker.
- **`/triage`** — moves issues through a state machine of triage roles.

## Build

- **`/implement`** — builds from the spec or tickets, drives TDD, and closes with code review.
- **`/tdd`** — follows red-green cycles at agreed seams, one vertical slice at a time.
- **`/prototype`** — creates throwaway code to answer a design question.
- **`/research`** — sends a background agent to investigate primary sources and leave a cited file.

## Review and fixes

- **`/code-review`** — two parallel subagents report side by side: one against your standards, one against the spec.
- **`/diagnosing-bugs`** — reproduce, minimise, hypothesise, instrument, fix, and regression-test.
- **`/resolving-merge-conflicts`** — resolves conflicts hunk by hunk, by intent.

## Workflow

- **`/ask-matt`** — routes you to the appropriate skill or flow for the situation.
- **`/handoff`** — compacts a conversation into a document for the next agent or session.
- **`/teach`** — provides multi-session teaching, using the directory as a stateful workspace.
- **`/writing-great-skills`** — a reference for writing and editing skills.
- **`/setup-matt-pocock-skills`** — configures the repository; run once.

## Value to builders

Grilling comes first. `grill-me` and `grill-with-docs` ask one question at a time until you have signed off on every decision. Only then does `to-spec` write the spec, `to-tickets` split it up, `implement` build it, and `code-review` check it twice.

## Quoted post

> **Shann³ · Jul 12**
>
> The three planning frameworks I run every AI build through. Each one forces the same discipline: plan and align before the agent builds.
>
> 1. Superpowers (Jesse Vincent): a Claude Code skill framework that makes you plan before you build; it works on anything, code or otherwise.

## Media

![Workflow diagram 1](https://pbs.twimg.com/media/HN_9BiIbsAAjS6N?format=png&name=900x900)

![Workflow diagram 2](https://pbs.twimg.com/media/HN_9B9ba8AA9GJg?format=png&name=medium)
