import { appendFile, mkdir, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
export async function writeDiagnostic(
  directory: string,
  entry: { event: string; code: string; correlationId: string },
) {
  const folder = join(directory, "logs");
  await mkdir(folder, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  await appendFile(
    join(folder, `orbit-${day}.jsonl`),
    JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n",
    { mode: 0o600 },
  );
  for (const file of await readdir(folder)) {
    const match = /^orbit-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(file);
    if (match && Date.now() - Date.parse(match[1]) > 7 * 86400000)
      await unlink(join(folder, file));
  }
}
