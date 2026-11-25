import fs from "node:fs";
import path from "node:path";

import { isStoreFileName } from "./store.ts";
import { errorMessage } from "./validate.ts";

// Each backup is a new folder with this name plus the time, inside the destination.
const BACKUP_PREFIX = "claude-cost-backup-";

// `target` with symlinks resolved as far as it exists, so a missing tail still compares.
function realPath(target: string): string {
  try {
    return fs.realpathSync.native(target);
  } catch {
    const parent = path.dirname(target);
    return parent === target ? target : path.join(realPath(parent), path.basename(target));
  }
}

// True when `child` is `parent` or sits anywhere below it.
function isInside(child: string, parent: string) {
  const rel = path.relative(realPath(parent), realPath(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

// Names of the store files in `storeDir`, including copies set aside as corrupt.
function storeFiles(storeDir: string) {
  try {
    return fs
      .readdirSync(storeDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && isStoreFileName(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/**
 * Copy every file in the usage store folder into a new folder under `destDir`.
 * Each backup gets its own folder named after the time and nothing already
 * there is touched. A run that finds a store rebuilt from fewer transcripts
 * than the one it replaced cannot overwrite the good copy.
 *
 * The copy is made in a `.partial` folder and renamed when complete, so a
 * folder with the final name always holds the whole store.
 */
export function backupStore(storeDir: string, destDir: string, now = new Date()) {
  if (isInside(destDir, storeDir)) {
    throw new Error(
      `the backup folder ${destDir} is inside the usage store folder ${storeDir}. Pick a folder outside it, because deleting the store would delete the backup too.`,
    );
  }

  let names;

  try {
    names = storeFiles(storeDir);
  } catch (error) {
    throw new Error(`cannot read the usage store folder ${storeDir}: ${errorMessage(error)}`);
  }

  if (names.length === 0) {
    throw new Error(`no usage store to back up in ${storeDir}. Run claude-cost once to create it.`);
  }

  const dir = path.join(destDir, `${BACKUP_PREFIX}${now.toISOString().replace(/[:.]/g, "-")}`);
  const partial = `${dir}.partial`;

  if (fs.existsSync(dir)) throw new Error(`${dir} already exists. Nothing was copied.`);

  try {
    fs.mkdirSync(partial, { recursive: true });

    for (const name of names) {
      fs.copyFileSync(path.join(storeDir, name), path.join(partial, name), fs.constants.COPYFILE_EXCL);
    }

    fs.renameSync(partial, dir);
  } catch (error) {
    fs.rmSync(partial, { recursive: true, force: true });
    throw new Error(`cannot back up the usage store to ${dir}: ${errorMessage(error)}`);
  }

  return { dir, files: names };
}
