declare module "@mariozechner/pi-coding-agent" {
  export interface ExtensionAPI {
    registerCommand(name: string, command: any): void;
    registerTool(tool: any): void;
    registerShortcut(name: string, shortcut: any): void;
    on(event: string, handler: (...args: any[]) => any): void;
    appendEntry(type: string, data: any): void;
    setSessionName(name: string): void;
    setLabel(id: string, label: string): void;
    sendUserMessage(message: string, options?: any): Promise<any>;
  }
  export interface ExtensionContext {
    hasUI?: boolean;
    ui: any;
    sessionManager: any;
    getContextUsage?: () => any;
    fork?: (...args: any[]) => Promise<any>;
  }
  export interface ExtensionCommandContext extends ExtensionContext {}
}

declare module "@mariozechner/pi-tui" {
  export class Box { constructor(...args: any[]); addChild(child: any): void; clear(): void; invalidate(): void; render(width: number): string[]; }
  export class Text { constructor(...args: any[]); setText(text: string): void; }
  export class Spacer { constructor(...args: any[]); }
  export class SelectList { constructor(...args: any[]); onSelectionChange?: any; onCancel?: any; onSelect?: any; handleInput?(input: any): boolean; invalidate?(): void; }
  export interface SelectItem { value: string; label: string; description?: string; }
  export interface Component { render(width: number): string[]; invalidate?(): void; handleInput?(input: any): boolean; }
  export interface TUI { hideOverlay(): void; requestRender(): void; }
}
