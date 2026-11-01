import { app, type WebContents } from "electron";
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";
import { LONG_METHODS, METHODS, type AgentClient, type Hello, type Method, type Reply, type Request } from "../shared/agent-protocol";

/** Where the app listens: a socket file in the profile, or a named pipe on Windows. */
export function controlAddress(userData = app.getPath("userData")): string {
  if (process.platform === "win32") return `\\\\.\\pipe\\openroll-${createHash("sha1").update(userData).digest("hex").slice(0, 12)}`;
  return join(userData, "control.sock");
}

export function tokenFile(userData = app.getPath("userData")): string {
  return join(userData, "control-token");
}

interface Pending {
  resolve(reply: Reply): void;
  timer?: NodeJS.Timeout;
}

/**
 * Lets AI tools drive the open editor. Only processes running as this user can reach the
 * socket, and each must present the token stored next to it. The page does the actual work;
 * this only routes calls and keeps track of who is connected.
 */
export class Control {
  private server: Server | null = null;
  private token = "";
  private clients = new Map<number, { socket: Socket; info: AgentClient }>();
  private pending = new Map<number, Pending>();
  private nextClient = 1;
  private nextCall = 1;

  constructor(
    private page: () => WebContents | null,
    private enabled: () => boolean,
    private onClients: (clients: AgentClient[]) => void,
  ) {}

  async start(): Promise<void> {
    this.token = await this.loadToken();
    const address = controlAddress();
    if (process.platform !== "win32" && existsSync(address)) await rm(address, { force: true });
    this.server = createServer(socket => this.accept(socket));
    this.server.on("error", err => console.warn("control socket", err.message));
    await new Promise<void>(resolve => this.server!.listen(address, resolve));
    if (process.platform !== "win32") await chmod(address, 0o600).catch(() => {});
  }

  private async loadToken(): Promise<string> {
    const file = tokenFile();
    const existing = await readFile(file, "utf8").catch(() => "");
    if (/^[0-9a-f]{64}$/.test(existing.trim())) return existing.trim();
    const token = randomBytes(32).toString("hex");
    await writeFile(file, token, { mode: 0o600 });
    return token;
  }

  list(): AgentClient[] {
    return [...this.clients.values()].map(c => c.info);
  }

  disconnect(id: number): void {
    this.clients.get(id)?.socket.destroy();
  }

  private accept(socket: Socket): void {
    let buffer = "";
    let clientId = 0;
    socket.setEncoding("utf8");
    const send = (obj: unknown) => socket.write(JSON.stringify(obj) + "\n");

    socket.on("data", chunk => {
      buffer += chunk;
      if (buffer.length > 8 * 1024 * 1024) return socket.destroy();
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        let msg: unknown;
        try {
          msg = JSON.parse(line);
        } catch {
          return socket.destroy();
        }
        if (!clientId) {
          const hello = (msg as Hello).hello;
          if (!hello || hello.token !== this.token) {
            send({ error: { message: "OpenRoll refused the connection: wrong token." } });
            return socket.end();
          }
          if (!this.enabled()) {
            send({ error: { message: "AI control is turned off in OpenRoll settings." } });
            return socket.end();
          }
          clientId = this.nextClient++;
          const name = String(hello.client?.name || "An AI tool").slice(0, 60);
          this.clients.set(clientId, { socket, info: { id: clientId, name, since: Date.now() } });
          this.onClients(this.list());
          send({ ok: true, version: app.getVersion() });
          continue;
        }
        void this.handle(msg as Request, clientId).then(send);
      }
    });
    const gone = () => {
      if (clientId && this.clients.delete(clientId)) this.onClients(this.list());
    };
    socket.on("close", gone);
    socket.on("error", gone);
  }

  private async handle(req: Request, clientId: number): Promise<Reply> {
    if (typeof req?.id !== "number" || !METHODS.includes(req.method as Method)) return { id: req?.id ?? 0, error: { message: `Unknown method ${req?.method}` } };
    const page = this.page();
    if (!page || page.isDestroyed()) return { id: req.id, error: { message: "OpenRoll has no window open." } };
    const callId = this.nextCall++;
    const client = this.clients.get(clientId)?.info.name ?? "AI";
    return new Promise<Reply>(resolve => {
      const pending: Pending = { resolve: r => resolve({ ...r, id: req.id }) };
      if (!LONG_METHODS.includes(req.method as Method)) {
        pending.timer = setTimeout(() => this.settle(callId, { id: req.id, error: { message: "OpenRoll did not answer in time." } }), 120_000);
      }
      this.pending.set(callId, pending);
      page.send("agent:call", { callId, method: req.method, params: req.params ?? {}, client });
    });
  }

  /** The page's answer to a call. */
  settle(callId: number, reply: Reply): void {
    const p = this.pending.get(callId);
    if (!p) return;
    this.pending.delete(callId);
    if (p.timer) clearTimeout(p.timer);
    p.resolve(reply);
  }

  async stop(): Promise<void> {
    for (const c of this.clients.values()) c.socket.destroy();
    this.server?.close();
    if (process.platform !== "win32") await rm(controlAddress(), { force: true }).catch(() => {});
  }
}
