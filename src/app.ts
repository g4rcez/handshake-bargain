import { AutoloadPluginOptions } from "@fastify/autoload";
import fastify, { FastifyPluginAsync } from "fastify";
import { z } from "zod";

export type AppOptions = {} & Partial<AutoloadPluginOptions>;

const schema = z.object({ queryString: z.object({ type: z.string() }) });

const bootstrap: FastifyPluginAsync<AppOptions> = async (
  app,
): Promise<void> => {
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
  await app.listen({ port: 3000 }, () => {
    console.log(":3000");
  });
};

bootstrap(fastify(), {});
