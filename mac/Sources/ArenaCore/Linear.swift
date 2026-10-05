import Foundation

/// One Linear issue as reported to the Arena server: no title, no URL.
public struct LinearIssue: Codable, Equatable, Sendable {
    public let id: String
    public let identifier: String
    public let estimate: Double?
    /// ISO 8601; set only while the issue is completed.
    public let completedAt: String?

    private enum CodingKeys: String, CodingKey { case id, identifier, estimate, completedAt }

    /// Writes empty fields as null rather than leaving them out.
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(identifier, forKey: .identifier)
        try c.encode(estimate, forKey: .estimate)
        try c.encode(completedAt, forKey: .completedAt)
    }
}

public enum LinearError: Error, Equatable {
    case badKey
    /// Linear couldn't be reached or answered with something unexpected.
    case unavailable
}

/// Asks Linear for the issues assigned to the key's owner. Runs on this Mac,
/// so the API key never reaches the Arena server.
public enum LinearAPI {
    static let endpoint = URL(string: "https://api.linear.app/graphql")!
    /// How often the Mac syncs.
    public static let syncInterval: TimeInterval = 15 * 60
    /// The first sync looks back this far; later ones a day before the last sync.
    static let firstLookback: TimeInterval = 90 * 86_400
    static let overlap: TimeInterval = 86_400

    static let query = """
    query AssignedIssues($since: DateTimeOrDuration) {
      viewer {
        assignedIssues(filter: { updatedAt: { gte: $since } }, first: 250) {
          nodes { id identifier estimate completedAt state { type } }
        }
      }
    }
    """

    public static func since(lastSync: Date?, now: Date) -> Date {
        lastSync.map { $0.addingTimeInterval(-overlap) } ?? now.addingTimeInterval(-firstLookback)
    }

    public static func assignedIssues(apiKey: String, since: Date, session: URLSession = .shared) async throws -> [LinearIssue] {
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.timeoutInterval = 30
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(apiKey, forHTTPHeaderField: "Authorization")
        let variables = ["since": ISO8601DateFormatter().string(from: since)]
        request.httpBody = try JSONSerialization.data(withJSONObject: ["query": query, "variables": variables])

        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw LinearError.unavailable
        }
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        if code == 401 || code == 403 { throw LinearError.badKey }
        guard (200..<300).contains(code) || code == 400 else { throw LinearError.unavailable }
        return try parse(data)
    }

    /// Keeps only what the server needs. Linear reports a bad key as a GraphQL
    /// error with an AUTHENTICATION_ERROR code.
    static func parse(_ data: Data) throws -> [LinearIssue] {
        struct Response: Decodable {
            struct Err: Decodable { let extensions: Ext? }
            struct Ext: Decodable { let code: String? }
            struct DataBody: Decodable { let viewer: Viewer? }
            struct Viewer: Decodable { let assignedIssues: Issues }
            struct Issues: Decodable { let nodes: [Node] }
            struct Node: Decodable {
                let id: String
                let identifier: String
                let estimate: Double?
                let completedAt: String?
                let state: State?
            }
            struct State: Decodable { let type: String }
            let data: DataBody?
            let errors: [Err]?
        }
        guard let response = try? JSONDecoder().decode(Response.self, from: data) else { throw LinearError.unavailable }
        if response.errors?.contains(where: { $0.extensions?.code == "AUTHENTICATION_ERROR" }) == true { throw LinearError.badKey }
        guard let nodes = response.data?.viewer?.assignedIssues.nodes else { throw LinearError.unavailable }
        return nodes.map { node in
            let done = node.state?.type == "completed"
            return LinearIssue(id: node.id, identifier: node.identifier, estimate: node.estimate,
                               completedAt: done ? node.completedAt : nil)
        }
    }
}
