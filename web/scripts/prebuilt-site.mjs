// Copy the two app builds into the portal's prebuilt app folders (the Amplify build adds the data, no JS build there):
//   dist/        (npm run build)        -> ../site/        the full portal (+ security-tests.html, the AI 安全測試 demo)
//   dist-clean/  (npm run build:clean)  -> ../site-clean/  the clean portal for everyone in the company
// Only the app shell is copied: index.html, assets/ (and the demo page for the full portal) - never data/, runs/, config/.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";

const web = new URL("../", import.meta.url).pathname;
// `node scripts/prebuilt-site.mjs v3`: only dist-v3/ -> ../site-v3/ (the v3 portal, PORTAL_EDITION=v3)
const builds = process.argv[2] === "v3" ? [["dist-v3", "site-v3", []]] : [["dist", "site", ["security-tests.html"]], ["dist-clean", "site-clean", []]];
for (const [from, to, extra] of builds) {
  const src = web + from + "/";
  const dst = web + "../" + to + "/";
  if (!existsSync(src + "index.html")) throw new Error(`${from}/index.html is missing: run the build first`);
  rmSync(dst + "assets", { recursive: true, force: true });
  mkdirSync(dst, { recursive: true });
  cpSync(src + "index.html", dst + "index.html");
  cpSync(src + "assets", dst + "assets", { recursive: true });
  for (const f of extra) if (existsSync(src + f)) cpSync(src + f, dst + f);
  console.log(`${from}/ -> ${to}/`);
}
