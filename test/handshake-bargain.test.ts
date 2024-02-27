import { describe, beforeAll, test, expect, afterAll } from "vitest";
import { z } from "zod";
import { bootstrap } from "./test-server";
import { HandshakeBargain } from "../src";

describe("testador", async () => {
    const app = await bootstrap();

    beforeAll(async () => {
        await app.listen({ port: 3000 });
    });

    afterAll(async () => {
        app.server.close();
    });

    test("Test buildAll method", async () => {
        await HandshakeBargain.buildAll(
            { name: "openapi.yaml", servers: ["http://localhost:4000", "http://0.0.0.0:1337"] },
            async () => {
                const result = await HandshakeBargain.createRequest({
                    name: "PostRequest",
                    method: "post",
                    url: "http://0.0.0.0:3000",
                    body: { body: "string" },
                    headers: { "Content-Type": "application/json" },
                    response: {
                        200: {
                            body: z.object({ root: z.literal(true) }),
                        },
                    },
                });
                expect(result.data.root).toBe(true);
                return result;
            },
            () =>
                HandshakeBargain.createRequest({
                    name: "GetRequest",
                    method: "get",
                    url: "http://0.0.0.0:3000",
                    queryString: { QUALQUER_COISA: "TYPE_IN_QUERY_STRING_GET" },
                    headers: { "Content-Type": "application/json" },
                    response: { 400: { body: z.object({ errors: z.array(z.string()) }) } },
                }),
        );
    });
});
