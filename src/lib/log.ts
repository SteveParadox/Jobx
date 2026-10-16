export function log(event: string, fields: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ time: new Date().toISOString(), event, ...fields }));
}
