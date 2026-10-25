import { scan, finalize } from "./runtime";
const operation = process.argv[2] ?? "scan";
try {
  if (operation === "finalize") await finalize();
  else if (operation === "scan") await scan();
  else throw new Error("Unsupported worker operation");
} catch {
  console.error(
    JSON.stringify({
      event: "worker_failed",
      correlationId: crypto.randomUUID(),
    }),
  );
  process.exitCode = 1;
}
