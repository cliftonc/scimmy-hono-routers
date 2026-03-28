import type { Hono } from "hono";

/** Assert Content-Type is application/scim+json */
export async function expectContentType(res: Response) {
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/scim+json")) {
    throw new Error(`Expected Content-Type application/scim+json, got ${ct}`);
  }
}

export async function expectStatus(res: Response, status: number) {
  if (res.status !== status) {
    const body = await res.clone().text();
    throw new Error(`Expected status ${status}, got ${res.status}: ${body}`);
  }
}

export async function expectScimError(
  res: Response,
  status: number,
  detail?: string
) {
  await expectContentType(res);
  await expectStatus(res, status);
  const body = await res.json();
  if (body.schemas?.[0] !== "urn:ietf:params:scim:api:messages:2.0:Error") {
    throw new Error(`Expected SCIM error response, got: ${JSON.stringify(body)}`);
  }
  if (body.status !== String(status)) {
    throw new Error(`Expected error status "${status}", got "${body.status}"`);
  }
  if (detail && body.detail !== detail) {
    throw new Error(`Expected detail "${detail}", got "${body.detail}"`);
  }
}

export async function expectListResponse(
  res: Response,
  expectedResources: unknown[] = []
) {
  await expectContentType(res);
  await expectStatus(res, 200);
  const body = await res.json();
  if (body.schemas?.[0] !== "urn:ietf:params:scim:api:messages:2.0:ListResponse") {
    throw new Error(`Expected ListResponse, got: ${JSON.stringify(body)}`);
  }
  if (body.totalResults !== expectedResources.length) {
    throw new Error(
      `Expected totalResults ${expectedResources.length}, got ${body.totalResults}`
    );
  }
}

/** Make a request to a Hono app */
export function req(app: Hono) {
  return {
    get: (path: string, query?: Record<string, string>) => {
      const url = new URL(path, "http://localhost");
      if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
      return app.request(url.pathname + url.search);
    },
    post: (path: string, body?: unknown) =>
      app.request(path, {
        method: "POST",
        headers: { "Content-Type": "application/scim+json" },
        body: body ? JSON.stringify(body) : undefined,
      }),
    put: (path: string, body?: unknown) =>
      app.request(path, {
        method: "PUT",
        headers: { "Content-Type": "application/scim+json" },
        body: body ? JSON.stringify(body) : undefined,
      }),
    patch: (path: string, body?: unknown) =>
      app.request(path, {
        method: "PATCH",
        headers: { "Content-Type": "application/scim+json" },
        body: body ? JSON.stringify(body) : undefined,
      }),
    delete: (path: string) => app.request(path, { method: "DELETE" }),
  };
}
