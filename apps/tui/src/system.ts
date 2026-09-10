import { spawn } from 'node:child_process';

export async function openBrowser(url: string): Promise<boolean> {
  try {
    const platform = process.platform;
    let command: string;
    let args: string[];
    if (platform === 'darwin') {
      command = 'open';
      args = [url];
    } else if (platform === 'win32') {
      command = 'cmd.exe';
      args = ['/c', 'start', '', url];
    } else {
      command = 'xdg-open';
      args = [url];
    }
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    return await new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (opened: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.removeAllListeners();
        child.unref();
        resolve(opened);
      };
      const timer = setTimeout(() => finish(true), 2_000);
      child.once('error', () => finish(false));
      child.once('close', (code) => finish(code === 0));
    });
  } catch {
    return false;
  }
}

export function copyToClipboard(text: string): boolean {
  try {
    const platform = process.platform;
    if (platform === 'darwin') {
      const p = spawn('pbcopy', [], { stdio: ['pipe', 'ignore', 'ignore'] });
      p.on('error', () => {});
      p.stdin?.write(text);
      p.stdin?.end();
      return true;
    }
    if (platform === 'win32') {
      const p = spawn('clip', [], { stdio: ['pipe', 'ignore', 'ignore'] });
      p.on('error', () => {});
      p.stdin?.write(text);
      p.stdin?.end();
      return true;
    }
    // Linux: try wl-copy, xclip, xsel
    const commands: Array<{ cmd: string; args: string[] }> = [
      { cmd: 'wl-copy', args: [] },
      { cmd: 'xclip', args: ['-selection', 'clipboard'] },
      { cmd: 'xsel', args: ['--clipboard', '--input'] },
    ];
    for (const { cmd, args } of commands) {
      try {
        const p = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'ignore'] });
        p.on('error', () => {});
        p.stdin?.write(text);
        p.stdin?.end();
        return true;
      } catch {
        // continue
      }
    }
  } catch {
    // ignore
  }
  return false;
}

function runClipboardCommand(cmd: string, args: string[]): Promise<string | null> {
  const { promise, resolve } = Promise.withResolvers<string | null>();
  try {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    let stdout = '';
    p.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    p.on('close', (code) => {
      if (code === 0 && stdout.trim().length > 0) {
        resolve(stdout.trim());
      } else {
        resolve(null);
      }
    });
    p.on('error', () => {
      resolve(null);
    });
  } catch {
    resolve(null);
  }
  return promise;
}

export async function readFromClipboard(): Promise<string | null> {
  const platform = process.platform;
  if (platform === 'darwin') {
    return runClipboardCommand('pbpaste', []);
  }
  if (platform === 'win32') {
    return runClipboardCommand('powershell', ['-NoProfile', '-Command', 'Get-Clipboard']);
  }
  const commands: Array<{ cmd: string; args: string[] }> = [
    { cmd: 'wl-paste', args: ['--no-newline'] },
    { cmd: 'xclip', args: ['-selection', 'clipboard', '-o'] },
    { cmd: 'xsel', args: ['--clipboard', '--output'] },
  ];
  for (const { cmd, args } of commands) {
    // eslint-disable-next-line no-await-in-loop
    const out = await runClipboardCommand(cmd, args);
    if (out !== null) {
      return out;
    }
  }
  return null;
}
