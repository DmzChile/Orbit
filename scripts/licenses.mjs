import { readFile, writeFile, readdir } from "node:fs/promises";
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
const parts = [
  "Orbit — third-party notices\nElectron and Chromium notices are distributed alongside the app.\n",
];
for (const [dir, info] of Object.entries(lock.packages)) {
  if (!dir || info.dev) continue;
  const pkg = JSON.parse(await readFile(`${dir}/package.json`, "utf8"));
  parts.push(
    `\n\n===== ${pkg.name} ${pkg.version} (${info.license ?? pkg.license ?? "see package"}) =====\n`,
  );
  const files = await readdir(dir);
  const license = files.find((n) => /^licen[cs]e(?:\.(md|txt))?$/i.test(n));
  if (license) parts.push(await readFile(`${dir}/${license}`, "utf8"));
  else
    parts.push(
      `License text: ${pkg.repository?.url ?? pkg.homepage ?? "package source"}`,
    );
}
await writeFile("resources/third-party-licenses.txt", parts.join("\n"));
