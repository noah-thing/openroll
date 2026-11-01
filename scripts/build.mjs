import { build } from "vite";
import { bundleMain } from "./bundle.mjs";

await bundleMain();
await build({ configFile: "vite.config.ts" });
