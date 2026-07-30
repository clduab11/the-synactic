import type { ToolCallRecord } from "@the-synactic/contracts";

export interface TransportSink {
  emit(record: ToolCallRecord): void;
  drain(): readonly ToolCallRecord[];
  clear(): void;
}

export class InMemoryTransportSink implements TransportSink {
  private readonly records: ToolCallRecord[] = [];

  emit(record: ToolCallRecord): void {
    this.records.push(record);
  }

  drain(): readonly ToolCallRecord[] {
    return this.records.slice();
  }

  clear(): void {
    this.records.length = 0;
  }
}

export class NoOpTransportSink implements TransportSink {
  emit(): void {
    // intentional no-op for tests that don't need record capture
  }
  drain(): readonly ToolCallRecord[] {
    return [];
  }
  clear(): void {
    // no-op
  }
}
