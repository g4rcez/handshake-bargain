import stoplight from "@stoplight/spectral-core";
import { truthy } from "@stoplight/spectral-functions";
import { OpenApiBuilder as Oas31, OpenAPIObject as OpenApi31, ParameterObject, PathsObject } from "openapi3-ts/oas31";
import { OpenApiBuilder as Oas3, OpenAPIObject as OpenApi3 } from "openapi3-ts/oas31";
import { z } from "zod";
import { extendZodWithOpenApi } from "@anatine/zod-openapi";
import axios, { AxiosError } from "axios";
import { createSchema } from "genson-js"; // object => Json Schema
import { stringify as yaml } from "yaml";
import fs from "node:fs/promises";
import path from "node:path";

const Spectral = stoplight.Spectral;

const unique = <T>(array: T[], key?: keyof T) => {
    if (key === undefined) return [...new Set(array).values()];
    const seen = new Set();
    return Array.isArray(key) ? [...new Set(key)] : array.filter((el) => {
        const duplicate = key ? seen.has(el[key]) : seen.has(key);
        if (!!key) {
            if (!duplicate) {
                seen.add(el[key]);
            }
        }
        return !duplicate;
    });
};

type HttpMethod = "get" | "post" | "patch" | "put" | "delete";

extendZodWithOpenApi(z);

type Entries = <T>(t: T) => [keyof T, T[keyof T]][];

const entries: Entries = Object.entries as any;

export namespace HandshakeBargain {
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

    export const createRequest = async (
        props: Contract,
    ): Promise<ContractResult> => {
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
            const c = new Error(
                `Unexpected response status - ${error.response?.status ?? 0}`,
            );
            c.cause = error;
            throw c;
        }
    };


    const fetchParameters = (
        o: object | undefined,
        type: ParameterObject["in"],
    ): ParameterObject[] =>
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

    const parse = ({
                       response,
                       data,
                       request,
                   }: Awaited<ReturnType<typeof createRequest>>): OpenApiGenerated => {
        const contentType = request.headers?.["Content-Type"] || "application/json";
        const spec = new Oas31();
        spec
            .addTitle(request.name)
            .addServer({ url: request.url })
            .addTag({ name: request.name, description: request.name });
        const parameters: ParameterObject[] = [
            ...fetchParameters(request.queryString, "query"),
            ...fetchParameters(request.headers, "header"),
        ];
        spec.addPath(new URL(request.url).pathname, {
            [request.method]: {
                parameters: parameters.length > 0 ? parameters : undefined,
                requestBody: request.body
                    ? {
                        content: {
                            [contentType]: {
                                schema: createSchema(request.body),
                            },
                        },
                    }
                    : undefined,
                responses: {
                    [response.status]: {
                        description: `Response ${response.status} - ${request.name}`,
                        content: {
                            [contentType]: {
                                schema: {
                                    ...(createSchema(data) as any),
                                    examples: [data],
                                },
                            },
                        },
                    },
                },
            },
        });
        return { yaml: yaml(spec.rootDoc), json: JSON.parse(JSON.stringify(spec.rootDoc)) };
    };

    type BuildAllArgs = () => Promise<ContractResult>

    const aggregateAll = (all: OpenApiGenerated[], Oas: typeof Oas31 | typeof Oas3) => {
        const builder = new Oas();
        const paths = new Map<string, PathsObject>();
        all.forEach(x => {
            const servers = x.json.servers ?? [];
            const tags = x.json.tags ?? [];
            servers.forEach(server => builder.addServer(server));
            tags.forEach(tag => builder.addTag(tag));
            const p = x.json.paths || {};
            const pathKey = Object.keys(p)[0];
            const current = paths.get(pathKey) || {};
            paths.set(pathKey, { ...current, ...p[pathKey] } as PathsObject);
        });
        paths.forEach((path, key) => {
            builder.addPath(key, path);
        });
        builder.rootDoc.servers = unique(builder.rootDoc.servers ?? [], "url");
        builder.rootDoc.tags = unique(builder.rootDoc.tags ?? [], "name");
        return builder.getSpecAsYaml();
    };

    type Info = { name: string; version?: "3" | "3.1" }

    export const buildAll = async (info: Info, ...requests: BuildAllArgs[]) => {
        const builder = info.version === "3" ? Oas3 : Oas31;
        const schemas: OpenApiGenerated[] = [];
        const errors: Error[] = [];
        for (let i = 0; i < requests.length; i++) {
            const request = requests[i];
            try {
                const response = await request();
                const parsed = parse(response);
                schemas.push(parsed);
            } catch (e: any) {
                errors.push(e);
            }
        }
        const openapi = aggregateAll(schemas, builder);
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
        }
        return { schemas, errors, hasErrors, openapi, lint };
    };
}
