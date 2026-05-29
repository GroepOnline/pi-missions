# Contributing to pi-missions

Thank you for your interest in contributing to pi-missions! This document provides guidelines and instructions for contributing.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/<your-username>/pi-missions.git`
3. Install dependencies: `npm ci`
4. Create a feature branch: `git checkout -b feat/your-feature`

## Development Workflow

### Before making changes
```bash
npm run check    # Ensure TypeScript compiles
npm test         # Ensure all tests pass
```

### While developing
```bash
npm test -- --watch  # Run tests in watch mode
npm run check        # Type check frequently
```

### Before committing
```bash
npm run check    # TypeScript strict mode
npm test         # All 834+ tests must pass
npm run build    # Verify build succeeds
```

## Code Style

- **TypeScript strict mode** — no `any` types unless absolutely necessary
- **ESM modules** — use `.js` extensions in imports
- **No console.log** in library code (CLI entry is the only exception)
- **TypeBox schemas** for runtime validation
- **Parameterized SQL queries** — never interpolate user input into SQL

## Testing

- Write tests for all new features and bug fixes
- Maintain or improve coverage thresholds (statements 85%, branches 82%, functions 88%)
- Use descriptive test names: `describe('FeatureName') > it('should do X when Y')`
- Mock the Pi ExtensionAPI in tests (see existing test patterns)

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add mission export to PDF
fix: resolve race condition in worker spawning
docs: update README with new commands
chore: update dependencies
test: add E2E tests for mission lifecycle
refactor: simplify completion detection logic
```

## Pull Request Process

1. Update documentation if needed
2. Add tests for new functionality
3. Ensure all CI checks pass
4. Request review from maintainers
5. Squash commits on merge

## Reporting Issues

- Use GitHub Issues for bug reports and feature requests
- Include reproduction steps for bugs
- Include Node.js version and OS information

## Security

See [SECURITY.md](SECURITY.md) for security vulnerability reporting.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
