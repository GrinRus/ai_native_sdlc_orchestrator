import { redactSensitiveValue } from "../../../packages/observability/src/index.mjs";
import { asString, getResponseRedactionPolicy } from "./http-utils.mjs";

/**
 * @param {import("node:http").ServerResponse} response
 * @param {{
 *   event: string,
 *   id?: string | null,
 *   data: Record<string, unknown>,
 * }} payload
 */
export function writeSseEvent(response, payload) {
  const data = redactSensitiveValue(payload.data, getResponseRedactionPolicy(response));
  if (asString(payload.id)) {
    response.write(`id: ${payload.id}\n`);
  }
  response.write(`event: ${payload.event}\n`);
  for (const line of JSON.stringify(data).split("\n")) {
    response.write(`data: ${line}\n`);
  }
  response.write("\n");
}
