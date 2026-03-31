/** Injectable notification interface — decouples core from UI toast libraries (e.g. sonner). */
export interface NotifyFn {
  error: (msg: string) => void;
  success: (msg: string) => void;
  warning: (msg: string) => void;
  info: (msg: string) => void;
}

const defaultNotify: NotifyFn = {
  error: console.error,
  success: console.log,
  warning: console.warn,
  info: console.log,
};

let _notify: NotifyFn = defaultNotify;

export function setNotify(notify: NotifyFn): void {
  _notify = notify;
}

export function getNotify(): NotifyFn {
  return _notify;
}
