import type { ToolClassification } from "@the-synactic/contracts";

export interface ToolDescriptor {
  readonly name: string;
  readonly classification: ToolClassification;
  readonly sideEffects: readonly string[];
  readonly schemaRef: string;
  execute(args: Record<string, unknown>): Record<string, unknown> | undefined;
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDescriptor>();

  register(tool: ToolDescriptor): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDescriptor | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): readonly ToolDescriptor[] {
    return Array.from(this.tools.values());
  }
}
