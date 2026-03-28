import { describe, it, expect, afterEach, beforeAll } from "vitest";
import sinon from "sinon";
import { Hono } from "hono";
import SCIMMY from "scimmy";
import { scimmyHono } from "../src/index.js";
import {
  expectContentType,
  expectStatus,
  expectScimError,
  expectListResponse,
  req,
} from "./helpers.js";

const ValidAuthScheme = {
  type: "bearer" as const,
  handler: () => "test",
  context: () => ({}),
  baseUri: () => "http://localhost:3000",
};

let app: Hono;

describe("scimmyHono", () => {
  // Declare resources before creating the router (mirrors Express test setup)
  SCIMMY.Resources.declare(SCIMMY.Resources.Group, {}).declare(
    SCIMMY.Resources.User.extend(SCIMMY.Schemas.EnterpriseUser)
  );

  beforeAll(() => {
    const scim = scimmyHono(ValidAuthScheme);
    app = new Hono();
    app.route("/", scim);
  });

  // =============================================
  // Constructor validation
  // =============================================
  describe("@constructor", () => {
    const sandbox = sinon.createSandbox();

    afterEach(() => sandbox.restore());

    it("should require an authentication type", () => {
      expect(() => scimmyHono({} as any)).toThrow(
        "Missing required parameter 'type'"
      );
    });

    it("should require an authentication handler method", () => {
      expect(() => scimmyHono({ type: "bearer" } as any)).toThrow(
        "Missing required parameter 'handler'"
      );
      expect(() =>
        scimmyHono({ type: "bearer", handler: "not-a-function" } as any)
      ).toThrow("Parameter 'handler' must be of type 'function'");
    });

    it("should require a well-known authentication scheme type", () => {
      expect(() =>
        scimmyHono({ type: "unknown", handler: () => "" })
      ).toThrow("Unknown authentication scheme type 'unknown'");
    });

    it("should require authentication context to be a method, if defined", () => {
      expect(() =>
        scimmyHono({
          ...ValidAuthScheme,
          context: "not-a-function" as any,
        })
      ).toThrow("Parameter 'context' must be of type 'function'");
    });

    it("should require authentication baseUri to be a method, if defined", () => {
      expect(() =>
        scimmyHono({
          ...ValidAuthScheme,
          baseUri: "not-a-function" as any,
        })
      ).toThrow("Parameter 'baseUri' must be of type 'function'");
    });

    it("should expect exceptions thrown in authentication handler to be caught", async () => {
      const scim = scimmyHono({
        ...ValidAuthScheme,
        handler: () => {
          throw new Error("Not Logged In");
        },
      });
      const authApp = new Hono();
      authApp.route("/", scim);

      const res = await req(authApp).get("/ServiceProviderConfig");
      await expectScimError(res, 401, "Not Logged In");
    });
  });

  // =============================================
  // ServiceProviderConfig
  // =============================================
  describe("ROUTE /ServiceProviderConfig", () => {
    const sandbox = sinon.createSandbox();

    afterEach(() => sandbox.restore());

    it("GET /ServiceProviderConfig", async () => {
      const res = await req(app).get("/ServiceProviderConfig");
      await expectContentType(res);
      await expectStatus(res, 200);
      const body = await res.json();
      expect(body.schemas).toContain(
        "urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"
      );
      expect(body.patch.supported).toBe(true);
      expect(body.filter.supported).toBe(true);
      expect(body.sort.supported).toBe(true);
      expect(body.bulk.supported).toBe(true);
    });
  });

  // =============================================
  // Schemas
  // =============================================
  describe("ROUTE /Schemas", () => {
    it("GET /Schemas returns list", async () => {
      const res = await req(app).get("/Schemas");
      await expectContentType(res);
      await expectStatus(res, 200);
      const body = await res.json();
      expect(body.schemas).toContain(
        "urn:ietf:params:scim:api:messages:2.0:ListResponse"
      );
      expect(body.totalResults).toBeGreaterThan(0);
    });

    it("GET /Schemas/:id returns a specific schema", async () => {
      const res = await req(app).get(
        "/Schemas/urn:ietf:params:scim:schemas:core:2.0:User"
      );
      await expectContentType(res);
      await expectStatus(res, 200);
      const body = await res.json();
      expect(body.id).toBe("urn:ietf:params:scim:schemas:core:2.0:User");
    });

    it("GET /Schemas/:id returns 404 for unknown schema", async () => {
      const res = await req(app).get("/Schemas/unknown");
      await expectScimError(res, 404);
    });
  });

  // =============================================
  // ResourceTypes
  // =============================================
  describe("ROUTE /ResourceTypes", () => {
    it("GET /ResourceTypes returns list", async () => {
      const res = await req(app).get("/ResourceTypes");
      await expectContentType(res);
      await expectStatus(res, 200);
      const body = await res.json();
      expect(body.totalResults).toBeGreaterThan(0);
    });

    it("GET /ResourceTypes/:id returns a specific type", async () => {
      const res = await req(app).get("/ResourceTypes/User");
      await expectContentType(res);
      await expectStatus(res, 200);
    });

    it("GET /ResourceTypes/:id returns 404 for unknown type", async () => {
      const res = await req(app).get("/ResourceTypes/Unknown");
      await expectScimError(res, 404);
    });
  });

  // =============================================
  // Resource CRUD (Users, Groups) via sinon stubs
  // =============================================
  for (const Resource of Object.values(SCIMMY.Resources.declared()) as any[]) {
    const endpoint = Resource.endpoint; // "/Users" or "/Groups"

    describe(`ROUTE ${endpoint}`, () => {
      const sandbox = sinon.createSandbox();

      afterEach(() => sandbox.restore());

      it(`GET ${endpoint} returns list`, async () => {
        sandbox
          .stub(Resource.prototype, "read")
          .returns(new SCIMMY.Messages.ListResponse());

        const res = await req(app).get(endpoint);
        await expectListResponse(res, []);
      });

      it(`GET ${endpoint} handles errors`, async () => {
        sandbox.stub(Resource.prototype, "read").throws();

        const res = await req(app).get(endpoint);
        await expectScimError(res, 500);
      });

      it(`GET ${endpoint}/:id returns a single resource`, async () => {
        sandbox
          .stub(Resource.prototype, "read")
          .returns({ id: "1", test: true });

        const res = await req(app).get(`${endpoint}/1`);
        await expectContentType(res);
        await expectStatus(res, 200);
        const body = await res.json();
        expect(body.test).toBe(true);
      });

      it(`GET ${endpoint}/:id returns 404 for unknown`, async () => {
        sandbox
          .stub(Resource.prototype, "read")
          .throws(
            new SCIMMY.Types.Error(404, null, "Resource test not found")
          );

        const res = await req(app).get(`${endpoint}/test`);
        await expectScimError(res, 404, "Resource test not found");
      });

      it(`POST ${endpoint} creates a resource`, async () => {
        sandbox
          .stub(Resource.prototype, "write")
          .returns({ id: "new", test: true });

        const res = await req(app).post(endpoint, { test: true });
        await expectContentType(res);
        await expectStatus(res, 201);
        const body = await res.json();
        expect(body.id).toBe("new");
      });

      it(`POST ${endpoint} handles errors`, async () => {
        sandbox.stub(Resource.prototype, "write").throws();

        const res = await req(app).post(endpoint, {});
        await expectScimError(res, 500);
      });

      it(`PUT ${endpoint}/:id replaces a resource`, async () => {
        sandbox
          .stub(Resource.prototype, "write")
          .returns({ id: "1", test: true });

        const res = await req(app).put(`${endpoint}/1`, { test: true });
        await expectContentType(res);
        await expectStatus(res, 200);
        const body = await res.json();
        expect(body.test).toBe(true);
      });

      it(`PUT ${endpoint}/:id handles errors`, async () => {
        sandbox.stub(Resource.prototype, "write").throws();

        const res = await req(app).put(`${endpoint}/test`, {});
        await expectScimError(res, 500);
      });

      it(`PATCH ${endpoint}/:id with value returns 200`, async () => {
        sandbox
          .stub(Resource.prototype, "patch")
          .returns({ id: "1", test: true });

        const res = await req(app).patch(`${endpoint}/1`, {});
        await expectContentType(res);
        await expectStatus(res, 200);
      });

      it(`PATCH ${endpoint}/:id without value returns 204`, async () => {
        sandbox.stub(Resource.prototype, "patch").returns(undefined);

        const res = await req(app).patch(`${endpoint}/1`, {});
        await expectStatus(res, 204);
      });

      it(`PATCH ${endpoint}/:id handles errors`, async () => {
        sandbox.stub(Resource.prototype, "patch").throws();

        const res = await req(app).patch(`${endpoint}/test`, {});
        await expectScimError(res, 500);
      });

      it(`DELETE ${endpoint}/:id returns 204`, async () => {
        sandbox.stub(Resource.prototype, "dispose").returns(undefined);

        const res = await req(app).delete(`${endpoint}/1`);
        await expectStatus(res, 204);
      });

      it(`DELETE ${endpoint}/:id handles errors`, async () => {
        sandbox.stub(Resource.prototype, "dispose").throws();

        const res = await req(app).delete(`${endpoint}/test`);
        await expectScimError(res, 500);
      });
    });
  }

  // =============================================
  // Search
  // =============================================
  describe("ROUTE /.search", () => {
    const sandbox = sinon.createSandbox();

    afterEach(() => sandbox.restore());

    it("POST /.search with valid body returns results", async () => {
      for (const Resource of Object.values(
        SCIMMY.Resources.declared()
      ) as any[]) {
        sandbox
          .stub(Resource.prototype, "read")
          .returns(new SCIMMY.Messages.ListResponse());
      }

      const res = await req(app).post("/.search", {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:SearchRequest"],
      });
      await expectListResponse(res, []);
    });

    it("POST /.search with invalid body returns 400", async () => {
      const res = await req(app).post("/.search", {});
      await expectScimError(res, 400);
    });
  });

  // =============================================
  // Bulk
  // =============================================
  describe("ROUTE /Bulk", () => {
    const sandbox = sinon.createSandbox();

    afterEach(() => sandbox.restore());

    it("POST /Bulk returns 501 when not supported", async () => {
      sandbox.stub(SCIMMY.Config, "get").returns({});

      const res = await req(app).post("/Bulk", {});
      await expectScimError(res, 501, "Endpoint Not Implemented");
    });

    it("POST /Bulk returns 413 when payload too large", async () => {
      sandbox.stub(SCIMMY.Config, "get").returns({
        bulk: { supported: true, maxOperations: 1000, maxPayloadSize: 0 },
      });

      const body = JSON.stringify({
        schemas: ["urn:ietf:params:scim:api:messages:2.0:BulkRequest"],
        Operations: [{ method: "delete", path: "/" }],
      });
      const res = await app.request("/Bulk", {
        method: "POST",
        headers: {
          "Content-Type": "application/scim+json",
          "Content-Length": String(body.length),
        },
        body,
      });
      await expectScimError(res, 413);
    });

    it("POST /Bulk with valid request returns 200", async () => {
      sandbox.stub(SCIMMY.Config, "get").returns({
        bulk: {
          supported: true,
          maxOperations: 1000,
          maxPayloadSize: 1048576,
        },
      });
      sandbox.stub(SCIMMY.Resources, "declared").returns({});

      const res = await req(app).post("/Bulk", {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:BulkRequest"],
        Operations: [{ method: "delete", path: "/" }],
      });
      await expectContentType(res);
      await expectStatus(res, 200);
    });
  });

  // =============================================
  // Me
  // =============================================
  describe("ROUTE /Me", () => {
    const sandbox = sinon.createSandbox();

    afterEach(() => sandbox.restore());

    it("GET /Me returns user when implemented", async () => {
      sandbox.stub(SCIMMY.Resources, "declared").returns(true);
      sandbox
        .stub(SCIMMY.Resources.User.prototype, "read")
        .returns({ meta: { location: "/Users/test" } });

      const res = await req(app).get("/Me");
      await expectContentType(res);
      await expectStatus(res, 200);
      const body = await res.json();
      expect(body.meta.location).toBe("/Users/test");
    });

    it("GET /Me returns 501 when user has no location", async () => {
      sandbox.stub(SCIMMY.Resources, "declared").returns(true);
      sandbox.stub(SCIMMY.Resources.User.prototype, "read").returns({});

      const res = await req(app).get("/Me");
      await expectScimError(res, 501, "Endpoint Not Implemented");
    });

    it("GET /Me returns 501 when Users not declared", async () => {
      sandbox.stub(SCIMMY.Resources, "declared").returns(false);

      const res = await req(app).get("/Me");
      await expectScimError(res, 501, "Endpoint Not Implemented");
    });
  });

  // =============================================
  // 404 for unknown routes
  // =============================================
  describe("404 handling", () => {
    it("returns 404 for unknown endpoints", async () => {
      const res = await req(app).get("/Unknown");
      await expectScimError(res, 404, "Endpoint Not Found");
    });
  });
});
