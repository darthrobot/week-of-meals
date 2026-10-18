// Builds web/ into dist/: bundles the app (with Firebase) into one file,
// copies the static files, and stamps the offline cache with a build id.
import { build } from "esbuild";
import fs from "node:fs";

fs.rmSync("dist", { recursive: true, force: true });
fs.cpSync("web", "dist", {
  recursive: true,
  filter: (src) => !src.endsWith(".js") || src.endsWith("sw.js")
});

await build({
  entryPoints: ["web/app.js"],
  bundle: true,
  format: "esm",
  minify: true,
  target: "es2020",
  outfile: "dist/app.js"
});

const html = fs.readFileSync("dist/index.html", "utf8")
  .replace(/<!--importmap-->[\s\S]*?<!--\/importmap-->\n?/, "");
fs.writeFileSync("dist/index.html", html);

const sw = fs.readFileSync("dist/sw.js", "utf8").replace("__BUILD__", String(Date.now()));
fs.writeFileSync("dist/sw.js", sw);

console.log("Built dist/");
