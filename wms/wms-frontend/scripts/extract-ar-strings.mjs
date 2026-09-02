import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const re = /[\u0600-\u06FF][\u0600-\u06FF\s\d\.,\-()\/:%+#@!?*"'\u060C\u061B]+/g;
const found = new Set();

function walk(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory() && f.name !== "node_modules" && f.name !== "locales") walk(p);
    else if (/\.(jsx|js)$/.test(f.name)) {
      const t = fs.readFileSync(p, "utf8");
      let m;
      while ((m = re.exec(t))) {
        const s = m[0].trim().replace(/\s+/g, " ");
        if (s.length >= 2 && s.length < 150) found.add(s);
      }
    }
  }
}

walk(root);
const list = [...found].sort();
console.log("count", list.length);
fs.writeFileSync(path.join(root, "i18n", "extracted-ar.json"), JSON.stringify(list, null, 2), "utf8");
