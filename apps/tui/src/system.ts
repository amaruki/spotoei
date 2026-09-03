import { spawn } from 'node:child_process';

export function openBrowser(url: string): boolean {
  try {
    const platform = process.platform;
    if (platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
      return true;
    }
    if (platform === 'win32') {
      spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
      return true;
    }
    // Linux / BSD / other Unix
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    return true;
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
