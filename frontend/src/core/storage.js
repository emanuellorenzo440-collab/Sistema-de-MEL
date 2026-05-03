export function loadStoredState(storageKey, fallbackState, normalizeState) {
  try {
    const saved = localStorage.getItem(storageKey);
    return saved ? normalizeState(JSON.parse(saved)) : structuredClone(fallbackState);
  } catch {
    return structuredClone(fallbackState);
  }
}

export function saveStoredState(storageKey, state) {
  localStorage.setItem(storageKey, JSON.stringify(state));
}
