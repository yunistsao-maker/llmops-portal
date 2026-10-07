// Copy ../data (validated JSON) into public/data so the app serves it at /data/*.
import { cpSync, existsSync, rmSync } from "node:fs";
const src = new URL("../../data", import.meta.url).pathname;
const dst = new URL("../public/data", import.meta.url).pathname;
if (existsSync(dst)) rmSync(dst, { recursive: true });
cpSync(src, dst, { recursive: true });
console.log("synced data ->", dst);
