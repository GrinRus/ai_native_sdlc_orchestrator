const SUPPORTED_TRANSPORTS = Object.freeze([
  "request-artifact",
  "stdin-json",
  "file-attachment",
  "argv-json",
  "none",
]);

export function resolveRequestTransport(externalRuntime, requestViaStdin) {
  const configured = typeof externalRuntime.request_transport === "string"
    ? externalRuntime.request_transport.trim()
    : "";
  return configured || (requestViaStdin ? "stdin-json" : "none");
}

export function isSupportedRequestTransport(requestTransport) {
  return SUPPORTED_TRANSPORTS.includes(requestTransport);
}
