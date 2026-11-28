/**
 * Which C library the running Linux process is linked against.
 *
 * The flock addon is built once per library family, so the entry must load
 * the addon that matches the library mapped into the process. Node's
 * diagnostic report answers the same question, but building a report walks
 * every libuv handle and every CPU, which can stall the event loop for tens
 * of seconds on a busy host. The process's own memory maps name the library
 * that is actually mapped, and reading them costs microseconds.
 */
import { readFileSync } from 'node:fs'

/** The C library families the Linux addons are built for. */
export type LinuxLibcFamily = 'glibc' | 'musl'

/** musl's loader and library, as they appear in a process's memory maps. */
const MUSL_MAPPING = /(?:^|[/\s])(?:ld-musl-[^\s/]*|libc\.musl-[^\s/]*)(?=$|[\s])/m

/** glibc's library and loader, as they appear in a process's memory maps. */
const GLIBC_MAPPING = /(?:^|[/\s])(?:libc\.so\.6|libc-2\.\d+\.so|ld-linux-[^\s/]*)(?=$|[\s])/m

/**
 * Classify a process's memory maps by the C library they name.
 *
 * musl wins over glibc because a host may map both: a musl program running
 * through a glibc compatibility layer maps the musl library and the
 * compatibility layer's libc, and the musl library is the one the addon has
 * to match.
 * @param maps - the contents of `/proc/self/maps`.
 * @returns the library family the maps name, or undefined when they name
 *   neither.
 */
export function classifyLinuxLibc(maps: string): LinuxLibcFamily | undefined {
  if (MUSL_MAPPING.test(maps)) return 'musl'
  if (GLIBC_MAPPING.test(maps)) return 'glibc'
  return undefined
}

/** The sources {@link resolveLinuxLibc} reads. */
export interface LinuxLibcSources {
  /** The process's memory maps, or undefined when they cannot be read. */
  readonly procMaps: string | undefined
  /** The glibc version Node's diagnostic report names, if any. */
  readonly readReportGlibcVersion: () => string | undefined
}

/**
 * Resolve the C library family, preferring the process's own memory maps
 * over a diagnostic report.
 * @param sources - the memory maps and the report reader.
 * @returns the library family. A report that names no glibc version means
 *   musl, which is how Node itself reports a musl build.
 */
export function resolveLinuxLibc(sources: LinuxLibcSources): LinuxLibcFamily {
  const mapped = sources.procMaps === undefined ? undefined : classifyLinuxLibc(sources.procMaps)
  if (mapped !== undefined) return mapped
  return sources.readReportGlibcVersion() === undefined ? 'musl' : 'glibc'
}

/**
 * The C library family of the running Linux process.
 * @returns the family the process is linked against.
 */
export function detectLinuxLibc(): LinuxLibcFamily {
  return resolveLinuxLibc({ procMaps: readProcSelfMaps(), readReportGlibcVersion: readReportGlibcVersion })
}

/**
 * The process's own memory maps.
 * @returns the maps, or undefined when the host has no readable `/proc`.
 */
function readProcSelfMaps(): string | undefined {
  try {
    return readFileSync('/proc/self/maps', 'utf8')
  } catch (_procUnreadable) {
    // A host without a readable /proc leaves the family to the report reader.
    return undefined
  }
}

/**
 * The glibc version Node's diagnostic report names. A report walks every
 * libuv handle, so its network section is excluded while it is built and the
 * exclusion is undone afterwards.
 * @returns the version, or undefined when the report names none.
 */
function readReportGlibcVersion(): string | undefined {
  const report = process.report as NodeJS.ProcessReport & { excludeNetwork: boolean }
  const excludeNetwork = report.excludeNetwork
  try {
    report.excludeNetwork = true
    const data = report.getReport() as { header?: { glibcVersionRuntime?: string } }
    const version = data.header?.glibcVersionRuntime
    return version === undefined || version === '' ? undefined : version
  } finally {
    report.excludeNetwork = excludeNetwork
  }
}
