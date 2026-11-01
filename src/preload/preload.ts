import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { OpenRollApi } from "../shared/api";
import { mediaUrlFor } from "../shared/media-url";

const api: OpenRollApi = {
  platform: process.platform,
  versions: {
    app: process.argv.find(a => a.startsWith("--openroll-version="))?.slice(19) ?? "dev",
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  },

  pickMedia: () => ipcRenderer.invoke("media:pick"),
  pathsForDropped: files => ipcRenderer.invoke("media:allow-dropped", files.map(f => webUtils.getPathForFile(f)).filter(Boolean)),
  mediaUrl: path => mediaUrlFor(path, process.platform),
  stat: path => ipcRenderer.invoke("media:stat", path),
  pickLut: () => ipcRenderer.invoke("lut:pick"),

  createWriter: (name, kind) => ipcRenderer.invoke("writer:create", name, kind),
  write: (id, position, data) => ipcRenderer.invoke("writer:write", id, position, data),
  resetWriter: id => ipcRenderer.invoke("writer:reset", id),
  closeWriter: (id, abort = false) => ipcRenderer.invoke("writer:close", id, abort),
  revealInFolder: path => ipcRenderer.invoke("shell:reveal", path),

  convert: {
    status: () => ipcRenderer.invoke("ff:status"),
    inspect: path => ipcRenderer.invoke("ff:inspect", path),
    prepare: (path, hints) => ipcRenderer.invoke("ff:prepare", path, hints),
    proxy: (path, req) => ipcRenderer.invoke("ff:proxy", path, req),
    existing: paths => ipcRenderer.invoke("ff:existing", paths),
    cancel: (path, kind) => ipcRenderer.send("ff:cancel", path, kind),
    setPlayback: active => ipcRenderer.send("ff:playback", active),
    onState: handler => {
      const listener = (_e: unknown, path: string, state: Parameters<typeof handler>[1]) => handler(path, state);
      ipcRenderer.on("ff:state", listener);
      return () => ipcRenderer.off("ff:state", listener);
    },
  },

  ffexport: {
    open: () => ipcRenderer.invoke("ffexport:open"),
    audio: (id, data) => ipcRenderer.invoke("ffexport:audio", id, data),
    begin: (id, writerId, spec) => ipcRenderer.invoke("ffexport:begin", id, writerId, spec),
    frame: (id, data) => ipcRenderer.invoke("ffexport:frame", id, data),
    finish: (id, spec) => ipcRenderer.invoke("ffexport:finish", id, spec),
    cancel: id => ipcRenderer.invoke("ffexport:cancel", id),
  },

  relink: {
    missing: paths => ipcRenderer.invoke("relink:missing", paths),
    auto: missing => ipcRenderer.invoke("relink:auto", missing),
    folder: missing => ipcRenderer.invoke("relink:folder", missing),
    file: (missing, id) => ipcRenderer.invoke("relink:file", missing, id),
  },

  projects: {
    dir: () => ipcRenderer.invoke("projects:dir"),
    list: () => ipcRenderer.invoke("projects:list"),
    load: path => ipcRenderer.invoke("projects:load", path),
    save: (path, name, json) => ipcRenderer.invoke("projects:save", path, name, json),
    saveThumb: (path, jpeg) => ipcRenderer.invoke("projects:thumb", path, jpeg),
    remove: path => ipcRenderer.invoke("projects:remove", path),
  },

  cache: {
    get: key => ipcRenderer.invoke("cache:get", key),
    put: (key, data) => ipcRenderer.invoke("cache:put", key, data),
    file: key => ipcRenderer.invoke("cache:file", key),
  },
  saveRecording: (name, ext, data) => ipcRenderer.invoke("recordings:save", name, ext, data),

  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    set: patch => ipcRenderer.invoke("settings:set", patch),
    pickProjectsDir: () => ipcRenderer.invoke("settings:pick-projects-dir"),
    onChange: handler => {
      const listener = (_e: unknown, s: Parameters<typeof handler>[0]) => handler(s);
      ipcRenderer.on("settings:changed", listener);
      return () => ipcRenderer.off("settings:changed", listener);
    },
  },
  cacheInfo: () => ipcRenderer.invoke("cache:info"),
  clearCache: () => ipcRenderer.invoke("cache:clear"),

  updates: {
    state: () => ipcRenderer.invoke("updates:state"),
    check: () => ipcRenderer.invoke("updates:check"),
    installNow: () => ipcRenderer.invoke("updates:install-now"),
    download: () => ipcRenderer.invoke("updates:download"),
    whatsNew: () => ipcRenderer.invoke("updates:whats-new"),
    onState: handler => {
      const listener = (_e: unknown, s: Parameters<typeof handler>[0]) => handler(s);
      ipcRenderer.on("updates:state", listener);
      return () => ipcRenderer.off("updates:state", listener);
    },
  },

  agent: {
    onCall: handler => {
      const listener = (_e: unknown, call: Parameters<typeof handler>[0]) => handler(call);
      ipcRenderer.on("agent:call", listener);
      return () => ipcRenderer.off("agent:call", listener);
    },
    reply: (callId, reply) => ipcRenderer.send("agent:reply", callId, reply),
    clients: () => ipcRenderer.invoke("agent:clients"),
    onClients: handler => {
      const listener = (_e: unknown, c: Parameters<typeof handler>[0]) => handler(c);
      ipcRenderer.on("agent:clients", listener);
      return () => ipcRenderer.off("agent:clients", listener);
    },
    disconnect: id => ipcRenderer.invoke("agent:disconnect", id),
    connectInfo: () => ipcRenderer.invoke("agent:connect-info"),
    allow: paths => ipcRenderer.invoke("agent:allow", paths),
    writerAt: (path, name) => ipcRenderer.invoke("writer:create-at", path, name),
  },

  news: {
    list: () => ipcRenderer.invoke("news:list"),
    markRead: ids => ipcRenderer.invoke("news:mark-read", ids),
    onChange: handler => {
      const listener = (_e: unknown, items: Parameters<typeof handler>[0]) => handler(items);
      ipcRenderer.on("news:changed", listener);
      return () => ipcRenderer.off("news:changed", listener);
    },
  },

  history: {
    list: path => ipcRenderer.invoke("history:list", path),
    restore: (path, file) => ipcRenderer.invoke("history:restore", path, file),
  },
  snapshots: {
    save: (name, json) => ipcRenderer.invoke("versions:save", name, json),
    list: id => ipcRenderer.invoke("versions:list", id),
    read: (id, file) => ipcRenderer.invoke("versions:read", id, file),
    remove: (id, file) => ipcRenderer.invoke("versions:remove", id, file),
  },
  session: {
    take: () => ipcRenderer.invoke("session:take"),
    projectClosed: () => ipcRenderer.send("session:project-closed"),
  },

  systemInfo: () => ipcRenderer.invoke("system:info"),

  onMenu: handler => {
    const listener = (_e: unknown, cmd: string) => handler(cmd);
    ipcRenderer.on("menu", listener);
    return () => ipcRenderer.off("menu", listener);
  },
  setTitle: title => ipcRenderer.send("window:title", title),
  setDirty: dirty => ipcRenderer.send("window:dirty", dirty),
  qa: process.env.OPENROLL_QA ? { allow: paths => ipcRenderer.invoke("qa:allow", paths) } : undefined,
};

contextBridge.exposeInMainWorld("openroll", api);
