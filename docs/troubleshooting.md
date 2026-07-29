# Troubleshooting

## The app cannot read the API key after an OS upgrade

Astryn stores credentials in the OS keychain under the service
`com.orion.astryn`. A major OS upgrade can invalidate the signature the
keychain ACL was granted to, which surfaces as a "keychain unavailable"
toast on startup even though the entry still exists.

Re-saving the key from **Settings** rewrites the entry with the current
signature and clears the error.

## `SQLITE_CANTOPEN` when launching from Finder

The database lives in the app data directory:

```
~/Library/Application Support/com.orion.astryn/astryn.db
```

If you see `SQLITE_CANTOPEN`, the parent directory is missing or not
writable. Astryn creates it on startup, so this usually means the app was
launched with a different `HOME` than the one that owns the directory.

The database is a re-syncable cache and holds no secrets, so deleting it is
safe — the next launch recreates it and re-syncs.

## Sync finishes but the issue list looks empty

Check the active filters first. View configuration is persisted per
workspace, and a filter pinned to a team or assignee that no longer exists
will hide everything. Clearing filters from the toolbar rebuilds the view.

## Linux: no Secret Service daemon

The keyring backend needs a running Secret Service provider. On a minimal
desktop install:

```bash
sudo apt install gnome-keyring
```

Without it, key storage fails at save time and the error names the missing
backend.
