import CoreGraphics

/// Seconds since the last keyboard, mouse, trackpad or scroll input in this
/// login session. Needs no Accessibility permission.
public enum IdleSensor {
    /// kCGAnyInputEventType
    private static let anyInput = CGEventType(rawValue: ~0)!

    public static func secondsSinceLastInput() -> Double {
        CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: anyInput)
    }
}
