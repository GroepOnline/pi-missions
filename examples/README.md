# Example Missions

This directory contains example mission definitions for pi-missions. These examples demonstrate how to structure missions with milestones, features, and acceptance criteria.

## Usage

### Using templates (recommended)

```bash
# In a Pi session:
/mission new "Refactor auth module" --template refactor
/mission new "Fix login bug" --template fix-bug
/mission new "Add API endpoint" --template add-feature
```

### Using the planning wizard

```bash
/mission new "Your mission title"
# The wizard will guide you through creating milestones and features
```

### Loading from a mission file

```bash
/mission load <mission-id>
```

## Example Files

- `refactor-example.json` — Refactoring a legacy authentication module
- `feature-example.json` — Adding a new API endpoint with tests
- `bugfix-example.json` — Investigating and fixing a production bug
- `security-audit-example.json` — Security audit of an API
- `performance-example.json` — Performance optimization of database queries

## Mission Structure

A mission consists of:

```
Mission
├── Milestone 1
│   ├── Feature 1.1 (with acceptance criteria)
│   ├── Feature 1.2
│   └── Feature 1.3
├── Milestone 2
│   ├── Feature 2.1
│   └── Feature 2.2
└── Milestone 3
    └── Feature 3.1
```

Each feature has:
- **Title** and **description**
- **Priority** (1 = highest)
- **Dependencies** (other feature IDs)
- **Acceptance criteria** (verifiable conditions)
