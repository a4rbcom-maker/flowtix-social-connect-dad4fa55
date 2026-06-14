import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, context: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (module) => (module.default ?? module) as ServerEntry,
    );
  }

  return serverEntryPromise;
}

async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text().catch(() => "");
  const isHiddenSsrError = body.includes('"unhandled":true') && body.includes('"message":"HTTPError"');
  if (!isHiddenSsrError) return response;

  console.error(consumeLastCapturedError() ?? new Error(`SSR handler returned hidden HTTPError: ${body}`));

  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export default {
  async fetch(request: Request, env: unknown, context: unknown) {
    try {
      const handler = await getServerEntry();
      const isHead = request.method === "HEAD";
      const normalizedRequest = isHead ? new Request(request, { method: "GET" }) : request;
      const response = await handler.fetch(normalizedRequest, env, context);
      if (isHead) {
        const normalized = await normalizeCatastrophicSsrResponse(response);
        return new Response(null, {
          status: normalized.status,
          statusText: normalized.statusText,
          headers: normalized.headers,
        });
      }
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};