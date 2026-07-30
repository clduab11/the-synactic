# ADR-003: ruvnet Integration Policy

## Status

Proposed

## Context

ruvnet components are candidates for integration into the platform. A policy is needed to govern how and when these components are adopted. [constraint]

## Decision

Adopt a conservative integration policy for ruvnet components: no code vendored, no automatic installation, explicit user approval required for each component. [decision] Integration points defined through contracts package. [decision]

## Consequences

- Controlled, auditable integration process [pattern]
- No unexpected dependency sprawl [constraint]
- User maintains full control over component adoption [decision]
- Slower integration timeline [constraint]

## Follow-up

- Define ruvnet component evaluation criteria
- Create integration checklist template
- Establish compatibility testing requirements

> Evidence labels follow the convention in `docs/FOUNDATIONS.md`.
