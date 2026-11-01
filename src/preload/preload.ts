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

  createWriter: (name, kind) => ipcRenderer.invoke("writer:create", name, kind),
  write: (id, position, data) => ipcRenderer.invoke("writer:write", id, position, data),
  closeWriter: (id, abort = false) => ipcRenderer.invoke("writer:close", id, abort),
  revealInFolder: path => ipcRenderer.invoke("shell:reveal", path),

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
  },

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
    onState: handler => {
      const listener = (_e: unknown, s: Parameters<typeof handler>[0]) => handler(s);
      ipcRenderer.on("updates:state", listener);
      return () => ipcRenderer.off("updates:state", listener);
    },
  },

  history: {
    list: path => ipcRenderer.invoke("history:list", path),
    restore: (path, file) => ipcRenderer.invoke("history:restore", path, file),
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
