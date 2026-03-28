import { Hono } from "hono";
import type { Context } from "hono";
import SCIMMY from "scimmy";

// Re-export SCIMMY for consumption by dependent packages
export { SCIMMY };

/**
 * Predefined SCIM Service Provider Config authentication scheme types
 */
const authSchemeTypes: Record<
  string,
  { type: string; name: string; description: string; specUri: string }
> = {
  oauth: {
    type: "oauth2",
    name: "OAuth 2.0 Authorization Framework",
    description:
      "Authentication scheme using the OAuth 2.0 Authorization Framework Standard",
    specUri: "https://datatracker.ietf.org/doc/html/rfc6749",
  },
  bearer: {
    type: "oauthbearertoken",
    name: "OAuth Bearer Token",
    description:
      "Authentication scheme using the OAuth Bearer Token Standard",
    specUri: "https://datatracker.ietf.org/doc/html/rfc6750",
  },
  basic: {
    type: "httpbasic",
    name: "HTTP Basic",
    description: "Authentication scheme using the HTTP Basic Standard",
    specUri: "https://datatracker.ietf.org/doc/html/rfc2617",
  },
  digest: {
    type: "httpdigest",
    name: "HTTP Digest",
    description: "Authentication scheme using the HTTP Digest Standard",
    specUri: "https://datatracker.ietf.org/doc/html/rfc2617",
  },
};

/**
 * Method invoked to authenticate a SCIM request.
 * Should throw an error if the request is not authenticated.
 * @returns The ID of the currently authenticated user (consumed by /Me endpoint)
 */
export type AuthenticationHandler = (c: Context) => string | Promise<string>;

/**
 * Method invoked to provide authentication context to a SCIM request.
 * @returns Any information to pass through to a Resource's handler methods
 */
export type AuthenticationContext = (c: Context) => unknown | Promise<unknown>;

/**
 * Method invoked to determine a base URI for location properties in a SCIM response.
 * @returns The base URI to use for location properties in SCIM responses
 */
export type AuthenticationBaseUri = (c: Context) => string | Promise<string>;

export interface SCIMMYHonoOptions {
  /** SCIM authentication scheme type: "oauth", "bearer", "basic", or "digest" */
  type: string;
  /** Method to invoke to authenticate SCIM requests */
  handler: AuthenticationHandler;
  /** Method to invoke to evaluate context passed to SCIMMY handlers */
  context?: AuthenticationContext;
  /** Method to invoke to determine the base URI for location properties */
  baseUri?: AuthenticationBaseUri;
  /** URL to use as documentation URI for the authentication scheme */
  docUri?: string;
}

/**
 * Helper to send a SCIM JSON response
 */
function scimJson(c: Context, body: unknown, status: number = 200): Response {
  return c.json(body as object, status as any, {
    "Content-Type": "application/scim+json",
  });
}

/**
 * Helper to send a SCIM error response
 */
function scimError(
  c: Context,
  ex: any
): Response {
  const status = ex.status ?? 500;
  return scimJson(c, new SCIMMY.Messages.Error(ex), status);
}

/**
 * Cast pagination query parameters from strings to numbers
 */
function castPaginationParams(query: Record<string, string>): Record<string, any> {
  const result: Record<string, any> = { ...query };
  for (const param of ["startIndex", "count"]) {
    if (result[param] && typeof result[param] === "string" && !Number.isNaN(+result[param])) {
      result[param] = +result[param];
    }
  }
  return result;
}

/**
 * Create a Hono app with SCIM 2.0 endpoints powered by SCIMMY.
 *
 * @example
 * ```ts
 * import { Hono } from "hono";
 * import { scimmyHono, SCIMMY } from "scimmy-hono-routers";
 *
 * // Declare resources and handlers
 * SCIMMY.Resources.declare(SCIMMY.Resources.User)
 *   .ingress((resource, data, ctx) => { ... })
 *   .egress((resource, ctx) => { ... })
 *   .degress((resource, ctx) => { ... });
 *
 * const scim = scimmyHono({
 *   type: "bearer",
 *   handler: async (c) => {
 *     const token = c.req.header("Authorization")?.replace("Bearer ", "");
 *     if (!token) throw new Error("Unauthorized");
 *     return userId;
 *   },
 *   context: async (c) => ({ tenantId: c.get("tenantId") }),
 *   baseUri: (c) => `${new URL(c.req.url).origin}`,
 * });
 *
 * const app = new Hono();
 * app.route("/scim/v2", scim);
 * ```
 */
export function scimmyHono(options: SCIMMYHonoOptions): Hono {
  const {
    type,
    handler,
    context = () => {},
    baseUri = () => "",
    docUri,
  } = options;

  // Validate options
  if (!type) {
    throw new TypeError(
      "Missing required parameter 'type' from authentication scheme in scimmyHono"
    );
  }
  if (!handler) {
    throw new TypeError(
      "Missing required parameter 'handler' from authentication scheme in scimmyHono"
    );
  }
  if (typeof handler !== "function") {
    throw new TypeError(
      "Parameter 'handler' must be of type 'function' in scimmyHono"
    );
  }
  if (!authSchemeTypes[type]) {
    throw new TypeError(
      `Unknown authentication scheme type '${type}' in scimmyHono`
    );
  }
  if (typeof context !== "function") {
    throw new TypeError(
      "Parameter 'context' must be of type 'function' in scimmyHono"
    );
  }
  if (typeof baseUri !== "function") {
    throw new TypeError(
      "Parameter 'baseUri' must be of type 'function' in scimmyHono"
    );
  }

  // Register the authentication scheme and SCIM config
  SCIMMY.Config.set({
    patch: true,
    filter: true,
    sort: true,
    bulk: true,
    authenticationSchemes: [
      { ...authSchemeTypes[type], documentationUri: docUri },
    ],
  });

  const app = new Hono();

  // Middleware: set basepath for all resource types
  app.use("*", async (c, next) => {
    try {
      const basepath = (await baseUri(c)) ?? "";

      if (
        !basepath ||
        (typeof basepath === "string" && basepath.match(/^https?:\/\//))
      ) {
        // Construct location from basepath + mount path
        const url = new URL(c.req.url);
        const routePath = url.pathname.replace(/\/(Schemas|ResourceTypes|ServiceProviderConfig|Users|Groups|Bulk|Me|\.search).*$/, "");
        const location = basepath
          ? basepath.replace(/\/$/, "") + routePath
          : `${url.origin}${routePath}`;

        SCIMMY.Resources.Schema.basepath(location);
        SCIMMY.Resources.ResourceType.basepath(location);
        SCIMMY.Resources.ServiceProviderConfig.basepath(location);
        for (const Resource of Object.values(SCIMMY.Resources.declared()) as any[]) {
          Resource.basepath(location);
        }

        await next();
      } else {
        throw new TypeError(
          "Method 'baseUri' must return a URL string in scimmyHono"
        );
      }
    } catch (ex) {
      return scimError(c, ex);
    }
  });

  // Middleware: authenticate requests
  app.use("*", async (c, next) => {
    try {
      await handler(c);
      await next();
    } catch (ex: any) {
      return scimJson(
        c,
        new SCIMMY.Messages.Error({ status: 401, message: ex.message }),
        401
      );
    }
  });

  // --- Discovery endpoints ---

  // Schemas
  app.get("/Schemas", async (c) => {
    try {
      const query = castPaginationParams(c.req.query());
      return scimJson(c, await new (SCIMMY.Resources.Schema as any)(query).read());
    } catch (ex) {
      return scimError(c, ex);
    }
  });

  app.get("/Schemas/:id", async (c) => {
    try {
      const query = castPaginationParams(c.req.query());
      return scimJson(
        c,
        await new (SCIMMY.Resources.Schema as any)(c.req.param("id"), query).read()
      );
    } catch (ex) {
      return scimError(c, ex);
    }
  });

  // ResourceTypes
  app.get("/ResourceTypes", async (c) => {
    try {
      const query = castPaginationParams(c.req.query());
      return scimJson(
        c,
        await new (SCIMMY.Resources.ResourceType as any)(query).read()
      );
    } catch (ex) {
      return scimError(c, ex);
    }
  });

  app.get("/ResourceTypes/:id", async (c) => {
    try {
      const query = castPaginationParams(c.req.query());
      return scimJson(
        c,
        await new (SCIMMY.Resources.ResourceType as any)(c.req.param("id"), query).read()
      );
    } catch (ex) {
      return scimError(c, ex);
    }
  });

  // ServiceProviderConfig
  app.get("/ServiceProviderConfig", async (c) => {
    try {
      const query = castPaginationParams(c.req.query());
      return scimJson(
        c,
        await new (SCIMMY.Resources.ServiceProviderConfig as any)(query).read()
      );
    } catch (ex) {
      return scimError(c, ex);
    }
  });

  // --- Search endpoint (global) ---
  app.post("/.search", async (c) => {
    try {
      const body = await c.req.json();
      const ctx = await context(c);
      return scimJson(
        c,
        await new SCIMMY.Messages.SearchRequest(body).apply(undefined, ctx)
      );
    } catch (ex) {
      return scimError(c, ex);
    }
  });

  // --- Bulk endpoint ---
  app.post("/Bulk", async (c) => {
    try {
      const { supported, maxPayloadSize, maxOperations } =
        SCIMMY.Config.get()?.bulk ?? {};

      if (!supported) {
        return scimJson(
          c,
          new SCIMMY.Messages.Error({
            status: 501,
            message: "Endpoint Not Implemented",
          }),
          501
        );
      }

      const contentLength = Number(c.req.header("content-length") ?? 0);
      if (contentLength > maxPayloadSize) {
        return scimJson(
          c,
          new SCIMMY.Messages.Error({
            status: 413,
            message: `The size of the bulk operation exceeds maxPayloadSize limit (${maxPayloadSize})`,
          }),
          413
        );
      }

      const body = await c.req.json();
      const ctx = await context(c);
      return scimJson(
        c,
        await new SCIMMY.Messages.BulkRequest(body, maxOperations).apply(
          undefined,
          ctx
        )
      );
    } catch (ex) {
      return scimError(c, ex);
    }
  });

  // --- Me endpoint ---
  app.get("/Me", async (c) => {
    try {
      const id = await handler(c);
      const isDeclared = SCIMMY.Resources.declared(SCIMMY.Resources.User);
      const user: any =
        isDeclared && typeof id === "string"
          ? await new SCIMMY.Resources.User(id).read(await context(c))
          : false;

      if (user && user?.meta?.location) {
        return scimJson(c, user);
      }
      return scimJson(
        c,
        new SCIMMY.Messages.Error({
          status: 501,
          message: "Endpoint Not Implemented",
        }),
        501
      );
    } catch (ex) {
      return scimError(c, ex);
    }
  });

  // --- Resource endpoints (Users, Groups, and any declared resource types) ---
  for (const Resource of Object.values(SCIMMY.Resources.declared()) as any[]) {
    const endpoint = Resource.endpoint; // e.g. "/Users", "/Groups"

    // Resource-scoped /.search
    app.post(`${endpoint}/.search`, async (c) => {
      try {
        const body = await c.req.json();
        const ctx = await context(c);
        return scimJson(
          c,
          await new SCIMMY.Messages.SearchRequest(body).apply([Resource], ctx)
        );
      } catch (ex) {
        return scimError(c, ex);
      }
    });

    // List resources
    app.get(endpoint, async (c) => {
      try {
        const query = castPaginationParams(c.req.query());
        const ctx = await context(c);
        return scimJson(c, await new Resource(query).read(ctx));
      } catch (ex) {
        return scimError(c, ex);
      }
    });

    // Get single resource
    app.get(`${endpoint}/:id`, async (c) => {
      try {
        const query = castPaginationParams(c.req.query());
        const ctx = await context(c);
        return scimJson(
          c,
          await new Resource(c.req.param("id"), query).read(ctx)
        );
      } catch (ex) {
        return scimError(c, ex);
      }
    });

    // Create resource
    app.post(endpoint, async (c) => {
      try {
        const query = castPaginationParams(c.req.query());
        const body = await c.req.json();
        const ctx = await context(c);
        return scimJson(c, await new Resource(query).write(body, ctx), 201);
      } catch (ex) {
        return scimError(c, ex);
      }
    });

    // Replace resource
    app.put(`${endpoint}/:id`, async (c) => {
      try {
        const query = castPaginationParams(c.req.query());
        const body = await c.req.json();
        const ctx = await context(c);
        return scimJson(
          c,
          await new Resource(c.req.param("id"), query).write(body, ctx)
        );
      } catch (ex) {
        return scimError(c, ex);
      }
    });

    // Patch resource
    app.patch(`${endpoint}/:id`, async (c) => {
      try {
        const query = castPaginationParams(c.req.query());
        const body = await c.req.json();
        const ctx = await context(c);
        const value = await new Resource(c.req.param("id"), query).patch(
          body,
          ctx
        );
        return value ? scimJson(c, value) : c.body(null, 204);
      } catch (ex) {
        return scimError(c, ex);
      }
    });

    // Delete resource
    app.delete(`${endpoint}/:id`, async (c) => {
      try {
        const ctx = await context(c);
        await new Resource(c.req.param("id")).dispose(ctx);
        return c.body(null, 204);
      } catch (ex) {
        return scimError(c, ex);
      }
    });
  }

  // 404 for unmatched routes
  app.all("*", (c) => {
    return scimJson(
      c,
      new SCIMMY.Messages.Error({ status: 404, message: "Endpoint Not Found" }),
      404
    );
  });

  return app;
}

export default scimmyHono;
