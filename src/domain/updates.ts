export type UpdateState = {
  status:
    | "idle"
    | "checking"
    | "available"
    | "downloading"
    | "downloaded"
    | "installing"
    | "error"
    | "unavailable"
    | "unsupported";
  currentVersion: string;
  version?: string;
  percent?: number;
  checkedAt?: string;
  message: string;
  retry?: "check" | "download";
};
