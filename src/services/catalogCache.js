// One catalog per process. Share concurrent loads and refresh stale data in the background.
module.exports = function createCatalogCache({ now = Date.now, freshMs = 60000, maxAgeMs = 300000 } = {}) {
  let entry;
  return function load(key, fetchCatalog, force = false) {
    if (!entry || entry.key !== key) entry = { key, value: null, updated: 0, pending: null };
    const current = entry;
    const refresh = () => {
      if (!current.pending) {
        current.pending = Promise.resolve().then(fetchCatalog).then(value => {
          current.value = value;
          current.updated = now();
          return value;
        }).finally(() => { current.pending = null; });
      }
      return current.pending;
    };
    const age = now() - current.updated;
    if (!force && current.value !== null && age < maxAgeMs) {
      if (age >= freshMs) refresh().catch(() => { /* Retry on the next request; retain last complete catalog. */ });
      return Promise.resolve(current.value);
    }
    return refresh();
  };
};
