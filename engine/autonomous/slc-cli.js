// JSON stdin/stdout wrapper around the existing autonomous contract.
import { simulateAutonomousPlay } from './simulator.js';

let text = '';
for await (const chunk of process.stdin) text += chunk;
try {
  const result = simulateAutonomousPlay(JSON.parse(text));
  process.stdout.write(JSON.stringify(result, (_key, value) => ArrayBuffer.isView(value) ? Array.from(value) : value));
} catch (error) {
  process.stderr.write(`${error.name}: ${error.message}\n`);
  process.exitCode = 1;
}
