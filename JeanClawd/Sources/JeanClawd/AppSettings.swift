import AppKit
import Carbon.HIToolbox
import Combine
import ServiceManagement

enum WalkSpeed: String, CaseIterable, Identifiable {
    case slow, normal, zippy
    var id: String { rawValue }
    var label: String { switch self { case .slow: return "🐢 slow"; case .normal: return "🚶 normal"; case .zippy: return "⚡ zippy" } }
    var pointsPerTick: CGFloat { switch self { case .slow: return 0.6; case .normal: return 1.3; case .zippy: return 2.4 } }
}

final class AppSettings: ObservableObject {
    static let shared = AppSettings()

    @Published var scale: Double { didSet { save(scale, "scale") } }
    @Published var speed: WalkSpeed { didSet { save(speed.rawValue, "speed") } }
    @Published var paused: Bool { didSet { save(paused, "paused") } }
    @Published var walkHeight: Double { didSet { save(walkHeight, "walkHeight") } }
    @Published var quips: Bool { didSet { save(quips, "quips") } }
    @Published var splits: Bool { didSet { save(splits, "splits") } }
    @Published var captions: Bool { didSet { save(captions, "captions") } }
    /// ⌘J toggles this: hidden = off screen until summoned again. Not persisted — he always starts visible.
    @Published var hidden: Bool

    // Global hide/show shortcut. Default ⌘J; rebindable in Settings.
    @Published var hotkeyEnabled: Bool { didSet { save(hotkeyEnabled, "hotkeyEnabled") } }
    @Published var hotkeyKeyCode: Int { didSet { save(hotkeyKeyCode, "hotkeyKeyCode") } }
    @Published var hotkeyFlags: Int { didSet { save(hotkeyFlags, "hotkeyFlags") } }
    @Published var hotkeyLabel: String { didSet { save(hotkeyLabel, "hotkeyLabel") } }

    // Global pause/resume-walking shortcut. Default ⌘E (a letter nobody's ⌘ uses much); rebindable.
    @Published var pauseHotkeyEnabled: Bool { didSet { save(pauseHotkeyEnabled, "pauseHotkeyEnabled") } }
    @Published var pauseHotkeyKeyCode: Int { didSet { save(pauseHotkeyKeyCode, "pauseHotkeyKeyCode") } }
    @Published var pauseHotkeyFlags: Int { didSet { save(pauseHotkeyFlags, "pauseHotkeyFlags") } }
    @Published var pauseHotkeyLabel: String { didSet { save(pauseHotkeyLabel, "pauseHotkeyLabel") } }

    static let defaultHotkey = (keyCode: kVK_ANSI_J, flags: Int(NSEvent.ModifierFlags.command.rawValue), label: "J")
    static let defaultPauseHotkey = (keyCode: kVK_ANSI_E, flags: Int(NSEvent.ModifierFlags.command.rawValue), label: "E")

    static func keys(flags rawFlags: Int, label: String) -> [String] {
        var keys: [String] = []
        let flags = NSEvent.ModifierFlags(rawValue: UInt(rawFlags))
        if flags.contains(.control) { keys.append("⌃") }
        if flags.contains(.option) { keys.append("⌥") }
        if flags.contains(.shift) { keys.append("⇧") }
        if flags.contains(.command) { keys.append("⌘") }
        keys.append(label)
        return keys
    }
    static func carbon(flags rawFlags: Int) -> UInt32 {
        let flags = NSEvent.ModifierFlags(rawValue: UInt(rawFlags))
        var carbon: UInt32 = 0
        if flags.contains(.control) { carbon |= UInt32(controlKey) }
        if flags.contains(.option) { carbon |= UInt32(optionKey) }
        if flags.contains(.shift) { carbon |= UInt32(shiftKey) }
        if flags.contains(.command) { carbon |= UInt32(cmdKey) }
        return carbon
    }

    var hotkeyKeys: [String] { Self.keys(flags: hotkeyFlags, label: hotkeyLabel) }
    var hotkeyDisplay: String { hotkeyKeys.joined() }
    var hotkeyCarbonModifiers: UInt32 { Self.carbon(flags: hotkeyFlags) }
    var pauseHotkeyKeys: [String] { Self.keys(flags: pauseHotkeyFlags, label: pauseHotkeyLabel) }
    var pauseHotkeyDisplay: String { pauseHotkeyKeys.joined() }
    var pauseHotkeyCarbonModifiers: UInt32 { Self.carbon(flags: pauseHotkeyFlags) }

    func resetHotkey() {
        hotkeyKeyCode = Self.defaultHotkey.keyCode; hotkeyFlags = Self.defaultHotkey.flags; hotkeyLabel = Self.defaultHotkey.label
    }
    func resetPauseHotkey() {
        pauseHotkeyKeyCode = Self.defaultPauseHotkey.keyCode; pauseHotkeyFlags = Self.defaultPauseHotkey.flags; pauseHotkeyLabel = Self.defaultPauseHotkey.label
    }
    @Published var autoStartServer: Bool { didSet { save(autoStartServer, "autoStartServer") } }
    @Published var openOnLaunch: Bool { didSet { save(openOnLaunch, "openOnLaunch") } }
    @Published var nodePath: String { didSet { save(nodePath, "nodePath") } }
    @Published var projectPath: String { didSet { save(projectPath, "projectPath") } }
    @Published var launchAtLogin: Bool {
        didSet {
            save(launchAtLogin, "launchAtLogin")
            do { if launchAtLogin { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() } }
            catch { /* dev builds outside /Applications: harmless */ }
        }
    }

    private init() {
        let d = UserDefaults.standard
        scale = d.object(forKey: "scale") as? Double ?? 4
        speed = WalkSpeed(rawValue: d.string(forKey: "speed") ?? "") ?? .normal
        paused = d.object(forKey: "paused") as? Bool ?? false
        walkHeight = d.object(forKey: "walkHeight") as? Double ?? 2
        quips = d.object(forKey: "quips") as? Bool ?? true
        splits = d.object(forKey: "splits") as? Bool ?? true
        captions = d.object(forKey: "captions") as? Bool ?? true
        hidden = false
        hotkeyEnabled = d.object(forKey: "hotkeyEnabled") as? Bool ?? true
        hotkeyKeyCode = d.object(forKey: "hotkeyKeyCode") as? Int ?? Self.defaultHotkey.keyCode
        hotkeyFlags = d.object(forKey: "hotkeyFlags") as? Int ?? Self.defaultHotkey.flags
        hotkeyLabel = d.string(forKey: "hotkeyLabel") ?? Self.defaultHotkey.label
        pauseHotkeyEnabled = d.object(forKey: "pauseHotkeyEnabled") as? Bool ?? true
        pauseHotkeyKeyCode = d.object(forKey: "pauseHotkeyKeyCode") as? Int ?? Self.defaultPauseHotkey.keyCode
        pauseHotkeyFlags = d.object(forKey: "pauseHotkeyFlags") as? Int ?? Self.defaultPauseHotkey.flags
        pauseHotkeyLabel = d.string(forKey: "pauseHotkeyLabel") ?? Self.defaultPauseHotkey.label
        autoStartServer = d.object(forKey: "autoStartServer") as? Bool ?? true
        openOnLaunch = d.object(forKey: "openOnLaunch") as? Bool ?? false
        nodePath = d.string(forKey: "nodePath") ?? ""
        projectPath = d.string(forKey: "projectPath") ?? ""
        launchAtLogin = d.object(forKey: "launchAtLogin") as? Bool ?? false
    }

    private func save(_ value: Any, _ key: String) { UserDefaults.standard.set(value, forKey: key) }
}
