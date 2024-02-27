import Fastify from "fastify";
import { parse } from "yaml";
import fs from "node:fs/promises";
import path from "node:path";
import swaggerUI from "@fastify/swagger-ui";
import swagger from "@fastify/swagger";
import proxy from "@fastify/http-proxy";

async function main() {
    const fastify = Fastify({ logger: true });
    await fastify.register(proxy, { upstream: "http://localhost:4000" });
    const file = path.resolve(process.cwd(), "openapi.yaml");
    const content = await fs.readFile(file, "utf8");
    await fastify.register(swagger, {
        swagger: parse(content),
    });

    await fastify.register(swaggerUI, {
        routePrefix: "/docs",
        uiConfig: {
            docExpansion: "full",
            deepLinking: false,
        },
    });
    await fastify.listen({ port: 1337 });
}

main();
