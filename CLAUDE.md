# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## About Kibana

Kibana is a browser-based analytics and search dashboard for Elasticsearch (version 9.2.4). This is a large-scale monorepo containing:
- **Core platform**: `src/core/` - Fundamental systems (HTTP server, logging, saved objects, etc.)
- **Platform plugins**: `src/platform/plugins/` - Shared plugins (dashboard, discover, data, etc.)
- **X-Pack**: `x-pack/` - Commercial features under Elastic License 2.0 (security, alerting, observability, machine learning)
- **Examples**: `examples/` - Reference implementations for plugin development

## Development Commands

**Canonical package manager**: Yarn (specifically `yarn` v1.22.19+, Node.js 22.21.1)

```bash
# Start development server
yarn start
yarn kibana --dev

# Debug mode
yarn debug          # with --inspect
yarn debug-break    # with --inspect-brk

# Build
yarn build          # build all platforms
yarn build:apidocs  # build API docs

# Testing
yarn test:jest                  # run Jest unit tests
yarn test:jest_integration      # Jest integration tests with ES
yarn test:ftr                   # functional tests (UI)
yarn test:ftr:server            # start test servers
yarn test:ftr:runner            # run tests against running servers
yarn test:type_check            # TypeScript type checking

# Linting and formatting
yarn lint           # run all linters (ESLint + stylelint)
yarn lint:es        # ESLint only
yarn lint:style     # stylelint only
node scripts/eslint --fix    # auto-fix linting issues

# Elasticsearch for development
yarn es              # start ES with basic license
yarn es snapshot --license trial --password changeme  # trial license with security
```

## Running Specific Tests

```bash
# Run a single Jest test file
node scripts/jest path/to/test.test.ts

# Run tests for a specific plugin/package
node scripts/jest --config path/to/jest.config.js

# Functional tests with specific config
node scripts/functional_tests --config test/functional/config.base.js
node scripts/functional_tests --config test/api_integration/config
```

## Architecture Overview

### Plugin System (Kibana Platform)

Kibana uses a plugin-based architecture where each plugin is self-contained:

```
plugin/
├── kibana.jsonc          # Plugin manifest (id, owner, requiredPlugins)
├── public/               # Browser-side code
│   ├── index.ts          # Public API entry point
│   ├── plugin.ts         # Plugin class (register contracts, setup/lifecycle)
│   └── *.scss            # Component styles (imported at top of .tsx/.ts)
├── server/               # Node.js server-side code
│   ├── index.ts
│   └── plugin.ts
└── common/               # Shared types/code
```

**Key plugin concepts**:
- `kibana.jsonc`: Plugin manifest declaring metadata
- `plugin.ts`: Plugin class with `setup()` and `start()` lifecycle methods
- **Browser plugins**: Run in client, use Core contracts (navigation, uiActions, etc.)
- **Server plugins**: Run in Node.js, expose HTTP routes, background tasks
- **Required plugins**: Declare dependencies in `kibana.jsonc`

### Directory Structure

- `src/core/` - Core platform (HTTP server, logging, saved objects, plugins system)
- `src/cli/` - CLI entry points (`kibana`, `keystore`, plugin commands)
- `src/platform/plugins/private/` - OSS plugins not meant for external use
- `src/platform/plugins/shared/` - Public platform plugins
- `x-pack/` - Commercial features
  - `platform/plugins/` - X-Pack specific plugins
  - `solutions/` - Solution domains (observability, security)
  - `examples/` - Example plugins

### Core System Contracts

Plugins interact with Kibana through **contracts** exposed during setup/start:
- `CoreSetup`/`CoreStart`: Root core interfaces
- `HttpService`: Register routes, handle auth
- `LoggingService`: Structured logging
- `SavedObjectsService`: Persist and retrieve application state
- `UiActionsService`: Extend UI with actions
- `NavigationService`: Deep linking and app navigation

See [Core README](src/core/README.md) for full API documentation.

## Code Style

**File naming**: Use `snake_case` for all filenames (e.g., `my_component.tsx`)

**API endpoints**: Must use `/api/` prefix and `snake_case`
```
POST /api/kibana/index_patterns
{
  "time_field_name": "...",
  "fields": [...]
}
```

**Testing**: Place test files alongside source with `.test.ts`/`.test.tsx` suffix

**Style**: Use Prettier (run `node scripts/eslint --fix`)

**Import rules**: Import only top-level modules, not implementation details
```ts
// good
import { foo } from 'foo';
import child from './child';

// bad
import inFoo from 'foo/child';
```

## TypeScript Configuration

- Root `tsconfig.json` for project-wide settings
- Individual plugins may have `tsconfig.json` extending base configs
- Run `yarn test:type_check` to verify types across the repo

## X-Pack Licensing

- Files under `x-pack/` are primarily under **Elastic License 2.0**
- Some files use triple-license (ELv2 + SSPL + AGPL)
- Check file headers before modifying
- X-Pack includes security, alerting, observability, machine learning features

## Configuration Management (CRITICAL for Dev Mode)

### Kibana Config Files - Override Order

**IMPORTANT**: In dev mode (`yarn start`), Kibana loads config files in this order (later overrides earlier):

1. `config/kibana.yml` - Base configuration
2. `config/kibana.dev.yml` - **Dev overrides** (automatically loaded in dev mode)

### kibana.dev.yml - CRITICAL FILE

**What it is**: A git-tracked file that `src/platform/packages/private/kbn-apm-config-loader/src/utils/get_config_file_paths.ts` automatically loads in dev mode.

**Why it caused problems**: This file overrides `kibana.yml` settings. It was previously configured with wrong Elasticsearch credentials (`kibana_system` with old generated password).

**Current correct configuration**:
```yaml
elasticsearch.hosts: ["https://127.0.0.1:9200"]
elasticsearch.username: "kibana_system"  # MUST be kibana_system, NOT elastic (forbidden in 9.x)
elasticsearch.password: "Summer11"
elasticsearch.ssl.verificationMode: none
```

**RULES FOR ANY CHANGES**:
1. **ALWAYS check both `kibana.yml` AND `kibana.dev.yml` before making config changes**
2. **If a setting exists in both files, `kibana.dev.yml` wins in dev mode**
3. **ES credentials must stay in sync** - if you change the password, update BOTH files
4. **Never use `elastic` user** in Kibana 9.x - use `kibana_system` or service account tokens

### Authentication Setup

**Elasticsearch credentials** (NEVER change elastic password):
- ES superuser: `elastic / Summer11` (for CLI access, API calls)
- Kibana service: `kibana_system / Summer11` (for Kibana<->ES communication)

**Kibana authentication providers** (for user login):
- Aliyun OAuth (order: 0) - Primary SSO via Aliyun RAM
- Basic auth (order: 100) - Fallback with elastic/Summer11

## Additional Working Directory

This session includes `/home/denny/projects/es-9.2.4-plugins/modules/` as an additional working directory for Elasticsearch plugin development.
