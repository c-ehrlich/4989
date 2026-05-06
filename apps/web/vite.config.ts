import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { constants, createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, type Plugin } from "vite";

const appDirectory = dirname(fileURLToPath(new URL("./package.json", import.meta.url)));
const repoRoot = resolve(appDirectory, "../..");
const corpusDataDirectory = resolve(repoRoot, "packages/corpus-data/data");

export default defineConfig({
  plugins: [corpusDataDevServer(), tanstackStart(), nitro(), tailwindcss(), react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  }
});

function corpusDataDevServer(): Plugin {
  return {
    name: "4989-corpus-data-dev-server",
    apply: "serve",
    async configResolved() {
      await access(corpusDataDirectory, constants.R_OK);
    },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (!request.url || request.method === undefined) {
          next();
          return;
        }

        if (request.method !== "GET" && request.method !== "HEAD") {
          next();
          return;
        }

        const pathname = new URL(request.url, "http://localhost").pathname;
        if (!pathname.startsWith("/data/")) {
          next();
          return;
        }

        let relativePath: string;
        try {
          relativePath = decodeURIComponent(pathname.slice("/data/".length));
        } catch {
          response.statusCode = 400;
          response.end("Bad Request");
          return;
        }

        const filePath = resolve(corpusDataDirectory, relativePath);
        if (filePath !== corpusDataDirectory && !filePath.startsWith(`${corpusDataDirectory}${sep}`)) {
          response.statusCode = 403;
          response.end("Forbidden");
          return;
        }

        try {
          const fileStats = await stat(filePath);
          if (!fileStats.isFile()) {
            next();
            return;
          }

          response.statusCode = 200;
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.setHeader("Content-Length", fileStats.size);
          response.setHeader("Cache-Control", "no-cache");

          if (request.method === "HEAD") {
            response.end();
            return;
          }

          createReadStream(filePath).pipe(response);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            next();
            return;
          }

          next(error);
        }
      });
    }
  };
}
