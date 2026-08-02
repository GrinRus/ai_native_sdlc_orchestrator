import { redactSensitiveValue } from "../../../../observability/src/index.mjs";
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
  let writable = true;
  if (asString(payload.id)) {
    writable = response.write(`id: ${payload.id}\n`) && writable;
  }
  writable = response.write(`event: ${payload.event}\n`) && writable;
  for (const line of JSON.stringify(data).split("\n")) {
    writable = response.write(`data: ${line}\n`) && writable;
  }
  writable = response.write("\n") && writable;
  return writable;
}
