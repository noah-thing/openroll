import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { OpenRollApi } from "../shared/api";
import { mediaUrlFor } from "../shared/media-url";

const api: OpenRollApi = {
  platform: process.platform,
  versions: {
    app: process.env.OPENROLL_VERSION ?? "dev",
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
    file: key => ipcRenderer.invoke("cache:file", key),
  },
  saveRecording: (name, ext, data) => ipcRenderer.invoke("recordings:save", name, ext, data),

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
