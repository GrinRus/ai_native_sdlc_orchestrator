import { asString } from "./http-utils.mjs";

/**
 * @param {import("node:http").ServerResponse} response
 * @param {{
 *   event: string,
 *   id?: string | null,
 *   data: Record<string, unknown>,
 * }} payload
 */
export function writeSseEvent(response, payload) {
  if (asString(payload.id)) {
    response.write(`id: ${payload.id}\n`);
  }
  response.write(`event: ${payload.event}\n`);
  for (const line of JSON.stringify(payload.data).split("\n")) {
    response.write(`data: ${line}\n`);
  }
  response.write("\n");
}
