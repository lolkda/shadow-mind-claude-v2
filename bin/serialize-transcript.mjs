// CLI for the main agent: emit the sanitized, windowed trajectory text.
//   node bin/serialize-transcript.mjs <transcriptPath> [maxChars]

import { serializeTrajectory } from "./trajectory.mjs";

const [transcriptPath, maxCharsRaw] = process.argv.slice(2);
if (!transcriptPath) {
  process.stderr.write("usage: node bin/serialize-transcript.mjs <transcriptPath> [maxChars]\n");
  process.exit(1);
}
const maxChars = maxCharsRaw && !Number.isNaN(Number(maxCharsRaw)) ? Number(maxCharsRaw) : Infinity;
const text = await serializeTrajectory(transcriptPath, { maxChars });
process.stdout.write(text);
