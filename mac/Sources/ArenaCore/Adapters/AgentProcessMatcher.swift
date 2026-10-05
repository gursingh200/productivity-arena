import Foundation

/// Recognises coding-agent CLIs that don't write logs we can read, from a
/// process's executable name and arguments. Used by the process-scan fallback.
public enum AgentProcessMatcher {

    /// Native binaries, matched on the executable name exactly.
    static let executables: [String: String] = [
        "gemini": "gemini", "amp": "amp", "droid": "droid", "aider": "aider",
        "goose": "goose", "crush": "crush", "qwen": "qwen", "cursor-agent": "cursor-agent",
    ]

    /// Script-based CLIs run by an interpreter, matched on a path fragment in the arguments.
    static let scriptMarkers: [(fragment: String, agent: String)] = [
        ("@google/gemini-cli", "gemini"), ("/bin/gemini", "gemini"),
        ("@sourcegraph/amp", "amp"), ("/bin/amp", "amp"),
        ("/bin/aider", "aider"), ("aider/__main__", "aider"),
        ("@qwen-code/", "qwen"), ("/bin/qwen", "qwen"),
    ]

    static let interpreters: Set<String> = ["node", "bun", "deno", "python", "python3", "Python"]

    /// Agent id for a process, or nil if it isn't a known agent.
    public static func agent(executable: String, arguments: [String]) -> String? {
        let name = (executable as NSString).lastPathComponent
        if let agent = executables[name] { return agent }
        guard interpreters.contains(name) || name.hasPrefix("python") else { return nil }
        for arg in arguments.dropFirst() {
            for marker in scriptMarkers where arg.contains(marker.fragment) {
                return marker.agent
            }
        }
        return nil
    }

    /// Whether the process name could be an agent or an interpreter worth
    /// reading arguments for (reading arguments costs a syscall).
    public static func isCandidate(processName: String) -> Bool {
        executables[processName] != nil || interpreters.contains(processName) || processName.hasPrefix("python")
    }
}
