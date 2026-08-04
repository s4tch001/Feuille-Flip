export {};

declare global {
  interface Window {
    jQuery: JQueryStatic;
    $: JQueryStatic;
  }

  interface JQuery {
    turn(options: Record<string, unknown>): JQuery;
    turn(command: string, ...args: unknown[]): unknown;
  }
}

