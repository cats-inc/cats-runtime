// A stand-in for `kiro-cli acp --agent-engine v3` with the 2.30.0 shapes the probe depends on.
// argv[2] selects a mode: ok, auth, silent, no-model. FAKE_KIRO_ACP_LOG names a file that
// receives one line per request method, so a test can check the session was deleted.
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const mode = process.argv[2] ?? 'ok';
const log = process.env.FAKE_KIRO_ACP_LOG;
const write = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const meta = (fields) => ({ kiro: { rateUnit: 'Credit', ...fields } });

const MODEL_OPTION = {
  id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'auto',
  options: [
    { value: 'auto', name: 'Auto', description: 'Chosen by task', _meta: meta({ rateMultiplier: 1, hasEffort: false, thinkingToggleable: false }) },
    { value: 'ex-think', name: 'Example Think', description: 'Thinks', _meta: meta({ rateMultiplier: 2, hasEffort: true, effortSchemaPath: 'output_config', effortLevels: ['low', 'medium', 'high'], defaultEffortLevel: 'medium', thinkingToggleable: true, defaultThinkingEnabled: true }) },
    { value: 'ex-plain', name: 'Example Plain', _meta: meta({ rateMultiplier: 0.5, hasEffort: false, thinkingToggleable: false }) },
  ],
};

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  const message = JSON.parse(line);
  if (log) appendFileSync(log, `${message.method}\n`);
  if (mode === 'silent') return;
  switch (message.method) {
    case 'initialize':
      if (mode === 'auth') {
        write({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'Not logged in. Run kiro-cli login.' } });
        return;
      }
      write({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true, sessionCapabilities: { list: {}, delete: {} } } } });
      return;
    case 'session/new':
      if (mode !== 'no-model') {
        write({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'sess_fake', update: { sessionUpdate: 'available_commands_update', availableCommands: [] } } });
        write({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'sess_fake', update: { sessionUpdate: 'config_option_update', configOptions: [{ id: 'mode', type: 'select', currentValue: 'vibe', options: [] }, MODEL_OPTION] } } });
      }
      write({ jsonrpc: '2.0', id: message.id, result: { sessionId: 'sess_fake' } });
      return;
    case 'session/delete':
      write({ jsonrpc: '2.0', id: message.id, result: {} });
      return;
    default:
      write({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } });
  }
});
