import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const root = fileURLToPath(new URL(".", import.meta.url));
const repositoryRoot = path.resolve(root, "../../../..");

export default defineConfig({
  root,
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 4177,
    strictPort: true,
    fs: { allow: [repositoryRoot] },
  },
  build: {
    outDir: path.join(tmpdir(), "aor-iterative-task-prototype-dist"),
    emptyOutDir: true,
  },
});
