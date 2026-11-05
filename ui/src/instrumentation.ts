/**
 * Next's server start hook. The Node-only work lives in its own module,
 * imported behind the runtime check so the edge bundle never sees it.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
