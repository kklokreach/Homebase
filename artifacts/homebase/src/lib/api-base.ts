export function getApiOrigin(): string {
  return new URL(
    import.meta.env.VITE_API_BASE_URL ?? window.location.origin,
    window.location.origin,
  ).origin;
}

export function apiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${getApiOrigin()}${normalizedPath}`;
}

export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("accept")) headers.set("accept", "application/json");
  if (init.body != null && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  return fetch(apiUrl(path), {
    ...init,
    credentials: init.credentials ?? "include",
    headers,
  });
}
