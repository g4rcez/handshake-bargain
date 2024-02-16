import { Testador } from "./testador";
import { z } from "zod";
import { test, describe } from "node:test";
import { fail, ok } from "node:assert";
import core from "@stoplight/spectral-core";
const Spectral = core.Spectral;
import { truthy } from "@stoplight/spectral-functions";
import fs from "node:fs/promises";
import path from "node:path";

describe("Should test createRequest", () => {
  test("Create post request", async () => {
    try {
      const response = await Testador.createRequest({
        name: "testRootEndpoint",
        method: "post",
        url: "http://localhost:3000",
        body: { body: "string" },
        queryString: { query: "string" },
        response: {
          200: {
            body: z.object({ root: z.literal(true) }),
          },
        },
        headers: { "Content-Type": "application/json", hack: "The planet" },
      });
      const result = Testador.openapi(response);
      ok(result.yaml, "YAML generated");
      ok(typeof result.yaml === "string", "Valid");
      const spectral = new Spectral();
      spectral.setRuleset({
        rules: {
          "no-empty-description": {
            given: "$..description",
            message: "Description must not be empty",
            then: {
              function: truthy,
            },
          },
        },
      });
      const run = await spectral.run(result.yaml);
      ok(run.length === 0, "No errors on validate yml");
      await fs.writeFile(
        path.resolve(process.cwd(), "openapi.yaml"),
        result.yaml,
        "utf8",
      );
    } catch (error: any) {
      fail(error);
    }
  });
});
