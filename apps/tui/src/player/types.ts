import type { ChildProcess } from 'node:child_process';

export interface HandshakeResult {
  protocol: number;
  playerVersion: string;
  capabilities: string[];
  child: ChildProcess;
}

export const UI_VERSION = 'spotoei-tui/0.0.0';

export const ANSI_REGEX =
  // eslint-disable-next-line no-control-regex
  /(?:\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><])/g;
