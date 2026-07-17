import { randomBytes } from 'node:crypto';
import { chmod, lstat, mkdir, open, readFile, realpath, rename, stat, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

export class SecureConfigError extends Error {
  readonly code: 'insecure_config_path' | 'insecure_config_owner' | 'insecure_config_symlink' | 'invalid_config';

  constructor(
    code: SecureConfigError['code'],
    message: string,
  ) {
    super(message);
    this.code = code;
  }
}

export interface SecureJsonOptions {
  rejectProjectPath?: boolean;
}

/** 原子写入仅含本地可信状态的 JSON，目录 0700、文件 0600。 */
export async function writeSecureJson(
  filePath: string,
  value: unknown,
  options: SecureJsonOptions = {},
): Promise<void> {
  const resolved = await prepareSecurePath(filePath, options);
  await assertSecureRegularFile(resolved, true);
  const temporaryPath = path.join(
    path.dirname(resolved),
    `.${path.basename(resolved)}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`,
  );
  let temporaryCreated = false;
  try {
    const handle = await open(temporaryPath, 'wx', 0o600);
    temporaryCreated = true;
    try {
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporaryPath, resolved);
    temporaryCreated = false;
    await chmod(resolved, 0o600);
    await syncDirectory(path.dirname(resolved));
  } finally {
    if (temporaryCreated) await unlink(temporaryPath).catch(() => undefined);
  }
}

export async function readSecureJson<T>(
  filePath: string,
  options: SecureJsonOptions = {},
): Promise<T | null> {
  const resolved = path.resolve(filePath);
  await assertNotInProject(resolved, options);
  const existing = await assertSecureRegularFile(resolved, false);
  if (!existing) return null;
  try {
    return JSON.parse(await readFile(resolved, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new SecureConfigError('invalid_config', `Cannot parse secure JSON file ${resolved}.`);
  }
}

export async function ensureSecureDirectory(
  directoryPath: string,
  options: SecureJsonOptions = {},
): Promise<string> {
  const resolved = path.resolve(directoryPath);
  await assertNotInProject(resolved, options);
  await assertExistingPathIsNotSymlink(resolved);
  await mkdir(resolved, { recursive: true, mode: 0o700 });
  const info = await lstat(resolved);
  if (info.isSymbolicLink()) {
    throw new SecureConfigError('insecure_config_symlink', `Refusing symbolic-link config directory: ${resolved}`);
  }
  if (!info.isDirectory()) {
    throw new SecureConfigError('insecure_config_path', `Config directory path is not a directory: ${resolved}`);
  }
  assertOwner(info.uid, resolved);
  await chmod(resolved, 0o700);
  return resolved;
}

export function defaultCliConfigPath(): string {
  return process.env.WOA_CLI_CONFIG || path.join(homedir(), '.config', 'woa', 'cli.json');
}

export function defaultInitDirectory(configPath = defaultCliConfigPath()): string {
  return process.env.WOA_INIT_DIR || path.join(path.dirname(configPath), 'init-runs');
}

async function prepareSecurePath(filePath: string, options: SecureJsonOptions): Promise<string> {
  const resolved = path.resolve(filePath);
  await assertNotInProject(resolved, options);
  await ensureSecureDirectory(path.dirname(resolved), options);
  return resolved;
}

async function assertSecureRegularFile(filePath: string, allowMissing: boolean): Promise<boolean> {
  let info;
  try {
    info = await lstat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && allowMissing) return false;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
  if (info.isSymbolicLink()) {
    throw new SecureConfigError('insecure_config_symlink', `Refusing symbolic-link config file: ${filePath}`);
  }
  if (!info.isFile()) {
    throw new SecureConfigError('insecure_config_path', `Config path is not a regular file: ${filePath}`);
  }
  assertOwner(info.uid, filePath);
  if ((info.mode & 0o077) !== 0) {
    await chmod(filePath, 0o600);
  }
  return true;
}

async function assertExistingPathIsNotSymlink(targetPath: string): Promise<void> {
  try {
    const info = await lstat(targetPath);
    if (info.isSymbolicLink()) {
      throw new SecureConfigError('insecure_config_symlink', `Refusing symbolic-link config path: ${targetPath}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

async function assertNotInProject(filePath: string, options: SecureJsonOptions): Promise<void> {
  if (options.rejectProjectPath === false) return;
  const projectRoot = await findGitRoot(process.cwd());
  if (projectRoot && isWithin(projectRoot, filePath)) {
    throw new SecureConfigError(
      'insecure_config_path',
      `Refusing to store WOA configuration inside the project repository: ${filePath}`,
    );
  }
}

async function findGitRoot(start: string): Promise<string | null> {
  let current = path.resolve(start);
  while (true) {
    try {
      await stat(path.join(current, '.git'));
      return await realpath(current).catch(() => current);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  }
}

function isWithin(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertOwner(uid: number, targetPath: string): void {
  if (typeof process.getuid === 'function' && uid !== process.getuid()) {
    throw new SecureConfigError('insecure_config_owner', `Config path is not owned by the current user: ${targetPath}`);
  }
}

async function syncDirectory(directoryPath: string): Promise<void> {
  if (process.platform === 'win32') return;
  const handle = await open(directoryPath, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
