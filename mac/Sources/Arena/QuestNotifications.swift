import Foundation
import UserNotifications
import ArenaCore

/// Posts a notification with Accept / Decline for each newly offered live quest.
final class QuestNotifications: NSObject, UNUserNotificationCenterDelegate {

    var onResponse: ((String, Bool) -> Void)?
    private var notified = Set<String>()
    private let center = UNUserNotificationCenter.current()
    private static let category = "LIVE_QUEST"

    override init() {
        super.init()
        center.delegate = self
        let accept = UNNotificationAction(identifier: "ACCEPT", title: "Accept", options: [])
        let decline = UNNotificationAction(identifier: "DECLINE", title: "Decline", options: [])
        center.setNotificationCategories([
            UNNotificationCategory(identifier: Self.category, actions: [accept, decline], intentIdentifiers: [])
        ])
        center.requestAuthorization(options: [.alert, .sound]) { _, _ in }
    }

    func offerLiveQuests(_ quests: [QuestStatus]) {
        for quest in quests where quest.kind == "live" && quest.state == "offered" && !notified.contains(quest.id) {
            notified.insert(quest.id)
            let content = UNMutableNotificationContent()
            content.title = "Quest: \(quest.title)"
            content.body = "+\(quest.xp) XP — accept to start."
            content.categoryIdentifier = Self.category
            content.userInfo = ["questId": quest.id]
            center.add(UNNotificationRequest(identifier: "quest-\(quest.id)", content: content, trigger: nil))
        }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        defer { completionHandler() }
        guard let id = response.notification.request.content.userInfo["questId"] as? String else { return }
        switch response.actionIdentifier {
        case "ACCEPT": onResponse?(id, true)
        case "DECLINE": onResponse?(id, false)
        default: break
        }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }
}
