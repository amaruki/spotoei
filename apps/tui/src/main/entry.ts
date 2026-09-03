// Entry point: invoke main() and propagate exit code.
import { main } from './index';

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((e: unknown) => {
    process.stderr.write(
      `spotoei: fatal unhandled error: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    process.exitCode = 1;
  });
