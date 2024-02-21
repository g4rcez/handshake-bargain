import fastify, { FastifyInstance } from "fastify";
import { z } from "zod";


const schema = z.object({ queryString: z.object({ type: z.string() }) });

export const bootstrap = async (
    app: FastifyInstance = fastify({ logger: true }),
) => {
    app.get("/", (req, res) => {
        const validation = schema.safeParse({ queryString: req.query });
        res.type("application/json");
        if (validation.success) return res.send({ root: true });
        res.status(400);
        return res.send({ errors: validation.error.issues.map((x) => x.message) });
    });
    app.post("/", (req, res) => {
        return res.send({ root: true });
    });
    return app;
};

// bootstrap().then(app => {
//     app.listen({port: 4000}, () => console.log(":4000"))
// })

