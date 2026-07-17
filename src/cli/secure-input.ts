export class SecureInputRequiredError extends Error {
  readonly code = 'secure_input_required';
}

export interface SecureInputOptions {
  prompt: string;
  agent?: boolean;
  ci?: boolean;
  input?: NodeJS.ReadStream;
  output?: NodeJS.WriteStream;
}

/**
 * 仅直接人类 TTY 可用的无回显输入。renderer、Agent、pipe 与 CI 永远不能调用它读取秘密。
 */
export async function readSecureInput(options: SecureInputOptions): Promise<string> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stderr;
  if (
    options.agent ||
    options.ci ||
    process.env.CI ||
    input.isTTY !== true ||
    output.isTTY !== true ||
    typeof input.setRawMode !== 'function'
  ) {
    throw new SecureInputRequiredError('Secure input requires a directly operated interactive terminal.');
  }

  const previousRawMode = input.isRaw === true;
  const chunks: string[] = [];
  output.write(options.prompt);
  input.setRawMode(true);
  input.resume();

  try {
    return await new Promise<string>((resolve, reject) => {
      const onData = (chunk: string | Buffer) => {
        const text = String(chunk);
        for (const character of text) {
          if (character === '\u0003') {
            cleanup();
            reject(Object.assign(new Error('Secure input interrupted.'), { code: 'SIGINT' }));
            return;
          }
          if (character === '\r' || character === '\n') {
            cleanup();
            output.write('\n');
            const value = chunks.join('').trim();
            if (!value) reject(new SecureInputRequiredError('Secure input cannot be empty.'));
            else resolve(value);
            return;
          }
          if (character === '\u007f' || character === '\b') {
            chunks.pop();
            continue;
          }
          if (character >= ' ') chunks.push(character);
        }
      };
      const onEnd = () => {
        cleanup();
        reject(new SecureInputRequiredError('Secure terminal input ended before submission.'));
      };
      const cleanup = () => {
        input.off('data', onData);
        input.off('end', onEnd);
      };
      input.on('data', onData);
      input.once('end', onEnd);
    });
  } finally {
    input.setRawMode(previousRawMode);
    if (!previousRawMode) input.pause();
  }
}
