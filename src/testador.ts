import { OpenApiBuilder, ParameterObject } from "openapi3-ts/oas31";
import { z } from "zod";
import { extendZodWithOpenApi } from "@anatine/zod-openapi";
import axios, { AxiosError } from "axios";
import { createSchema } from "genson-js";
import { stringify as yaml } from "yaml";

type HttpMethod = "get" | "post" | "patch" | "put" | "delete";

extendZodWithOpenApi(z);

type Entries = <T>(t: T) => [keyof T, T[keyof T]][];

const entries: Entries = Object.entries as any;

export namespace Testador {
  type Contract = {
    url: string;
    name: string;
    method: HttpMethod;
    queryString?: object;
    body?: any;
    headers?: Record<string, string> & { "Content-Type": string };
    response: Partial<Record<number, { body: z.ZodType; headers?: z.ZodType }>>;
  };

  type ContractResult = {
    data: any;
    response: { status: number };
    request: Contract;
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

  export const openapi = ({
    response,
    data,
    request,
  }: Awaited<ReturnType<typeof createRequest>>) => {
    const contentType = request.headers?.["Content-Type"] || "application/json";
    const spec = new OpenApiBuilder();
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
    return {
      yaml: yaml(spec.rootDoc),
      json: JSON.parse(JSON.stringify(spec.rootDoc)),
    };
  };
}
