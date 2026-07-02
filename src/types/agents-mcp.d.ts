declare module 'agents/mcp' {
  import { Agent } from 'agents';
  import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
  import type { EventStore } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

  export class DurableObjectEventStore implements EventStore {
    constructor(storage: DurableObjectStorage);
    storeEvent(streamId: string, message: unknown): Promise<string>;
    getStreamIdForEventId(eventId: string): Promise<string | undefined>;
    replayEventsAfter(
      lastEventId: string,
      options: {
        send: (eventId: string, message: unknown) => Promise<void>;
      },
    ): Promise<string>;
    clearStream(streamId: string): Promise<void>;
  }

  export abstract class McpAgent<
    Env = unknown,
    State = unknown,
    Props extends Record<string, unknown> = Record<string, unknown>
  > extends Agent<Env, State, Props> {
    props?: Props;
    abstract server: McpServer;
    abstract init(): Promise<void>;
    protected getEventStore(): EventStore | undefined;

    static serve(
      path: string,
      options?: Record<string, unknown>,
    ): {
      fetch(request: Request, env: unknown, ctx: unknown): Promise<Response>;
    };
  }
}
