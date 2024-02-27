import { extendZodWithOpenApi } from "@anatine/zod-openapi";
import stoplight from "@stoplight/spectral-core";
import { truthy } from "@stoplight/spectral-functions";
import axios, { AxiosError } from "axios";
import { createSchema } from "genson-js"; // object => Json Schema
import fs from "node:fs/promises";
import path from "node:path";
import {
    OpenApiBuilder as Oas31,
    OpenAPIObject as OpenApi31,
    OpenAPIObject as OpenApi3,
    OperationObject,
    ParameterObject,
    PathItemObject,
    PathsObject,
    ResponseObject,
    ResponsesObject,
    ServerObject,
} from "openapi3-ts/oas31";
import { stringify as yaml } from "yaml";
import { z } from "zod";

const Spectral = stoplight.Spectral;

const unique = <T>(array: T[], key?: keyof T) => {
    if (key === undefined) return [...new Set(array).values()];
    const seen = new Set();
    return Array.isArray(key)
        ? [...new Set(key)]
        : array.filter((el) => {
              const duplicate = key ? seen.has(el[key]) : seen.has(key);
              if (!!key) {
                  if (!duplicate) {
                      seen.add(el[key]);
                  }
              }
              return !duplicate;
          });
};

const json = <T>(cookie: string): T => {
    if (cookie === "") {
        return {} as T;
    }
    return document.cookie
        .split("; ")
        .map((v) => v.split("="))
        .reduce((acc: any, v: any) => {
            acc[decodeURIComponent(v[0].trim())] = decodeURIComponent(v[1].trim());
            return acc;
        }, {});
};

type HttpMethod = "get" | "post" | "patch" | "put" | "delete";

extendZodWithOpenApi(z);

type Entries = <T>(t: T) => [keyof T, T[keyof T]][];

const entries: Entries = Object.entries as any;

export namespace HandshakeBargain {
    type ServerUrl = `http://${string}` | `https://${string}`;

    type Info = { name: string; servers?: ServerUrl[] };

    type Contract = {
        url: string;
        name: string;
        body?: any;
        method: HttpMethod;
        queryString?: object;
        headers?: Record<string, string> & { "Content-Type": string };
        response: Partial<Record<number, { body: z.ZodType; headers?: z.ZodType }>>;
    };

    type ContractResult = {
        data: any;
        request: Contract;
        response: { status: number };
    };

    export const createRequest = async (props: Contract): Promise<ContractResult> => {
        try {
            const response = await axios({
                method: props.method,
                url: props.url,
                data: props.body,
                params: props.queryString,
                headers: props.headers,
            });
            if (response.status in props.response) {
                const schema = props.response[response.status];
                const bodyValidation = schema?.body?.safeParse(response.data);
                if (bodyValidation?.success) {
                    const s = schema?.body?.openapi({ example: bodyValidation.data });
                    return {
                        data: bodyValidation.data,
                        response: { status: response.status },
                        request: {
                            ...props,
                            response: {
                                ...props.response,
                                [response.status]: { ...schema, body: s! || schema?.body! },
                            },
                        },
                    };
                }
                throw new Error(`Unexpected response status - ${response.status}`);
            }
            throw new Error(`Unexpected response status - ${response.status}`);
        } catch (error: any) {
            if ((error as AxiosError).isAxiosError) {
                const e = error as AxiosError;
                const response = e.response!;
                if (response.status in props.response) {
                    const bodySchema = props.response[response.status];
                    const validation = bodySchema?.body.safeParse(response.data);
                    if (validation?.success) {
                        return Promise.resolve({
                            data: validation.data,
                            response: { status: response.status },
                            request: props,
                        });
                    }
                    throw validation?.error;
                }
            }
            const c = new Error(`Unexpected response status - ${error.response?.status ?? 0}`);
            c.cause = error;
            throw c;
        }
    };

    const fetchParameters = (o: object | undefined, type: ParameterObject["in"]): ParameterObject[] =>
        !o
            ? []
            : entries(o).reduce<ParameterObject[]>(
                  (acc, [key, value]) => [
                      ...acc,
                      {
                          in: type,
                          name: key,
                          example: value,
                          description: key,
                          schema: createSchema(o[key]),
                      },
                  ],
                  [],
              );

    type OpenApiGenerated = { yaml: string; json: OpenApi31 | OpenApi3 };

    const parse = ({ response, data, request }: Awaited<ReturnType<typeof createRequest>>): OpenApiGenerated => {
        const contentType = request.headers?.["Content-Type"] || "application/json";
        const spec = new Oas31();
        const server = { url: request.url };
        spec.addTitle(request.name).addServer(server).addTag({ name: request.name, description: request.name });
        const parameters: ParameterObject[] = [
            ...fetchParameters(request.queryString, "query"),
            ...fetchParameters(request.headers, "header"),
            ...fetchParameters(json(request.headers?.cookies ?? ""), "cookie"),
        ];
        spec.addPath(new URL(request.url).pathname, {
            [request.method]: {
                parameters: parameters.length > 0 ? parameters : undefined,
                tags: [request.name],
                servers: [server],
                description: request.name,
                requestBody: request.body
                    ? {
                          content: {
                              [contentType]: {
                                  schema: createSchema(request.body),
                                  examples: { value: { value: JSON.stringify(request.body) } }
                              },
                          },
                      }
                    : undefined,
                responses: {
                    [response.status]: {
                        description: `Response ${response.status} - ${request.name}`,
                        content: {
                            [contentType]: {
                                schema: createSchema(data),
                                examples: { value: { value: JSON.stringify(data) } },
                            },
                        },
                    } as ResponseObject,
                } as ResponsesObject,
            } as OperationObject,
        });
        return { yaml: yaml(spec.rootDoc), json: JSON.parse(JSON.stringify(spec.rootDoc)) };
    };

    type BuildAllArgs = () => Promise<ContractResult>;

    const getMethodFromPaths = (paths: PathItemObject): HttpMethod => Object.keys(paths)[0] as HttpMethod;

    const aggregateAll = (all: OpenApiGenerated[], info: Info) => {
        const builder = new Oas31();
        const paths = new Map<string, PathsObject>();
        const defaultServers = (info.servers ?? []).map((url): ServerObject => ({ url }));
        all.forEach((x) => {
            const servers = [...defaultServers, ...(x.json.servers ?? [])];
            const tags = x.json.tags ?? [];
            servers.forEach((server) => builder.addServer(server));
            tags.forEach((tag) => builder.addTag(tag));
            const p = x.json.paths || {};
            const pathKey = Object.keys(p)[0];
            const current = paths.get(pathKey) || {};
            const method = getMethodFromPaths(p[pathKey]);
            const newRequest = p[pathKey];
            if (newRequest[method]) {
                const currentServers = p[pathKey].servers ?? [];
                newRequest[method]!.servers = [...currentServers, ...defaultServers];
            }
            paths.set(pathKey, { ...current, ...newRequest } as PathsObject);
        });
        paths.forEach((path, key) => {
            builder.addPath(key, path);
        });
        builder.rootDoc.servers = unique(builder.rootDoc.servers ?? [], "url");
        builder.rootDoc.tags = unique(builder.rootDoc.tags ?? [], "name");
        return builder.getSpecAsYaml();
    };

    export const buildAll = async (info: Info, ...requests: BuildAllArgs[]) => {
        const schemas: OpenApiGenerated[] = [];
        const errors: Error[] = [];
        for (let i = 0; i < requests.length; i++) {
            const request = requests[i];
            try {
                const response = await request();
                const parsed = parse(response);
                schemas.push(parsed);
            } catch (e: any) {
                console.error(e);
                errors.push(e);
            }
        }
        const openapi = aggregateAll(schemas, info);
        const spectral = new Spectral();
        spectral.setRuleset({
            rules: {
                "no-empty-description": {
                    given: "$..description",
                    message: "Description must not be empty",
                    then: { function: truthy },
                },
            },
        });
        const lint = await spectral.run(openapi);
        const hasErrors = errors.length > 0 || lint.length > 0;
        if (!hasErrors) {
            const isAbsolute = info.name.startsWith("/") || info.name.startsWith("./");
            const filePath = isAbsolute ? info.name : path.join(path.resolve(process.cwd(), info.name));
            await fs.writeFile(filePath, openapi, "utf-8");
        } else {
            console.error(JSON.stringify({ lint, errors, hasErrors }, null, 4));
        }
        return { schemas, errors, hasErrors, openapi, lint };
    };
}
