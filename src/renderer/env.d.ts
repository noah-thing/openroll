import type { OpenRollApi } from "../shared/api";

declare global {
  interface Window {
    openroll: OpenRollApi;
  }
}
