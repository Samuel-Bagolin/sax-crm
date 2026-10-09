/** Read only: React may invoke state initializers more than once. */
export function readActivationToken(hash: string): string {
  return new URLSearchParams(hash.replace(/^#/, "")).get("token") || "";
}
