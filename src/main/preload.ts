import { contextBridge, ipcRenderer } from "electron";
import type { OrbitAPI } from "../domain/model";
const api: OrbitAPI = {
  call: (op, data) => ipcRenderer.invoke("orbit:call", { op, data }),
  onChange: (fn) => {
    const listener = () => fn();
    ipcRenderer.on("orbit:changed", listener);
    return () => ipcRenderer.removeListener("orbit:changed", listener);
  },
  onTransfer: (fn) => {
    const listener = (
      _e: unknown,
      progress: Parameters<Parameters<OrbitAPI["onTransfer"]>[0]>[0],
    ) => fn(progress);
    ipcRenderer.on("orbit:transfer", listener);
    return () => ipcRenderer.removeListener("orbit:transfer", listener);
  },
  onNavigate: (fn) => {
    const listener = (_e: unknown, id: string) => fn(id);
    ipcRenderer.on("orbit:navigate", listener);
    return () => ipcRenderer.removeListener("orbit:navigate", listener);
  },
  window: (action) => ipcRenderer.send("orbit:window", action),
  onUpdate: (fn) => {
    const listener = (_e: unknown, state: Parameters<typeof fn>[0]) =>
      fn(state);
    ipcRenderer.on("orbit:update", listener);
    return () => ipcRenderer.removeListener("orbit:update", listener);
  },
};
contextBridge.exposeInMainWorld("orbit", api);
