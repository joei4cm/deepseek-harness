/** Host facts used to distinguish Windows interoperation from an ordinary Linux desktop. */
import { win32 } from 'node:path'
import { release } from 'node:os'

/** Injectable process and kernel facts; detection does not establish desktop availability. */
export interface HostEnvironmentFacts {
  platform?: string
  env?: NodeJS.ProcessEnv
  osRelease?: string
}

/**
 * Identify a Linux process running under Windows Subsystem for Linux.
 * @param facts Process and kernel facts; omitted fields use the current Host.
 * @returns Whether WSL markers are present on a Linux Host, even when interoperation is disabled.
 */
export function isWsl(facts: HostEnvironmentFacts = {}): boolean {
  if ((facts.platform ?? process.platform) !== 'linux') return false
  const env = facts.env ?? process.env
  return Boolean(env.WSL_DISTRO_NAME || env.WSL_INTEROP)
    || (facts.osRelease ?? release()).toLowerCase().includes('microsoft')
}

/**
 * Resolve a Windows system executable from `%SystemRoot%`, or its bare name when
 * that variable is unavailable.
 *
 * `%SystemRoot%` is always defined on Windows, but a trimmed `PATH` need not contain
 * the system directories hosting the executable; the bare name then fails to resolve
 * with `ENOENT`. `win32.join` keeps the produced command independent of the platform
 * joining it, so tests on any platform assert the same command.
 * @param env - the Windows host environment.
 * @param name - the bare executable name, also the fallback.
 * @param path - directories from `%SystemRoot%` to the executable's directory.
 * @returns the executable to spawn.
 */
export function windowsSystemCommand(
  env: NodeJS.ProcessEnv, name: string, ...path: readonly string[]
): string {
  const root = env.SystemRoot
  return root === undefined || root === '' ? name : win32.join(root, ...path, name)
}
