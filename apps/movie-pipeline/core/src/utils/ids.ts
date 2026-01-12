const SAFE_ID = /^[a-zA-Z0-9._-]+$/;

export function isSafeId(id: string) {
  return SAFE_ID.test(id);
}

export function requireSafeId(id: string, label: string) {
  if (!id || !isSafeId(id)) {
    throw new Error(`${label} contains invalid characters`);
  }
  return id;
}
