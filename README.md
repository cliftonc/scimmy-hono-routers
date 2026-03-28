# scimmy-hono-routers

[SCIMMY](https://github.com/scimmyjs/scimmy) router middleware for [Hono](https://hono.dev/) — add [SCIM 2.0](https://datatracker.ietf.org/doc/html/rfc7644) server endpoints to any Hono application.

This is the Hono equivalent of [scimmy-routers](https://github.com/scimmyjs/scimmy-routers) (Express). It provides the same SCIM 2.0 endpoint coverage using Hono's native routing and async handling, in a single `scimmyHono()` factory function.

The routers leverage work done in the [SCIMMY](https://github.com/scimmyjs/scimmy) package, which handles all the hard parts of the SCIM 2.0 protocol: filter parsing, PATCH operations, schema validation, and response formatting.

> For details on how to use SCIMMY Resources, [visit the SCIMMY documentation](https://scimmyjs.github.io)!

## Requirements

- [Node.js](https://nodejs.org) v24+
- [Hono](https://hono.dev/) v4+
- [SCIMMY](https://github.com/scimmyjs/scimmy) v1.x

## Installation

```bash
npm install scimmy-hono-routers scimmy hono
```

## Quick Start

```ts
import { Hono } from "hono";
import { scimmyHono, SCIMMY } from "scimmy-hono-routers";

// 1. Declare your SCIM resources with handlers (see SCIMMY docs for full details)
SCIMMY.Resources.declare(SCIMMY.Resources.User)
  .ingress(async (resource, data, ctx) => {
    if (resource.id) {
      return await db.users.update(resource.id, data);
    }
    return await db.users.create(data);
  })
  .egress(async (resource, ctx) => {
    if (resource.id) {
      return await db.users.findById(resource.id);
    }
    return await db.users.list(resource.filter);
  })
  .degress(async (resource, ctx) => {
    await db.users.delete(resource.id);
  });

SCIMMY.Resources.declare(SCIMMY.Resources.Group, {
  /* Your handlers for group resource type */
});

// 2. Create the SCIM router
const scim = scimmyHono({
  type: "bearer",
  handler: async (c) => {
    const token = c.req.header("Authorization")?.replace("Bearer ", "");
    if (!token || !isValidToken(token)) throw new Error("Unauthorized");
    return getUserIdFromToken(token); // Return user ID string for /Me endpoint
  },
  context: async (c) => ({
    tenantId: c.get("tenantId"),
  }),
  baseUri: (c) => new URL(c.req.url).origin,
});

// 3. Mount at your SCIM base path
const app = new Hono();
app.route("/scim/v2", scim);

export default app;
```

## API

`scimmyHono()` returns a standard Hono app instance that can be mounted at any path using `app.route()`. It is recommended to mount at `/scim/v2` or `/scim` to follow SCIM conventions.

### Options

```ts
interface SCIMMYHonoOptions {
  type: string;
  handler: AuthenticationHandler;
  context?: AuthenticationContext;
  baseUri?: AuthenticationBaseUri;
  docUri?: string;
}
```

- **`type`** (required) — SCIM service provider authentication scheme type.
  Supported values: `"bearer"`, `"oauth"`, `"basic"`, `"digest"`, which map to SCIM authentication scheme types `oauthbearertoken`, `oauth2`, `httpbasic`, and `httpdigest` respectively.

- **`handler`** (required) — Function invoked to authenticate each SCIM request. Receives the Hono `Context` object.
  - Throw an `Error` to reject the request (returns 401 with the error message).
  - Return a user ID string to identify the authenticated user (used by the `/Me` endpoint).

- **`context`** (optional) — Function invoked to provide additional context to each request. The returned value is passed directly to SCIMMY's `ingress`/`egress`/`degress` handler methods. Useful for multi-tenancy, passing database connections, etc.

- **`baseUri`** (optional) — Function invoked to determine the base URI for `meta.location` properties in SCIM responses. Must return a valid URL string (e.g., `"https://example.com"`). If omitted, locations are derived from the request URL.

- **`docUri`** (optional) — URL string for the documentation URI of the authentication scheme, included in the `ServiceProviderConfig` response.

### Type Signatures

```ts
type AuthenticationHandler = (c: Context) => string | Promise<string>;
type AuthenticationContext = (c: Context) => unknown | Promise<unknown>;
type AuthenticationBaseUri = (c: Context) => string | Promise<string>;
```

## Endpoints

All standard SCIM 2.0 endpoints ([RFC 7644](https://datatracker.ietf.org/doc/html/rfc7644)) are supported:

| Endpoint | Methods | Description |
|---|---|---|
| `/ServiceProviderConfig` | GET | Server capabilities and configuration |
| `/Schemas` | GET | Schema definitions |
| `/Schemas/:id` | GET | Single schema by URN |
| `/ResourceTypes` | GET | Resource type definitions |
| `/ResourceTypes/:id` | GET | Single resource type |
| `/Users` | GET, POST | List/create users |
| `/Users/:id` | GET, PUT, PATCH, DELETE | Read/replace/update/delete a user |
| `/Groups` | GET, POST | List/create groups |
| `/Groups/:id` | GET, PUT, PATCH, DELETE | Read/replace/update/delete a group |
| `/Me` | GET | Currently authenticated user |
| `/.search` | POST | Cross-resource search ([RFC 7644 §3.4.3](https://datatracker.ietf.org/doc/html/rfc7644#section-3.4.3)) |
| `/Bulk` | POST | Bulk operations ([RFC 7644 §3.7](https://datatracker.ietf.org/doc/html/rfc7644#section-3.7)) |

Resource-scoped `/.search` endpoints (e.g., `/Users/.search`) are also supported.

All responses use `Content-Type: application/scim+json`.

## How It Works

This package is a thin adapter (~280 lines of TypeScript) that maps Hono routes to SCIMMY's resource operations:

| HTTP Method | SCIMMY Operation |
|---|---|
| `GET /Resource` | `new Resource(query).read(context)` |
| `GET /Resource/:id` | `new Resource(id, query).read(context)` |
| `POST /Resource` | `new Resource(query).write(body, context)` |
| `PUT /Resource/:id` | `new Resource(id, query).write(body, context)` |
| `PATCH /Resource/:id` | `new Resource(id, query).patch(body, context)` |
| `DELETE /Resource/:id` | `new Resource(id).dispose(context)` |

SCIMMY handles all the protocol complexity: filter parsing, PATCH operation application, schema validation, `ListResponse` pagination, error formatting, and more.

## Comparison with scimmy-routers (Express)

| | scimmy-routers | scimmy-hono-routers |
|---|---|---|
| Framework | Express 4+ | Hono 4+ |
| Language | JavaScript | TypeScript |
| Pattern | Class extending `Router` | Factory function returning `Hono` |
| Auth handler receives | `express.Request` | `hono.Context` |
| Test framework | Mocha + Sinon + Supertest | Vitest + Sinon |

The API surface and SCIM compliance are identical — both packages use the same SCIMMY core for all protocol logic.

## Development

### Prerequisites

```bash
nvm use   # Uses Node.js 24+ (see .nvmrc)
npm install
```

### Commands

```bash
npm run build        # Build with tsup (ESM + .d.ts)
npm run dev          # Build in watch mode
npm test             # Run tests (vitest)
npm run test:watch   # Run tests in watch mode
npm run typecheck    # TypeScript type check (tsc --noEmit)
```

### Project Structure

```
src/
  index.ts           # Single-file implementation (~280 lines)
test/
  index.test.ts      # Full test suite (48 tests) using sinon stubs
  helpers.ts          # Test utilities (request helpers, assertion helpers)
```

### Testing Approach

Tests mirror the [scimmy-routers test suite](https://github.com/scimmyjs/scimmy-routers/tree/main/test) — using sinon stubs on SCIMMY resource prototypes to test routes in isolation. This validates that the Hono adapter correctly maps HTTP requests to SCIMMY operations without requiring a real database backend.

## Related Projects

- [SCIMMY](https://github.com/scimmyjs/scimmy) — SCIM 2.0 protocol implementation for Node.js (the core library)
- [scimmy-routers](https://github.com/scimmyjs/scimmy-routers) — SCIMMY Express routers (the Express equivalent of this package)
- [Hono](https://hono.dev/) — Ultrafast web framework for the Edges

## License

MIT
