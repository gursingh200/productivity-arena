import Foundation
import Darwin
import ArenaCore

/// Finds known agent CLIs (see `AgentProcessMatcher`) that used more than one
/// second of CPU since the previous scan. Call about once a minute.
public final class ProcessScanner {

    /// CPU time per pid at the previous scan, in nanoseconds.
    private var previousCPU: [pid_t: UInt64] = [:]
    private let timebase: mach_timebase_info_data_t = {
        var info = mach_timebase_info_data_t()
        mach_timebase_info(&info)
        return info
    }()

    public static let busyThresholdNanos: UInt64 = 1_000_000_000

    public init() {}

    /// Agent ids that were busy since the last call.
    public func busyAgents() -> Set<String> {
        let count = proc_listallpids(nil, 0)
        guard count > 0 else { return [] }
        var pids = [pid_t](repeating: 0, count: Int(count) + 64)
        let filled = proc_listallpids(&pids, Int32(pids.count * MemoryLayout<pid_t>.size))
        guard filled > 0 else { return [] }

        var busy = Set<String>()
        var currentCPU: [pid_t: UInt64] = [:]
        for pid in pids.prefix(Int(filled)) where pid > 0 {
            var nameBuffer = [CChar](repeating: 0, count: Int(MAXCOMLEN) + 1)
            guard proc_name(pid, &nameBuffer, UInt32(nameBuffer.count)) > 0 else { continue }
            let name = String(cString: nameBuffer)
            guard AgentProcessMatcher.isCandidate(processName: name) else { continue }
            guard let agent = AgentProcessMatcher.agent(executable: name, arguments: arguments(of: pid)) else { continue }
            guard let cpu = cpuNanos(of: pid) else { continue }
            currentCPU[pid] = cpu
            if let previous = previousCPU[pid], cpu > previous, cpu - previous > Self.busyThresholdNanos {
                busy.insert(agent)
            }
        }
        previousCPU = currentCPU
        return busy
    }

    private func cpuNanos(of pid: pid_t) -> UInt64? {
        var info = proc_taskinfo()
        let size = Int32(MemoryLayout<proc_taskinfo>.size)
        guard proc_pidinfo(pid, PROC_PIDTASKINFO, 0, &info, size) == size else { return nil }
        // Task times are in Mach absolute time units on Apple silicon.
        let ticks = info.pti_total_user + info.pti_total_system
        return ticks * UInt64(timebase.numer) / UInt64(timebase.denom)
    }

    /// argv of a process via KERN_PROCARGS2, or [] if unavailable.
    private func arguments(of pid: pid_t) -> [String] {
        var mib: [Int32] = [CTL_KERN, KERN_PROCARGS2, pid]
        var size = 0
        guard sysctl(&mib, 3, nil, &size, nil, 0) == 0, size > MemoryLayout<Int32>.size else { return [] }
        var buffer = [UInt8](repeating: 0, count: size)
        guard sysctl(&mib, 3, &buffer, &size, nil, 0) == 0 else { return [] }

        let argc = buffer.withUnsafeBytes { $0.load(as: Int32.self) }
        var index = MemoryLayout<Int32>.size
        // Skip the executable path and the padding NULs after it.
        while index < size, buffer[index] != 0 { index += 1 }
        while index < size, buffer[index] == 0 { index += 1 }

        var args: [String] = []
        while index < size, args.count < Int(argc) {
            let start = index
            while index < size, buffer[index] != 0 { index += 1 }
            args.append(String(decoding: buffer[start..<index], as: UTF8.self))
            index += 1
        }
        return args
    }
}
