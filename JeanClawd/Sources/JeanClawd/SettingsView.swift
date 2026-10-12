import SwiftUI
import AppKit

/// Captures the next key chord while recording (the "rebind" flow).
private struct KeyCaptureView: NSViewRepresentable {
    @Binding var isRecording: Bool
    var onCapture: (Int, NSEvent.ModifierFlags, String) -> Void

    final class CaptureNSView: NSView {
        var isRecording = false
        var onCapture: ((Int, NSEvent.ModifierFlags, String) -> Void)?
        override var acceptsFirstResponder: Bool { true }
        override func keyDown(with event: NSEvent) {
            guard isRecording else { super.keyDown(with: event); return }
            let flags = event.modifierFlags.intersection([.control, .option, .shift, .command])
            guard !flags.isEmpty else { NSSound.beep(); return } // a modifier is required
            let label: String
            switch Int(event.keyCode) {
            case 49: label = "Space"
            case 36: label = "↩"
            case 48: label = "⇥"
            case 51: label = "⌫"
            default: label = (event.charactersIgnoringModifiers ?? "?").uppercased()
            }
            onCapture?(Int(event.keyCode), flags, label)
        }
    }
    func makeNSView(context: Context) -> CaptureNSView { let v = CaptureNSView(); v.onCapture = onCapture; return v }
    func updateNSView(_ view: CaptureNSView, context: Context) {
        view.isRecording = isRecording; view.onCapture = onCapture
        if isRecording { DispatchQueue.main.async { view.window?.makeFirstResponder(view) } }
    }
}

struct SettingsView: View {
    @ObservedObject private var settings = AppSettings.shared
    @ObservedObject private var server = ServerManager.shared
    @State private var recording = false
    @State private var recordingPause = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 14) {
                Image(nsImage: JeanSprite.image(.epicSplit, scale: 3)).frame(width: 96, height: 84)
                VStack(alignment: .leading, spacing: 2) {
                    Text("JEAN CLAWD").font(DS.mono(14, .heavy)).foregroundColor(DS.orange).kerning(2)
                    Text("Settings for Jean-Claude, the Muscles from Brussels on your desktop. Planning settings live in the web app.").font(.system(size: 11)).foregroundColor(DS.dim)
                }
            }

            section("Shortcuts") {
                hotkeyRow(title: "Hide / bring back Jean-Claude", enabled: $settings.hotkeyEnabled, keys: settings.hotkeyKeys,
                          recording: $recording, isDefault: settings.hotkeyKeyCode == AppSettings.defaultHotkey.keyCode && settings.hotkeyFlags == AppSettings.defaultHotkey.flags,
                          defaultLabel: "⌘J", reset: { settings.resetHotkey() }) { k, f, l in
                    settings.hotkeyKeyCode = k; settings.hotkeyFlags = Int(f.rawValue); settings.hotkeyLabel = l
                }
                hotkeyRow(title: "Pause / resume walking", enabled: $settings.pauseHotkeyEnabled, keys: settings.pauseHotkeyKeys,
                          recording: $recordingPause, isDefault: settings.pauseHotkeyKeyCode == AppSettings.defaultPauseHotkey.keyCode && settings.pauseHotkeyFlags == AppSettings.defaultPauseHotkey.flags,
                          defaultLabel: "⌘E", reset: { settings.resetPauseHotkey() }) { k, f, l in
                    settings.pauseHotkeyKeyCode = k; settings.pauseHotkeyFlags = Int(f.rawValue); settings.pauseHotkeyLabel = l
                }
                Text("Global: they work from any app. Need at least one modifier. A message from Claude also brings him back.").font(.system(size: 10)).foregroundColor(DS.faint)
            }

            section("Character") {
                HStack { Text("Size"); Slider(value: $settings.scale, in: 2...8, step: 1).frame(width: 180); Text("\(Int(settings.scale))×").font(DS.mono(11)) }
                Picker("Walk speed", selection: $settings.speed) { ForEach(WalkSpeed.allCases) { Text($0.label).tag($0) } }.pickerStyle(.segmented).frame(width: 260)
                Toggle("Walks around (off = stands still and naps)", isOn: Binding(get: { !settings.paused }, set: { settings.paused = !$0 }))
                Toggle("Performs movie stunts now and then", isOn: $settings.splits)
                Toggle("Shows which film a stunt is from", isOn: $settings.captions)
                Toggle("Van Damme one-liners when poked", isOn: $settings.quips)
                Button("Send back to the bottom of the screen") { settings.walkHeight = 2 }.font(.system(size: 11))
            }

            section("Web app server") {
                Toggle("Start the Jean Clawd server when the app launches", isOn: $settings.autoStartServer)
                Toggle("Open the web app in the browser on launch", isOn: $settings.openOnLaunch)
                HStack { Circle().fill(server.running ? DS.green : DS.faint).frame(width: 7, height: 7); Text(server.running ? "running at \(server.url.absoluteString)" : "stopped").font(DS.mono(11)) }
                if let err = server.lastError { Text(err).font(DS.mono(10)).foregroundColor(DS.red) }
                field("node path (blank = auto)", $settings.nodePath, placeholder: server.resolveNode() ?? "not found")
                field("Jean Clawd folder (blank = auto)", $settings.projectPath, placeholder: server.projectDir?.path ?? "not found")
                Text("data: \(JeanClient.shared.dataFile.path)").font(DS.mono(10)).foregroundColor(DS.faint)
            }

            section("System") {
                Toggle("Launch at login", isOn: $settings.launchAtLogin)
            }
        }
        .padding(20)
        .frame(width: 520)
        .background(DS.panel)
        .foregroundColor(DS.text)
    }

    private func hotkeyRow(title: String, enabled: Binding<Bool>, keys: [String], recording: Binding<Bool>, isDefault: Bool,
                           defaultLabel: String, reset: @escaping () -> Void, capture: @escaping (Int, NSEvent.ModifierFlags, String) -> Void) -> some View {
        HStack(spacing: 10) {
            Toggle("", isOn: enabled).labelsHidden()
            Text(title)
            Spacer()
            if recording.wrappedValue {
                Text("press keys…").font(DS.mono(11)).foregroundColor(DS.orange)
            } else {
                HStack(spacing: 3) {
                    ForEach(keys, id: \.self) { k in
                        Text(k).font(DS.mono(11, .bold)).padding(.horizontal, 6).padding(.vertical, 3).background(DS.line).cornerRadius(4)
                    }
                }.opacity(enabled.wrappedValue ? 1 : 0.4)
            }
            Button(recording.wrappedValue ? "cancel" : "change") { recording.wrappedValue.toggle() }.font(.system(size: 11)).disabled(!enabled.wrappedValue)
            if !isDefault { Button("reset \(defaultLabel)") { reset() }.font(.system(size: 11)) }
        }
        .background(KeyCaptureView(isRecording: recording) { k, f, l in capture(k, f, l); recording.wrappedValue = false }.frame(width: 0, height: 0))
    }

    private func section<Content: View>(_ title: String, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title.uppercased()).font(DS.mono(10, .bold)).foregroundColor(DS.faint).kerning(1.5)
            content()
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DS.surface).cornerRadius(8)
    }

    private func field(_ label: String, _ binding: Binding<String>, placeholder: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.system(size: 10)).foregroundColor(DS.dim)
            TextField(placeholder, text: binding).textFieldStyle(.roundedBorder).font(DS.mono(11))
        }
    }
}
