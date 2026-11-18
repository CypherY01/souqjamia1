// OPS05: refuse to start when the configuration is missing or invalid.
// Next.js calls register() once when the server process starts.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { loadServerEnv } = await import("./lib/env");
  try {
    loadServerEnv();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Invalid environment configuration.");
    process.exit(1);
  }
}
