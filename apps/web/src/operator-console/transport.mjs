import { asRecord, asString } from "./shared.mjs";

/**
 * @param {string} value
 * @returns {string}
 */
export function normalizeControlPlaneBaseUrl(value) {
  const url = new URL(value);
  if (url.pathname !== "/") {
    url.pathname = url.pathname.replace(/\/+$/u, "");
  }
  return url.toString().replace(/\/+$/u, "");
}

/**
 * @param {{
 *   controlPlane: string,
 *   pathname: string,
 *   query?: Record<string, string | number | undefined>,
 * }} options
 * @returns {URL}
 */
export function buildControlPlaneUrl(options) {
  const normalizedBase = normalizeControlPlaneBaseUrl(options.controlPlane);
  const baseWithSlash = normalizedBase.endsWith("/") ? normalizedBase : `${normalizedBase}/`;
  const url = new URL(options.pathname.replace(/^\/+/u, ""), baseWithSlash);
  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value === undefined) continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

/**
 * @param {{
 *   authToken?: string,
 *   accept: string,
 *   contentType?: string,
 * }} options
 */
export function buildControlPlaneHeaders(options) {
  /** @type {Record<string, string>} */
  const headers = {
    accept: options.accept,
  };
  if (options.accept !== "text/event-stream") {
    headers.connection = "close";
  }
  if (options.contentType) {
    headers["content-type"] = options.contentType;
  }
  const authToken = asString(options.authToken);
  if (authToken) {
    headers.authorization = `Bearer ${authToken}`;
  }
  return headers;
}

/**
 * @param {{
 *   controlPlane: string,
  *   pathname: string,
  *   query?: Record<string, string | number | undefined>,
 *   authToken?: string,
 * }} options
 */
export async function readControlPlaneJson(options) {
  const url = buildControlPlaneUrl(options);
  const response = await fetch(url, {
    headers: buildControlPlaneHeaders({
      accept: "application/json",
      authToken: options.authToken,
    }),
  });
  if (!response.ok) {
    const message = (await response.text()).trim();
    throw new Error(`Control-plane request failed (${response.status}) for '${url}': ${message || response.statusText}`);
  }
  return response.json();
}

/**
 * @param {{
 *   controlPlane: string,
  *   pathname: string,
  *   body: Record<string, unknown>,
 *   authToken?: string,
 *   allowedStatusCodes?: number[],
 * }} options
 */
export async function writeControlPlaneJson(options) {
  const url = buildControlPlaneUrl(options);
  const response = await fetch(url, {
    method: "POST",
    headers: buildControlPlaneHeaders({
      accept: "application/json",
      contentType: "application/json; charset=utf-8",
      authToken: options.authToken,
    }),
    body: JSON.stringify(options.body),
  });

  const raw = await response.text();
  let payload = {};
  if (raw.trim().length > 0) {
    try {
      payload = /** @type {Record<string, unknown>} */ (JSON.parse(raw));
    } catch {
      throw new Error(`Control-plane mutation returned invalid JSON (${response.status}) for '${url}'.`);
    }
  }

  const allowedStatusCodes = options.allowedStatusCodes ?? [];
  if (!response.ok && !allowedStatusCodes.includes(response.status)) {
    const errorPayload = asRecord(asRecord(payload).error);
    const message = asString(errorPayload.message) ?? (raw.trim().length > 0 ? raw.trim() : response.statusText);
    throw new Error(`Control-plane mutation failed (${response.status}) for '${url}': ${message}`);
  }
  return payload;
}

/**
 * @param {{
 *   controlPlane: string,
  *   pathname: string,
  *   query?: Record<string, string | number | undefined>,
 *   authToken?: string,
 *   onEvent: (event: Record<string, unknown>) => void,
 * }} options
 */
export function openControlPlaneSseStream(options) {
  const controller = new AbortController();
  /** @type {ReadableStreamDefaultReader<Uint8Array> | null} */
  let reader = null;

  const done = (async () => {
    const url = buildControlPlaneUrl({
      controlPlane: options.controlPlane,
      pathname: options.pathname,
      query: options.query,
    });
    const response = await fetch(url, {
      headers: buildControlPlaneHeaders({
        accept: "text/event-stream",
        authToken: options.authToken,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const message = (await response.text()).trim();
      throw new Error(`Control-plane SSE failed (${response.status}) for '${url}': ${message || response.statusText}`);
    }
    if (!response.body) {
      throw new Error("Control-plane SSE stream has no response body.");
    }

    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        return;
      }
      buffer += decoder.decode(chunk.value, { stream: true });

      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");

        const normalizedBlock = block.replace(/\r/g, "");
        const lines = normalizedBlock.split("\n");
        let eventName = "message";
        let data = "";
        for (const line of lines) {
          if (line.startsWith("event:")) {
            eventName = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            const payloadLine = line.slice(5).trimStart();
            data = data.length > 0 ? `${data}\n${payloadLine}` : payloadLine;
          }
        }
        if (eventName !== "live-run-event" || data.length === 0) {
          continue;
        }
        options.onEvent(/** @type {Record<string, unknown>} */ (JSON.parse(data)));
      }
    }
  })();

  return {
    close() {
      controller.abort();
      if (reader) {
        reader.cancel().catch(() => {});
      }
    },
    done: done.catch((error) => {
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }
      throw error;
    }),
  };
}

/**
 * @param {{
 *   requestedControlPlane: string | null,
 *   uiLifecycleState: Record<string, unknown>,
 * }} options
 * @returns {string | null}
 */
export function resolveControlPlaneUrl(options) {
  if (options.requestedControlPlane) {
    return options.requestedControlPlane;
  }
  const controlPlane = asString(options.uiLifecycleState.control_plane);
  const connectionState = asString(options.uiLifecycleState.connection_state);
  if (!controlPlane || connectionState !== "connected") {
    return null;
  }
  return controlPlane;
}
