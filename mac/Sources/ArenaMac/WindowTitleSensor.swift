import AppKit
import ApplicationServices

/// Focused window title of the frontmost app via Accessibility. Opt-in;
/// titles stay on this Mac (spec §1.2).
public enum WindowTitleSensor {

    public static var isTrusted: Bool { AXIsProcessTrusted() }

    /// Shows the system prompt to grant Accessibility access.
    public static func requestAccess() {
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        _ = AXIsProcessTrustedWithOptions(options)
    }

    public static func focusedWindowTitle() -> String? {
        guard isTrusted, let app = NSWorkspace.shared.frontmostApplication else { return nil }
        let element = AXUIElementCreateApplication(app.processIdentifier)
        var window: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXFocusedWindowAttribute as CFString, &window) == .success,
              let window, CFGetTypeID(window) == AXUIElementGetTypeID() else { return nil }
        var title: CFTypeRef?
        guard AXUIElementCopyAttributeValue(window as! AXUIElement, kAXTitleAttribute as CFString, &title) == .success,
              let text = title as? String, !text.isEmpty else { return nil }
        return text
    }
}
