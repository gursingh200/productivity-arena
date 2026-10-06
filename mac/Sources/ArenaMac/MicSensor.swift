import CoreAudio
import Foundation

/// Which processes are capturing the microphone right now, by bundle id.
///
/// Uses CoreAudio's process objects (macOS 14+): it reads whether each audio
/// client is running input, never the audio itself, so it needs no
/// microphone permission.
public enum MicSensor {

    public static func capturingBundleIds() -> [String] {
        bundleIds(where: isRunningInput)
    }

    /// Processes playing audio right now (whether or not it's audible).
    public static func outputtingBundleIds() -> [String] {
        bundleIds(where: isRunningOutput)
    }

    private static func bundleIds(where running: (AudioObjectID) -> Bool) -> [String] {
        var ids: [String] = []
        for process in processObjects() where running(process) {
            if let bundleId = bundleId(of: process), !bundleId.isEmpty { ids.append(bundleId) }
        }
        return ids
    }

    private static func address(_ selector: AudioObjectPropertySelector) -> AudioObjectPropertyAddress {
        AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal,
                                   mElement: kAudioObjectPropertyElementMain)
    }

    private static func processObjects() -> [AudioObjectID] {
        var addr = address(kAudioHardwarePropertyProcessObjectList)
        let system = AudioObjectID(kAudioObjectSystemObject)
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(system, &addr, 0, nil, &size) == noErr, size > 0 else { return [] }
        var objects = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
        guard AudioObjectGetPropertyData(system, &addr, 0, nil, &size, &objects) == noErr else { return [] }
        return Array(objects.prefix(Int(size) / MemoryLayout<AudioObjectID>.size))
    }

    private static func isRunningOutput(_ process: AudioObjectID) -> Bool {
        flag(process, kAudioProcessPropertyIsRunningOutput)
    }

    private static func isRunningInput(_ process: AudioObjectID) -> Bool {
        flag(process, kAudioProcessPropertyIsRunningInput)
    }

    private static func flag(_ process: AudioObjectID, _ selector: AudioObjectPropertySelector) -> Bool {
        var addr = address(selector)
        var running: UInt32 = 0
        var size = UInt32(MemoryLayout<UInt32>.size)
        guard AudioObjectGetPropertyData(process, &addr, 0, nil, &size, &running) == noErr else { return false }
        return running != 0
    }

    private static func bundleId(of process: AudioObjectID) -> String? {
        var addr = address(kAudioProcessPropertyBundleID)
        var size = UInt32(MemoryLayout<CFString?>.size)
        var value: Unmanaged<CFString>?
        let status = withUnsafeMutablePointer(to: &value) { pointer in
            AudioObjectGetPropertyData(process, &addr, 0, nil, &size, pointer)
        }
        guard status == noErr, let value else { return nil }
        return value.takeRetainedValue() as String
    }
}
