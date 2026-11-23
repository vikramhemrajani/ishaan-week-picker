/**
 * Pure helpers for the family plan store.
 * No secrets, no network. The page and the node tests both use this file.
 */

export function choiceSignature(list) {
  const rows = [];
  (list || []).forEach((row) => {
    if (!row || !row.id) return;
    const kind = row.kind || "free";
    rows.push([
      String(row.id),
      kind,
      kind === "ib" ? String(row.subject || "") : "",
      (kind === "ib" || kind === "sat") ? String(row.topic || "") : "",
      kind === "sat" ? String(row.area || "") : ""
    ].join("\u001f"));
  });
  rows.sort();
  return rows.join("\u001e");
}

export function plansEquivalent(a, b) {
  return choiceSignature(a) === choiceSignature(b);
}

function takeStore(store, reason) {
  return {
    source: "store",
    plan: store.document,
    reason,
    remoteNewer: false,
    shouldUpload: false,
    revision: store.revision != null ? store.revision : null,
    updatedAt: store.updatedAt || null,
    adopt: false
  };
}

function takeFile(file, reason) {
  return {
    source: "file",
    plan: file,
    reason,
    remoteNewer: false,
    shouldUpload: false,
    revision: null,
    updatedAt: file.updatedAt || null,
    adopt: false
  };
}

function localKeep(reason, extra) {
  return {
    source: "local",
    plan: null,
    reason,
    remoteNewer: false,
    shouldUpload: false,
    revision: extra && extra.revision != null ? extra.revision : null,
    updatedAt: extra && extra.updatedAt || null,
    adopt: !!(extra && extra.adopt)
  };
}

/**
 * Decide which copy of a week a browser should show.
 *
 * The central store wins over the static choices/*.json seed.
 * A private edit on this device (dirty, or localStorage that does not match
 * the seed and has never been saved) is kept, and is uploaded only when the
 * store does not already have a different plan.
 */
export function chooseSharedSource(input) {
  const src = input || {};
  const local = src.local || {
    present: false,
    blank: true,
    dirty: false,
    hasMeta: false,
    matchesFile: false,
    matchesStore: false,
    updatedAt: null,
    revision: null
  };
  const store = src.store || null;
  const file = src.file || null;

  if (src.force) {
    if (store && store.document) return takeStore(store, "force");
    if (file) return takeFile(file, "force");
    return localKeep("force-empty");
  }

  // A cleared week is blank but dirty until it is saved. Do not refill it from
  // the previous family plan on the next load.
  if ((!local.present || local.blank) && !local.dirty) {
    if (store && store.document) return takeStore(store, local.blank && local.present ? "blank-local" : "no-local");
    if (file) return takeFile(file, local.blank && local.present ? "blank-local" : "no-local");
    return localKeep("empty");
  }

  if (store && store.document && local.matchesStore && !local.dirty) {
    const revisionDiffers = local.revision !== store.revision;
    return localKeep("matches-store", {
      revision: store.revision,
      updatedAt: store.updatedAt,
      adopt: !local.hasMeta || revisionDiffers
    });
  }

  const privateEdit = !!(local.dirty || (!local.hasMeta && !local.matchesFile && !local.matchesStore));
  const storeExists = !!(store && store.document);
  // "Remote newer" means another device saved a plan this device has not
  // adopted. An edit on top of the revision we already have is not a conflict.
  const remoteNewer = storeExists && !local.matchesStore && (
    (local.hasMeta && local.revision !== store.revision) || !local.hasMeta
  );

  if (privateEdit) {
    return {
      source: "local",
      plan: null,
      reason: local.dirty ? "dirty-local" : "unpublished-local",
      remoteNewer,
      shouldUpload: !storeExists,
      revision: local.revision != null ? local.revision : null,
      updatedAt: local.updatedAt || null,
      adopt: false
    };
  }

  if (store && store.document && !local.matchesStore) return takeStore(store, "remote-newer");
  if (store && store.document && local.revision !== store.revision) return takeStore(store, "remote-revision");
  if (!store && file && !local.matchesFile) return takeFile(file, "file-fallback");
  return localKeep("local-current");
}
