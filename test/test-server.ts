import fastify, { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { DoneCallback } from "vitest";
import { z } from "zod";

const schema = z.object({ type: z.string() });

const endpointGET = (req: FastifyRequest, res: FastifyReply) => {
    const validation = schema.safeParse(req.query);
    res.type("application/json");
    if (validation.success) return res.send({ root: true });
    res.status(400);
    return res.send({ errors: validation.error.issues.map((x) => `[${x.path.join(".")}]${x.message}`) });
};

const endpointPOST = (_req: FastifyRequest, res: FastifyReply) => {
    return res.send({ root: true });
};

export const bootstrap = async (app: FastifyInstance = fastify({ logger: true })) => {
    const preHandler = (req: FastifyRequest, _: FastifyReply, done: DoneCallback) => {
        console.log(req.url, req.method, req.body);
        done();
    };
    app.get("/", { preHandler }, endpointGET).post("/", { preHandler }, endpointPOST);
    return app;
};

if (process.env.CLI_MODE === "true") {
    bootstrap().then((app) => app.listen({ port: 4000 }, () => console.log("🚀 :4000")));
}
