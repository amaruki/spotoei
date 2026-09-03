// Command Palette: a fuzzy-filterable action menu for global shortcuts.

export interface Command {
  id: string;
  label: string;
  shortcut?: string;
  action: () => void | Promise<void>;
  keywords?: string[];
}

export class CommandPalette {
  private commands: Command[] = [];
  private selected = 0;
  private filter = '';
  private active = false;

  register(cmd: Command): void {
    this.commands.push(cmd);
  }

  get isActive(): boolean {
    return this.active;
  }

  open(): void {
    this.active = true;
    this.filter = '';
    this.selected = 0;
  }

  close(): void {
    this.active = false;
    this.filter = '';
    this.selected = 0;
  }

  setFilter(text: string): void {
    this.filter = text;
    this.selected = 0;
  }

  getFilter(): string {
    return this.filter;
  }

  next(): void {
    const matches = this.matches();
    if (matches.length === 0) return;
    this.selected = (this.selected + 1) % matches.length;
  }

  prev(): void {
    const matches = this.matches();
    if (matches.length === 0) return;
    this.selected = (this.selected - 1 + matches.length) % matches.length;
  }

  getSelectedIndex(): number {
    return this.selected;
  }

  execute(): Command | null {
    const matches = this.matches();
    if (matches.length === 0) return null;
    const cmd = matches[this.selected];
    this.active = false;
    this.filter = '';
    this.selected = 0;
    return cmd ?? null;
  }

  matches(): Command[] {
    const needle = this.filter.toLowerCase();
    if (!needle) return this.commands;
    return this.commands.filter((c) => {
      if (c.label.toLowerCase().includes(needle)) return true;
      if (c.id.toLowerCase().includes(needle)) return true;
      if (c.keywords?.some((k) => k.toLowerCase().includes(needle))) return true;
      return false;
    });
  }

  size(): number {
    return this.commands.length;
  }
}
