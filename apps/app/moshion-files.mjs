// Dev-server plugin: keeps projects as files on disk so every browser on this computer
// (Chrome, the Claude preview, …) sees the same projects. Same folder as the desktop app.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Documents/Moshion Projects (not "Moshion": on Windows that is the same folder as the code). */
export const PROJECTS_DIR = path.join(os.homedir(), "Documents", "Moshion Projects");
const MEDIA_DIR = path.join(PROJECTS_DIR, "media");
const okId = (id) => /^[\w-]{1,80}$/.test(id);

function body(req) {
  return new Promise((res, rej) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => res(Buffer.concat(chunks)));
    req.on("error", rej);
  });
}
const send = (res, code, data, type = "application/json") => {
  res.statusCode = code;
  res.setHeader("Content-Type", type);
  res.setHeader("Cache-Control", "no-store");
  res.end(type === "application/json" && typeof data !== "string" ? JSON.stringify(data) : data);
};

/** @returns {import("vite").Plugin} */
export function moshionFiles() {
  return {
    name: "moshion-files",
    configureServer(server) {
      fs.mkdirSync(MEDIA_DIR, { recursive: true });
      server.middlewares.use("/__moshion", async (req, res) => {
        try {
          const url = new URL(req.url ?? "/", "http://x");
          const [, kind, id] = url.pathname.split("/");
          if (kind === "ping") return send(res, 200, { dir: PROJECTS_DIR });
          if (kind === "projects" && req.method === "GET") {
            const out = [];
            for (const name of fs.readdirSync(PROJECTS_DIR)) {
              if (!name.endsWith(".moshion")) continue;
              try { out.push(JSON.parse(fs.readFileSync(path.join(PROJECTS_DIR, name), "utf8"))); } catch { /* skip broken file */ }
            }
            return send(res, 200, out);
          }
          if (kind === "project" && id && okId(id)) {
            const file = path.join(PROJECTS_DIR, `${id}.moshion`);
            if (req.method === "PUT") {
              const text = (await body(req)).toString("utf8");
              JSON.parse(text); // only valid JSON gets written
              fs.writeFileSync(file + ".tmp", text);
              fs.renameSync(file + ".tmp", file);
              return send(res, 200, { ok: true });
            }
            if (req.method === "DELETE") { if (fs.existsSync(file)) fs.rmSync(file); return send(res, 200, { ok: true }); }
            if (req.method === "GET") return fs.existsSync(file) ? send(res, 200, fs.readFileSync(file, "utf8")) : send(res, 404, { missing: true });
          }
          if (kind === "media" && id && okId(id)) {
            const file = path.join(MEDIA_DIR, id);
            if (req.method === "GET") return fs.existsSync(file) ? send(res, 200, fs.readFileSync(file), "application/octet-stream") : send(res, 404, { missing: true });
            if (req.method === "PUT") { if (!fs.existsSync(file)) fs.writeFileSync(file, await body(req)); else await body(req); return send(res, 200, { ok: true }); }
          }
          send(res, 404, { error: "not found" });
        } catch (e) {
          send(res, 500, { error: String(e?.message ?? e) });
        }
      });
    },
  };
}
