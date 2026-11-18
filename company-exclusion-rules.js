(function (root, factory) {
  const rules = factory();
  if (typeof module === 'object' && module.exports) module.exports = rules;
  else root.CompanyExclusionRules = rules;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const normalize = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  function aliasesForGroup(group, data = {}) {
    const name = typeof group === 'string' ? group : group?.name || group?.groupName || '';
    const names = new Set([name]);
    const keys = new Set([normalize(name)]);
    const matching = typeof group === 'object' ? group : (data.groups || []).find(item => normalize(item.name) === normalize(name));
    for (const job of matching?.jobs || []) if (job.company) { names.add(job.company); keys.add(normalize(job.company)); }
    // Alias values point to the trusted canonical company. Follow exact links only.
    let changed;
    do {
      changed = false;
      for (const [alias, target] of Object.entries(data.companyAliases || {})) {
        if (keys.has(normalize(alias)) && !keys.has(normalize(target))) {
          names.add(target); keys.add(normalize(target)); changed = true;
        }
        if (keys.has(normalize(target)) && !keys.has(normalize(alias))) {
          names.add(alias); keys.add(normalize(alias)); changed = true;
        } else if (keys.has(normalize(target))) names.add(alias);
      }
    } while (changed);
    return [...names].filter(value => normalize(value));
  }
  function isExcluded(groupOrName, items = [], data = {}) {
    const keys = new Set(aliasesForGroup(groupOrName, data).map(normalize));
    return items.some(item => [item.groupKey, item.groupName, ...(item.aliases || [])].some(name => keys.has(normalize(name))));
  }
  // The published dataset is immutable within a Worker instance. Cache only its
  // alias graph, never the mutable D1 exclusion list. Do not mutate groups or
  // companyAliases in place; a frontend refetch supplies a new dataset object.
  const indexes = new WeakMap();
  function indexFor(data) {
    if (indexes.has(data)) return indexes.get(data);
    const normalized = new Map(), graph = new Map(), groups = new Map(), groupSeeds = new WeakMap();
    const keyOf = value => {
      const text = String(value || '');
      if (!normalized.has(text)) normalized.set(text, normalize(text));
      return normalized.get(text);
    };
    const edge = (from, to) => {
      if (!graph.has(from)) graph.set(from, new Set());
      graph.get(from).add(to);
    };
    for (const [alias, target] of Object.entries(data.companyAliases || {})) {
      const a = keyOf(alias), b = keyOf(target);
      edge(a, b); edge(b, a);
    }
    const seedsFor = group => [keyOf(group.name || group.groupName || ''), ...(group.jobs || []).filter(job => job.company).map(job => keyOf(job.company))];
    for (const group of data.groups || []) {
      const key = keyOf(group.name);
      if (!groups.has(key)) groups.set(key, group);
      groupSeeds.set(group, seedsFor(group));
    }
    const index = { keyOf, graph, seeds(value) {
      const name = typeof value === 'string' ? value : value?.name || value?.groupName || '';
      const key = keyOf(name), matching = typeof value === 'object' ? value : groups.get(key);
      return matching ? groupSeeds.get(matching) || seedsFor(matching) : [key];
    } };
    indexes.set(data, index);
    return index;
  }
  function createMatcher(items = [], data = {}) {
    if (!items.length) return () => false;
    const index = indexFor(data), blocked = new Set(), pending = [];
    for (const item of items) for (const name of [item.groupKey, item.groupName, ...(item.aliases || [])]) {
      const key = index.keyOf(name);
      if (key && !blocked.has(key)) { blocked.add(key); pending.push(key); }
    }
    for (let cursor = 0; cursor < pending.length; cursor++) {
      for (const key of index.graph.get(pending[cursor]) || []) {
        if (!blocked.has(key)) { blocked.add(key); pending.push(key); }
      }
    }
    return value => index.seeds(value).some(key => blocked.has(key));
  }
  return { normalize, aliasesForGroup, isExcluded, createMatcher };
});
