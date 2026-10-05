import Foundation
import Testing
@testable import ArenaCore

@Suite struct LinearTests {

    @Test func keepsOnlyNumberEstimateAndCompletion() throws {
        let json = """
        {"data":{"viewer":{"assignedIssues":{"nodes":[
          {"id":"a","identifier":"ENG-1","title":"Secret","estimate":2,"completedAt":"2026-10-05T10:00:00.000Z","url":"https://linear.app/x","state":{"type":"completed"}},
          {"id":"b","identifier":"ENG-2","estimate":null,"completedAt":"2026-10-04T10:00:00.000Z","state":{"type":"started"}}
        ]}}}}
        """
        let issues = try LinearAPI.parse(Data(json.utf8))
        #expect(issues == [
            LinearIssue(id: "a", identifier: "ENG-1", estimate: 2, completedAt: "2026-10-05T10:00:00.000Z"),
            // Reopened: no longer completed, so no completion time.
            LinearIssue(id: "b", identifier: "ENG-2", estimate: nil, completedAt: nil),
        ])
        let sent = String(decoding: try JSONEncoder().encode(issues), as: UTF8.self)
        #expect(!sent.contains("Secret") && !sent.contains("linear.app"))
    }

    @Test func badKeyIsReported() {
        let json = #"{"errors":[{"message":"Authentication required","extensions":{"code":"AUTHENTICATION_ERROR"}}]}"#
        #expect(throws: LinearError.badKey) { try LinearAPI.parse(Data(json.utf8)) }
    }

    @Test func firstSyncLooksBack90DaysThenOverlapsADay() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        #expect(LinearAPI.since(lastSync: nil, now: now) == now.addingTimeInterval(-90 * 86_400))
        #expect(LinearAPI.since(lastSync: now, now: now) == now.addingTimeInterval(-86_400))
    }
}
